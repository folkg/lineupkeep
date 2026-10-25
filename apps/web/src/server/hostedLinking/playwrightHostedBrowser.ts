import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DateTime, Redacted } from "effect";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";

import {
  browserViewport,
  type HostedBrowserInput,
  type HostedBrowserMessage,
  type HostedBrowserStatus,
} from "#contracts/connections/hostedBrowserProtocol.ts";

import type {
  HostedBrowserCallbacks,
  HostedBrowserFactory,
  HostedBrowserHandle,
  HostedBrowserSession,
} from "./HostedBrowser.ts";

const capturePollMillis = 400;
const navigationTimeoutMillis = 30_000;
const maximumFrameBytes = 1_500_000;

export function createPlaywrightHostedBrowser(
  options: { readonly profileRoot?: string } = {},
): HostedBrowserFactory {
  const live = new Map<string, () => Promise<void>>();
  return {
    open: async (session, callbacks) => {
      if (live.has(session.id)) {
        throw new Error("A hosted browser is already open for this session");
      }
      live.set(session.id, () => Promise.resolve());
      try {
        const handle = await openBrowser(
          session,
          callbacks,
          () => live.delete(session.id),
          options.profileRoot,
        );
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
  callbacks: HostedBrowserCallbacks,
  onClosed: () => void,
  profileRoot: string | undefined,
): Promise<HostedBrowserHandle> {
  const profileDirectory = await mkdtemp(
    join(profileRoot ?? tmpdir(), "lineupkeep-hosted-linking-"),
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

  const report = (message: HostedBrowserMessage): void => {
    if (!closed) {
      callbacks.onMessage(message);
    }
  };
  const status = (value: HostedBrowserStatus): void => {
    report({ _tag: "Status", status: value });
  };
  const fail = async (reason: Parameters<HostedBrowserCallbacks["fault"]>[0]): Promise<void> => {
    if (closed) {
      return;
    }
    report({ _tag: "Failed", reason });
    await close();
    await callbacks.fault(reason).catch(() => undefined);
  };

  status("starting");

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      viewport: browserViewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      locale: "en-US",
      args: chromiumArguments(session.allowedOrigins),
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
      const url = new URL(frame.url());
      status(challengeStatus(url) ?? "waiting");
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
          callbacks.onFrame(new Uint8Array(data));
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

  status("loading");
  try {
    await page.goto(session.loginUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMillis,
    });
  } catch {
    await fail("provider_unavailable");
    throw new Error("The provider login page did not load");
  }
  status("waiting");

  const remaining = DateTime.toEpochMillis(session.expiresAt) - Date.now();
  expiryTimer = setTimeout(
    () => {
      report({ _tag: "Expired" });
      void close()
        .then(() => callbacks.expire())
        .catch(() => undefined);
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
    if (capturePoll !== undefined) {
      clearInterval(capturePoll);
    }
    const completion = await callbacks.complete(Redacted.make(`T=${token.value}; Y=${user.value}`));
    if (completion.status === "ready") {
      report({
        _tag: "Ready",
        connectionId: session.connectionId,
        teamsDiscovered: completion.teamsDiscovered,
      });
    } else {
      report({ _tag: "Failed", reason: completion.reason });
    }
    await close();
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

function chromiumArguments(allowedOrigins: ReadonlyArray<string>): string[] {
  const hosts = allowedOrigins
    .map((origin) => new URL(origin).hostname)
    .filter((host) => host !== "");
  return [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
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

export const playwrightHostedBrowser: HostedBrowserFactory = createPlaywrightHostedBrowser();
