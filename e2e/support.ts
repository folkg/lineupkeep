import { randomInt, randomUUID } from "node:crypto";

import {
  test as base,
  expect,
  type BrowserContextOptions,
  type Page,
  type Request,
} from "@playwright/test";
import { Schema } from "effect";

import { mcpEndpoint, authorizedMcp, type AuthorizeMcp } from "./mcpClient.ts";
import { namePage, pagePersona } from "./persona.ts";
import { serviceOperations, type ServiceSetup, ServiceIdentity } from "./serviceSetup.ts";
import { postgresProbe } from "./verify/databaseActivity.ts";
import {
  describeServerRequest,
  CallObserver,
  measurer,
  profiler,
  type Measure,
  type Profile,
} from "./verify/performance.ts";
export const test = base.extend<{
  services: ServiceSetup;
  mcp: AuthorizeMcp;
  newUser: (persona?: string, options?: BrowserContextOptions) => Promise<Page>;
  measure: Measure;
  profile: Profile;
  callObserver: CallObserver;
}>({
  callObserver: async ({ baseURL: _baseURL }, use) => {
    await use(new CallObserver());
  },
  mcp: async ({ page, baseURL, callObserver }, use, info) => {
    if (baseURL === undefined) {
      throw new Error("MCP authorization needs the configured baseURL.");
    }
    await use(authorizedMcp(page, mcpEndpoint(baseURL), info, signIn, callObserver));
  },
  services: async ({ baseURL, callObserver }, use) => {
    if (baseURL === undefined) {
      throw new Error("Service operations need the configured baseURL.");
    }
    await use(
      serviceOperations(baseURL, (persona) => signInHeadlessly(baseURL, persona), callObserver),
    );
  },
  newUser: async ({ browser }, use, info) => {
    const resources = new AsyncDisposableStack();
    const pages: Array<Page> = [];
    const pageErrors: Array<string> = [];
    resources.defer(() => {
      expect(pageErrors, "uncaught page errors for other Users").toEqual([]);
    });
    try {
      await use(async (persona = `user ${pages.length + 2}`, options = {}) => {
        const context = await browser.newContext({
          ...options,
          extraHTTPHeaders: { "X-Forwarded-For": uniqueClientAddress() },
          ...(process.env["VERIFICATION_VIDEO"] === "true"
            ? { recordVideo: { dir: info.outputPath(`video-user-${pages.length + 2}`) } }
            : {}),
        });
        let page: Page | undefined;
        const index = pages.length;
        resources.defer(async () => {
          try {
            await context.close();
          } finally {
            const video = await page?.video()?.path();
            if (video !== undefined) {
              await info.attach(`video: user ${index + 2}`, {
                path: video,
                contentType: "video/webm",
              });
            }
          }
        });
        page = await context.newPage();
        namePage(page, persona);
        const label = persona;
        page.on("pageerror", (error) => pageErrors.push(`${label}: ${String(error)}`));
        pages.push(page);
        return page;
      });
    } finally {
      await resources.disposeAsync();
    }
  },
  measure: async ({ callObserver, baseURL }, use, info) => {
    if (baseURL === undefined) {
      throw new Error("Measurement needs the configured baseURL.");
    }
    await use(
      measurer(callObserver, info, baseURL, postgresProbe(databaseUrl()), (over) => {
        expect
          .soft(over.durationMs, `"${over.name}" #${over.sample} within its budget`)
          .toBeLessThanOrEqual(over.budgetMs);
      }),
    );
  },
  profile: async ({ callObserver, baseURL }, use, info) => {
    if (baseURL === undefined) {
      throw new Error("Profiling needs the configured baseURL.");
    }
    await use(profiler(callObserver, info, baseURL, undefined, postgresProbe(databaseUrl())));
  },
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    await use({ ...extraHTTPHeaders, "X-Forwarded-For": uniqueClientAddress() });
  },
  page: async ({ page, callObserver }, use) => {
    callObserver.browser = { page, openSession: () => page.context().newCDPSession(page) };
    const pageErrors: Array<string> = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await use(page);
    callObserver.browser = undefined;
    expect(pageErrors, "uncaught page errors").toEqual([]);
  },
});

export { expect };

export async function useFreshClientAddress(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": uniqueClientAddress() });
}

export async function signUp(page: Page, persona = pagePersona(page)): Promise<Account> {
  namePage(page, persona);
  return base.step(`Setup (browser) [${persona}]: sign in`, async () => {
    const account = { email: `e2e-${randomUUID()}@example.com` };
    await page.goto("/auth");
    await signIn(page, account);
    await expect(page).toHaveURL("/account");
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    return account;
  });
}

export async function signIn(page: Page, account: Account): Promise<void> {
  const code = await requestCode(page, account.email);
  await page.getByLabel("Code").fill(code);
  await page.getByRole("main").getByRole("button", { name: "Sign in" }).click();
}

export async function requestCode(page: Page, email: string): Promise<string> {
  const delivered = (await inboxFor(email)).length;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email." })).toBeVisible();
  return waitForCode(email, delivered);
}

async function signInHeadlessly(origin: string, persona: string): Promise<ServiceIdentity> {
  return ServiceIdentity.signIn(origin, persona, uniqueClientAddress(), async (email, send) => {
    const delivered = (await inboxFor(email)).length;
    await send();
    return waitForCode(email, delivered);
  });
}

async function waitForCode(email: string, delivered: number): Promise<string> {
  let messages: ReadonlyArray<InboxMessage> = [];
  await expect
    .poll(async () => {
      messages = await inboxFor(email);
      return messages.length;
    })
    .toBeGreaterThan(delivered);
  const code = /\b(\d{6})\b/u.exec(messages.at(-1)?.text ?? "")?.[1];
  expect(code, "a six-digit code in the delivered email").toBeDefined();
  return code ?? "";
}

async function inboxFor(email: string): Promise<ReadonlyArray<InboxMessage>> {
  const inbox = new URL("/inbox", process.env["RESEND_API_BASE_URL"]);
  inbox.searchParams.set("to", email);
  const response = await fetch(inbox);
  return Schema.decodeSync(Inbox)(await response.text());
}

const Inbox = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ subject: Schema.String, text: Schema.String })),
);

export function recordServerRequests(page: Page): ServerRequests {
  const recorded: Array<string> = [];
  const inFlight = new Set<Request>();
  const settle = (request: Request): void => {
    inFlight.delete(request);
  };
  page.on("request", (request) => {
    const description = describeServerRequest(request);
    if (description === undefined) {
      return;
    }
    recorded.push(description);
    inFlight.add(request);
  });
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);

  const waitForCompletion = (): Promise<void> =>
    expect.poll(() => inFlight.size, { message: "all observed server functions complete" }).toBe(0);

  return {
    during: async (action) => {
      await waitForCompletion();
      const start = recorded.length;
      await action();
      await waitForCompletion();
      return recorded.slice(start);
    },
  };
}

function uniqueClientAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

function databaseUrl(): string {
  const value = process.env["DATABASE_URL"];
  if (value === undefined) {
    throw new Error("DATABASE_URL is required; run through `bun run verify`.");
  }
  return value;
}

export type Account = {
  readonly email: string;
};

type InboxMessage = (typeof Inbox.Type)[number];

export type ServerRequests = {
  readonly during: (action: () => Promise<void>) => Promise<ReadonlyArray<string>>;
};
