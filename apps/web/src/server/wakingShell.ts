import { productName } from "@lineupkeep/brand/product";
import { EffectString } from "@lineupkeep/collections";
import { Data, Duration, Effect } from "effect";

export function renderWakingShell(
  request: Request,
  options: WakingShellOptions,
): Promise<Response> {
  if (!isDocumentNavigation(request)) {
    return options.render(request);
  }
  return Effect.runPromise(wakingOutcome(request, options)).then((outcome) => {
    switch (outcome.status) {
      case "rendered":
        return outcome.response;
      case "failed":
        throw outcome.error;
      case "waking":
        return wakingShellResponse(request);
    }
  });
}

export function wakingShellResponse(request: Request): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "x-lineupkeep-waking": "1",
    vary: "Accept",
  });
  return new Response(request.method === "HEAD" ? null : wakingShellDocument(request.url), {
    status: 200,
    headers,
  });
}

export function wakingShellDocument(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${productName} is waking</title>
<style>${shellStyles}</style>
</head>
<body>
<div class="page">
<header><span class="wordmark">${wordmark}</span></header>
<main>
<div class="panel">
<p class="eyebrow" id="waking-state">Starting up</p>
<h1 id="waking-heading">${productName} is waking.</h1>
<p id="waking-message" role="status" aria-live="polite">Nothing has been read yet.</p>
<p class="retry"><a id="waking-retry" href="${escapeAttribute(url.pathname + url.search)}">Try again</a></p>
</div>
</main>
</div>
<script>${shellScript}</script>
</body>
</html>
`;
}

function wakingOutcome(
  request: Request,
  options: WakingShellOptions,
): Effect.Effect<RenderOutcome> {
  const rendered = Effect.tryPromise({
    try: (signal) =>
      options.render(new Request(request, { signal: AbortSignal.any([request.signal, signal]) })),
    catch: (cause) => new PageRenderFailed({ cause }),
  }).pipe(
    Effect.match({
      onFailure: (failure): RenderOutcome => ({ status: "failed", error: failure.cause }),
      onSuccess: (response): RenderOutcome => ({ status: "rendered", response }),
    }),
  );
  const deadline = Effect.sleep(Duration.millis(options.deadlineMs)).pipe(
    Effect.as<RenderOutcome>({ status: "waking" }),
  );
  return Effect.raceFirst(rendered, deadline);
}

function isDocumentNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const { pathname } = new URL(request.url);
  if (
    EffectString.startsWith(pathname, "/api/") ||
    pathname === "/mcp" ||
    EffectString.startsWith(pathname, "/.well-known/")
  ) {
    return false;
  }
  return EffectString.includes(request.headers.get("accept") ?? "", "text/html");
}

function escapeAttribute(value: string): string {
  return EffectString.replaceAll(
    EffectString.replaceAll(EffectString.replaceAll(value, "&", "&amp;"), '"', "&quot;"),
    "<",
    "&lt;",
  );
}

const wordmark = EffectString.toLowerCase(productName);

export type WakingShellOptions = {
  readonly deadlineMs: number;
  readonly render: (request: Request) => Promise<Response>;
};

class PageRenderFailed extends Data.TaggedError("PageRenderFailed")<{
  readonly cause: unknown;
}> {}

type RenderOutcome =
  | { readonly status: "rendered"; readonly response: Response }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "waking" };

const shellStyles = `
:root{color-scheme:light dark;--canvas:#f4efe4;--ink:#141217;--ink-soft:#6a6470;--rule:#cdc5b7;--rule-strong:#141217;--action:#5b21b6;--action-hover:#4c1d95;--on-action:#fffdf7}
@media (prefers-color-scheme:dark){:root{--canvas:#17122a;--ink:#efeafc;--ink-soft:#b3a4d8;--rule:#34285c;--rule-strong:#b9a6e8;--action:#c4b5fd;--action-hover:#d8c6ff;--on-action:#17122a}}
*{box-sizing:border-box}
html,body{min-height:100%}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
.page{display:flex;flex-direction:column;width:100%;max-width:42.5rem;min-height:100svh;margin:0 auto;padding-left:max(1rem,env(safe-area-inset-left));padding-right:max(1rem,env(safe-area-inset-right))}
header{display:flex;align-items:center;min-height:3rem;border-bottom:3px solid var(--rule-strong)}
.wordmark{font-size:0.6875rem;font-weight:600;letter-spacing:0.16em;text-transform:lowercase}
main{display:flex;flex:1;padding-top:clamp(2.5rem,8vh,5rem);padding-bottom:2rem}
.panel{max-width:32rem;padding-top:1.25rem;border-top:3px solid var(--rule-strong)}
.eyebrow{margin:0 0 0.75rem;font-size:0.6875rem;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-soft)}
h1{margin:0 0 0.75rem;font-size:clamp(2rem,7vw,3.25rem);font-weight:800;line-height:1.08;letter-spacing:-0.035em}
p{margin:0 0 1rem;color:var(--ink-soft)}
.retry{margin:1.5rem 0 0}
.retry a{display:inline-flex;align-items:center;min-height:2.75rem;padding:0.5rem 1.25rem;border:2px solid var(--rule-strong);background:var(--action);color:var(--on-action);font-size:0.6875rem;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;text-decoration:none}
.retry a:focus-visible{outline:0;box-shadow:0 0 0 2px var(--canvas),0 0 0 4px var(--action)}
@media (prefers-reduced-motion:no-preference){.retry a{transition:background-color 140ms ease-out}.retry a:hover{background:var(--action-hover)}}
`;

const shellScript = `
(function () {
  var key = "${wordmark}.waking";
  var now = Date.now();
  var first = 0;
  try { first = Number(sessionStorage.getItem(key)) || 0; } catch (error) {}
  var retrying = first === 0 || now - first > 10000;
  if (retrying) { try { sessionStorage.setItem(key, String(now)); } catch (error) {} }
  var state = document.getElementById("waking-state");
  var heading = document.getElementById("waking-heading");
  var message = document.getElementById("waking-message");
  if (state === null || heading === null || message === null) { return; }
  if (retrying) {
    message.textContent = "Nothing has been read yet. Retrying now\\u2026";
    window.setTimeout(function () { window.location.reload(); }, 1200);
    return;
  }
  state.textContent = "Still waking";
  heading.textContent = "${productName} is taking longer than usual.";
  message.textContent = "Nothing has been read yet. Try again, or come back in a moment.";
})();
`;
