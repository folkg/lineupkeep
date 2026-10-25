import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import {
  browserViewport,
  type HostedBrowserFailure,
  type HostedBrowserInput,
  type HostedBrowserStatus,
} from "./protocol.ts";

const capturePollMillis = 400;
const navigationTimeoutMillis = 30_000;
const maximumFrameBytes = 1_500_000;

export type HostedBrowserSession = {
  readonly id: string;
  readonly expiresAt: number;
  readonly loginUrl: string;
  readonly allowedOrigins: ReadonlyArray<string>;
};

export type HostedBrowserEvents = {
  readonly onFrame: (frame: Uint8Array) => void;
  readonly onStatus: (status: HostedBrowserStatus) => void;
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
  let closed = false;
  let settled = false;
  let capturePoll: NodeJS.Timeout | undefined;
  let expiryTimer: NodeJS.Timeout | undefined;
  let inputQueue = Promise.resolve();
  let context: BrowserContext | undefined;
  let page: Page | undefined;

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
    await page?.screencast.stop().catch(() => undefined);
    await context?.close().catch(() => undefined);
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
      viewport: browserViewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      locale: "en-US",
      args: chromiumArguments(session.allowedOrigins, options.chromiumSandbox ?? true),
    });
  } catch {
    await fail("browser_unavailable");
    throw new Error("The hosted browser could not start");
  }

  const allowedOrigins = new Set(session.allowedOrigins);
  await installEgressPolicy(context, allowedOrigins);

  page = context.pages()[0] ?? (await context.newPage());
  context.on("page", (opened) => {
    if (opened !== page) {
      void opened.close();
    }
  });
  page.on("dialog", (dialog) => {
    void dialog.dismiss();
  });
  page.on("download", (download) => {
    void download.cancel();
  });
  page.on("popup", (popup) => {
    void popup.close();
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      report(challengeStatus(new URL(frame.url())) ?? "waiting");
    }
  });
  page.on("close", () => {
    if (!settled) {
      void fail("page_unavailable");
    }
  });

  try {
    await page.screencast.start({
      onFrame: ({ data }) => {
        if (!closed && data.length <= maximumFrameBytes) {
          events.onFrame(new Uint8Array(data));
        }
      },
      size: browserViewport,
      quality: 55,
      fps: 5,
    });
  } catch {
    await fail("browser_unavailable");
    throw new Error("The hosted browser could not stream its view");
  }

  report("loading");
  try {
    await page.goto(session.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMillis,
    });
  } catch {
    await fail("provider_unavailable");
    throw new Error("The provider login page did not load");
  }
  report("waiting");

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
    const cookies = await context.cookies();
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

  return {
    input: (input) => {
      inputQueue = inputQueue.then(() => applyInput(page, input)).catch(() => undefined);
    },
    close,
  };
}

async function installEgressPolicy(
  context: BrowserContext,
  allowedOrigins: ReadonlySet<string>,
): Promise<void> {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") {
      return route.continue();
    }
    if ((url.protocol === "http:" || url.protocol === "https:") && allowedOrigins.has(url.origin)) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(
    () => true,
    (socket) => {
      const url = new URL(socket.url());
      if (allowedOrigins.has(url.origin)) {
        socket.connectToServer();
      } else {
        void socket.close({ code: 1008, reason: "Blocked by the linking egress policy" });
      }
    },
  );
}

async function applyInput(page: Page, input: HostedBrowserInput): Promise<void> {
  switch (input._tag) {
    case "Click":
      await page.mouse.click(
        Math.round(input.x * browserViewport.width),
        Math.round(input.y * browserViewport.height),
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

function chromiumArguments(
  allowedOrigins: ReadonlyArray<string>,
  chromiumSandbox: boolean,
): string[] {
  const hosts = allowedOrigins
    .map((origin) => new URL(origin).hostname)
    .filter((host) => host !== "");
  return [
    ...(chromiumSandbox ? [] : ["--no-sandbox"]),
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-features=NetworkPrediction,OptimizationHints,MediaRouter",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-pings",
    "--password-store=basic",
    `--host-resolver-rules=MAP * ~NOTFOUND${hosts.map((host) => `, EXCLUDE ${host}`).join("")}`,
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
