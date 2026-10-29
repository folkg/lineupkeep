import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import { createEgressProxy, type EgressProxy, type EgressRefusal } from "./egress.ts";
import {
  viewportSize,
  type HostedBrowserFailure,
  type HostedBrowserInput,
  type HostedBrowserStatus,
  type HostedBrowserViewportProfile,
} from "./protocol.ts";

const capturePollMillis = 400;
const navigationTimeoutMillis = 30_000;
const autofocusTimeoutMillis = 2_000;
const maximumFrameBytes = 1_500_000;

export type HostedBrowserSession = {
  readonly id: string;
  readonly expiresAt: number;
  readonly loginUrl: string;
  readonly viewport: HostedBrowserViewportProfile;
  readonly fixtureOrigin?: string;
};

export type HostedBrowserEvents = {
  readonly onFrame: (frame: Uint8Array) => void;
  readonly onStatus: (status: HostedBrowserStatus) => void;
  readonly onRefused: (refusal: EgressRefusal) => void;
  readonly onCaptured: (cookieHeader: string) => void;
  readonly onFailure: (reason: HostedBrowserFailure) => void;
  readonly onExpired: () => void;
};

export type HostedBrowserHandle = {
  readonly input: (input: HostedBrowserInput) => void;
  readonly close: () => Promise<void>;
};

export type HostedBrowser = {
  readonly open: (
    session: HostedBrowserSession,
    events: HostedBrowserEvents,
  ) => Promise<HostedBrowserHandle>;

  readonly closeAll: () => Promise<void>;
};

export type HostedBrowserOptions = {
  readonly profileRoot?: string;
  readonly chromiumSandbox?: boolean;
};

export function createHostedBrowser(options: HostedBrowserOptions = {}): HostedBrowser {
  const live = new Map<string, () => Promise<void>>();
  return {
    open: async (session, events) => {
      if (live.has(session.id)) {
        throw new Error("A hosted browser is already open for this session");
      }
      live.set(session.id, () => Promise.resolve());
      try {
        const handle = await openBrowser(session, events, () => live.delete(session.id), options);
        live.set(session.id, handle.close);
        return handle;
      } catch (error) {
        live.delete(session.id);
        throw error;
      }
    },
    closeAll: async () => {
      await Promise.all([...live.values()].map((close) => close().catch(() => undefined)));
      live.clear();
    },
  };
}

async function openBrowser(
  session: HostedBrowserSession,
  events: HostedBrowserEvents,
  onClosed: () => void,
  options: HostedBrowserOptions,
): Promise<HostedBrowserHandle> {
  const profileDirectory = await mkdtemp(
    join(options.profileRoot ?? tmpdir(), "lineupkeep-hosted-browser-"),
  );
  const viewport = viewportSize(session.viewport);
  let closed = false;
  let settled = false;
  let capturePoll: NodeJS.Timeout | undefined;
  let expiryTimer: NodeJS.Timeout | undefined;
  let inputQueue = Promise.resolve();
  let switchQueue = Promise.resolve();
  let context: BrowserContext | undefined;
  let active: Page | undefined;
  const targets = new Map<Page, Target>();
  const activationOrder: Page[] = [];

  let egress: EgressProxy;
  try {
    egress = await createEgressProxy({
      fixtureOrigins: session.fixtureOrigin === undefined ? [] : [session.fixtureOrigin],
      onRefused: (refusal) => {
        if (!closed) {
          events.onRefused(refusal);
        }
      },
    });
  } catch (error) {
    await removeProfile(profileDirectory);
    throw error;
  }

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (capturePoll !== undefined) {
      clearInterval(capturePoll);
    }
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer);
    }
    await context?.close().catch(() => undefined);
    await egress.close().catch(() => undefined);
    await removeProfile(profileDirectory);
    onClosed();
  };

  const report = (status: HostedBrowserStatus): void => {
    if (!closed) {
      events.onStatus(status);
    }
  };
  const fail = async (reason: HostedBrowserFailure): Promise<void> => {
    if (closed) {
      return;
    }
    events.onFailure(reason);
    await close();
  };

  report("starting");

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      locale: "en-US",
      args: chromiumArguments(egress.url, options.chromiumSandbox ?? true),
    });
  } catch {
    await fail("browser_unavailable");
    throw new Error("The hosted browser could not start");
  }

  context.on("page", (opened) => {
    registerTarget(opened);
  });

  const initial = context.pages()[0] ?? (await context.newPage());
  registerTarget(initial);
  await switchQueue;

  report("loading");
  try {
    await initial.goto(session.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMillis,
    });
    if ((await initial.locator("[autofocus]").count()) > 0) {
      await initial
        .locator("[autofocus]:focus")
        .waitFor({ timeout: autofocusTimeoutMillis })
        .catch(() => undefined);
    }
  } catch {
    await fail("provider_unavailable");
    throw new Error("The provider login page did not load");
  }
  report(currentStatus(initial));

  const remaining = session.expiresAt - Date.now();
  expiryTimer = setTimeout(
    () => {
      if (closed || settled) {
        return;
      }
      settled = true;
      events.onExpired();
      void close().catch(() => undefined);
    },
    Math.max(remaining, 0),
  );

  const captureWhenSignedIn = async (): Promise<void> => {
    if (closed || settled) {
      return;
    }
    const cookies = await context.cookies([session.loginUrl]);
    const token = cookies.find((cookie) => cookie.name === "T" && cookie.value !== "");
    const user = cookies.find((cookie) => cookie.name === "Y" && cookie.value !== "");
    if (token === undefined || user === undefined) {
      return;
    }
    settled = true;
    const cookieHeader = `T=${token.value}; Y=${user.value}`;
    await close().catch(() => undefined);
    events.onCaptured(cookieHeader);
  };

  capturePoll = setInterval(() => {
    void captureWhenSignedIn().catch(() => undefined);
  }, capturePollMillis);

  function registerTarget(page: Page): void {
    if (closed) {
      void page.close().catch(() => undefined);
      return;
    }
    if (targets.has(page)) {
      return;
    }
    const target: Target = { generation: 0, streaming: false };
    targets.set(page, target);
    activationOrder.push(page);
    page.on("dialog", (dialog) => {
      void dialog.dismiss();
    });
    page.on("download", (download) => {
      void download.cancel();
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && active === page) {
        report(currentStatus(page));
      }
    });
    page.on("close", () => {
      forgetTarget(page);
    });
    void page.setViewportSize(viewport).catch(() => undefined);
    activate(page);
  }

  function activate(page: Page): void {
    if (closed || active === page) {
      return;
    }
    active = page;
    void page.bringToFront().catch(() => undefined);
    switchQueue = switchQueue.then(() => streamTarget(page)).catch(() => undefined);
  }

  async function streamTarget(page: Page): Promise<void> {
    for (const [other, target] of targets) {
      if (other !== page && target.streaming) {
        target.streaming = false;
        target.generation++;
        await other.screencast.stop().catch(() => undefined);
      }
    }
    const target = targets.get(page);
    if (target === undefined || target.streaming || closed) {
      return;
    }
    const generation = ++target.generation;
    try {
      await page.screencast.start({
        onFrame: ({ data }) => {
          if (
            !closed &&
            active === page &&
            target.generation === generation &&
            data.length <= maximumFrameBytes
          ) {
            events.onFrame(new Uint8Array(data));
          }
        },
        size: viewport,
        quality: 55,
        fps: 5,
      });
      target.streaming = true;
    } catch {
      target.streaming = false;
    }
    if (active === page) {
      report(currentStatus(page));
    }
  }

  function forgetTarget(page: Page): void {
    const target = targets.get(page);
    if (target?.streaming === true) {
      target.generation++;
      void page.screencast.stop().catch(() => undefined);
    }
    targets.delete(page);
    const index = activationOrder.lastIndexOf(page);
    if (index >= 0) {
      activationOrder.splice(index, 1);
    }
    if (active !== page) {
      return;
    }
    active = undefined;
    const fallback = [...activationOrder].reverse().find((candidate) => targets.has(candidate));
    if (fallback !== undefined) {
      activate(fallback);
    } else if (!settled) {
      void fail("page_unavailable");
    }
  }

  return {
    input: (input) => {
      inputQueue = inputQueue
        .then(() => {
          const page = active;
          return page === undefined ? Promise.resolve() : applyInput(page, input, viewport);
        })
        .catch(() => undefined);
    },
    close,
  };
}

async function applyInput(
  page: Page,
  input: HostedBrowserInput,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  switch (input._tag) {
    case "Click":
      await page.mouse.click(
        Math.round(input.x * viewport.width),
        Math.round(input.y * viewport.height),
      );
      return;
    case "Text":
      await page.keyboard.insertText(input.text);
      return;
    case "Key":
      await page.keyboard.press(input.key);
      return;
    case "Scroll":
      await page.mouse.wheel(0, input.deltaY);
      return;
  }
}

function currentStatus(page: Page): HostedBrowserStatus {
  const value = page.url();
  if (value === "" || value === "about:blank") {
    return "loading";
  }
  try {
    return challengeStatus(new URL(value)) ?? "waiting";
  } catch {
    return "waiting";
  }
}

function challengeStatus(url: URL): HostedBrowserStatus | undefined {
  const mode = url.searchParams.get("mode");
  if (mode === "blocked") {
    return "blocked";
  }
  if (
    mode === "two-factor" ||
    /\/(?:challenge|verify|account-locked)(?:\/|$)/u.test(url.pathname)
  ) {
    return "two-factor";
  }
  return undefined;
}

function chromiumArguments(proxyUrl: string, chromiumSandbox: boolean): string[] {
  return [
    ...(chromiumSandbox ? [] : ["--no-sandbox"]),
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,WebRtcHideLocalIpsWithMdns",
    "--disable-quic",
    "--disable-sync",
    "--dns-prefetch-disable",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-pings",
    "--password-store=basic",
    `--proxy-bypass-list=<-loopback>`,
    `--proxy-server=${proxyUrl}`,
  ];
}

async function removeProfile(directory: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw new Error("The temporary browser profile could not be removed");
}

type Target = {
  generation: number;
  streaming: boolean;
};
