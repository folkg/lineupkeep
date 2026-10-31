import { describe, expect, it } from "vitest";

import { renderWakingShell, wakingShellDocument } from "./wakingShell.ts";

describe("waking shell document", () => {
  it("shows the page frame and claims no data", () => {
    const document = wakingShellDocument("https://app.example.com/teams?view=mine");

    expect(document).toContain('<html lang="en">');
    expect(document).toContain("Lineupkeep is waking.");
    expect(document).toContain('id="waking-message" role="status" aria-live="polite"');
    expect(document).toContain('href="/teams?view=mine"');
    expect(document).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(document).not.toMatch(/your teams|signed in|roster|scoring period/i);
    expect(document).not.toContain("autofocus");
    expect(document).not.toMatch(/https?:\/\//u);
  });

  it("keeps the retry target on the requested page", () => {
    const document = wakingShellDocument('https://app.example.com/teams?note="<x>');

    expect(document).toContain('href="/teams?note=%22%3Cx%3E"');
  });
});

describe("waking shell response", () => {
  it("passes a prompt render through untouched", async () => {
    const rendered = new Response("rendered", { headers: { "x-render": "1" } });

    const response = await renderWakingShell(navigation(), {
      deadlineMs: 50,
      render: () => Promise.resolve(rendered),
    });

    expect(response).toBe(rendered);
  });

  it("answers a stalled navigation and cancels the render", async () => {
    let renderSignal: AbortSignal | undefined;

    const response = await renderWakingShell(navigation("/teams?view=mine"), {
      deadlineMs: 5,
      render: (request) => {
        renderSignal = request.signal;
        return Promise.withResolvers<Response>().promise;
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-lineupkeep-waking")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('href="/teams?view=mine"');
    expect(renderSignal?.aborted).toBe(true);
  });

  it("returns a header-only response for a HEAD navigation", async () => {
    const response = await renderWakingShell(navigation("/", "HEAD"), {
      deadlineMs: 5,
      render: () => Promise.withResolvers<Response>().promise,
    });

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  it("leaves requests that are not document navigations to the renderer", async () => {
    const requests = [
      new Request("https://app.example.com/teams", {
        method: "POST",
        headers: { accept: "text/html" },
      }),
      new Request("https://app.example.com/api/auth/session", {
        headers: { accept: "text/html" },
      }),
      new Request("https://app.example.com/mcp", { headers: { accept: "application/json" } }),
      new Request("https://app.example.com/.well-known/oauth-protected-resource/mcp", {
        headers: { accept: "text/html" },
      }),
      new Request("https://app.example.com/assets/app.js", { headers: { accept: "text/css" } }),
    ];

    for (const request of requests) {
      const rendered = new Response("rendered", { status: 418 });
      expect(
        await renderWakingShell(request, {
          deadlineMs: 5,
          render: () => Promise.resolve(rendered),
        }),
      ).toBe(rendered);
    }
  });

  it("propagates a render failure that arrives before the deadline", async () => {
    const failure = new Error("render failed");

    await expect(
      renderWakingShell(navigation(), {
        deadlineMs: 50,
        render: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });

  it("discards a render that fails after the waking document answered", async () => {
    const render = Promise.withResolvers<Response>();

    const response = await renderWakingShell(navigation(), {
      deadlineMs: 5,
      render: () => render.promise,
    });

    expect(response.headers.get("x-lineupkeep-waking")).toBe("1");
    render.reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
  });
});

function navigation(path = "/", method = "GET"): Request {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { accept: "text/html,application/xhtml+xml" },
  });
}
