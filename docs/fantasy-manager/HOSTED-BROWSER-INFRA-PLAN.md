# Hosted browser linking infrastructure plan

Status: the local node target runs an in-process Playwright browser and the
local end-to-end test proves the owner-bound session, streamed sign-in, capture,
team discovery, wrong-owner rejection, and replay rejection. The dedicated
production service described here is **not provisioned** and must not be
deployed without owner authorization and the gates below.

## Current state

- `apps/web` on the node target constructs `playwrightHostedBrowser` in the web
  process. Development and tests use the fake provider route; production uses
  Yahoo origins.
- The Cloudflare target returns `hosted_browser.unsupported`; it has no browser
  runtime or WebSocket upgrade path.
- The deployed Cloud Run image was built before this feature and does not
  install Chromium. Treat hosted browser linking as unavailable until the
  service below exists. The local-helper fallback remains functional.
- The browser stores nothing between sessions. Only a SHA-256 ticket hash and
  the normal connection lifecycle are persisted; provider session material is
  captured by the web process and encrypted as before.

## Target topology

```text
user browser
  │  WSS: owner session + path-scoped ticket cookie
  ▼
web service (public, authenticated)
  │  WSS: Cloud Run IAM ID token + short-lived session descriptor
  ▼
hosted-browser service (IAM-private, no public ingress)
  │  HTTPS/WSS: exact provider and asset origins only
  ▼
provider login and assets
```

The web service stays the authority for application sessions, connection
ownership, completion, team discovery, and credential encryption. The browser
service is stateless apart from the live Chromium process and its temporary
profile. It never receives database credentials, the connection encryption key,
or the application auth secret.

The web service proxies the browser WebSocket. The browser never connects
directly to the hosted-browser service, so the service has no public surface and
the web can enforce owner, ticket, rate-limit, and session-lifecycle checks in
one place.

## Service shape

- Cloud Run (or equivalent container runtime), second generation, WebSocket
  capable, `minInstanceCount: 0`, `containerConcurrency: 1` so one instance owns
  at most one browser, and a small `maxInstanceCount` (initially 2–4).
- 1 vCPU / 2 GiB as the starting point; validate Chromium startup, JPEG
  encoding, and memory under a real session before fixing the size. Request
  timeout must cover the ten-minute session plus startup and shutdown.
- No public ingress. The web runtime service account receives
  `roles/run.invoker`; all other callers are rejected by IAM. No unauthenticated
  viewer or WebSocket endpoint.
- The image installs the pinned Playwright Chromium revision and its OS
  dependencies. Run as a non-root user, read-only root filesystem, writable
  `tmpfs` only for the temporary profile and Chromium scratch data. No volume,
  no persisted recording, no shared profile.
- Prefer Chromium's sandbox. If the runtime cannot support it, use the
  narrowest documented `--no-sandbox` configuration only after a security
  review; container isolation alone is not a substitute for an explicit
  decision.
- Health endpoint reports process readiness only. It never exposes session
  state, provider content, or credentials.
- Logs contain session id, lifecycle outcome, duration, and failure class only.
  Access logs omit query strings and headers. No frames, keystrokes, page text,
  cookies, crumbs, passwords, or screenshots. No persisted traces of provider
  content; application traces carry ids and outcomes only.
- Metrics cover active browsers, starts, capture latency, frame bytes, expiry,
  cancellation, and cleanup failures. No provider payload labels.

## Egress policy

The service is not a general proxy and must not reach application-private
services, link-local addresses, the metadata server, or arbitrary public hosts.

- Application-level allowlist: the exact provider login and asset origins
  already used by `providerLoginConfig`, enforced on every request and
  WebSocket. Redirects, downloads, popups, service workers, and non-HTTP(S)
  schemes are denied. `data:`, `blob:`, and `about:` are allowed only for page
  assets, never as a route to another origin.
- Network-level defense in depth: serverless VPC connector plus Cloud NAT for a
  stable egress identity; firewall rules deny `169.254.0.0/16` (including
  `169.254.169.254`), loopback, RFC 1918, IPv6 link-local, and IPv6 ULA
  destinations. Allow only public egress needed by the provider.
- Cloud NAT does not enforce hostnames. If stronger control is required, put an
  egress proxy with an explicit CONNECT/host allowlist in front of the browser
  and keep the application allowlist. Resolve allowlisted names at request time
  and reject private or metadata addresses to reduce DNS-rebinding exposure.
- Do not add a generic URL proxy, arbitrary CDP endpoint, or provider-agnostic
  browser service.

## Session lifecycle

1. The web starts the existing owner-bound hosted linking session: rate limit,
   one-active-session lock, connection record, hashed one-use ticket, and
   ten-minute expiry.
2. The web sets the ticket only in an HttpOnly, `SameSite=Strict`,
   path-scoped, Secure cookie. The response body contains the session id and
   stream path, never the ticket.
3. The user's browser opens WSS to the web. The web authorizes the application
   session, owner, ticket hash, and active status.
4. The web opens WSS to the hosted-browser service with a Cloud Run IAM ID
   token and a short-lived signed descriptor containing only the session id,
   expiry, login URL, and allowed origins. The service rejects anything else.
5. The service creates a fresh temporary profile, launches Chromium, streams
   JPEG frames and status messages, and relays bounded input.
6. When the required provider session material is observed, the service sends
   it to the web over the authenticated stream, then immediately closes the
   browser and removes the profile. The web validates the session, completes
   the connection, discovers teams, and returns `Ready`.
7. Cancel, disconnect, expiry, or a browser fault terminates the stream, kills
   Chromium, removes the profile, and cancels or expires the session. The web
   remains the source of truth and all operations are idempotent.

The browser is killed as soon as session material is captured, even if the
client is slow to acknowledge. A failed completion is reported as an
actionable failure; the browser is not left open for retries.

## Limits and abuse controls

- Five starts per user per ten minutes; one active hosted session per user.
- Global concurrency bounded by `maxInstanceCount`; reject rather than queue
  indefinitely when capacity is exhausted.
- Five frames per second, bounded JPEG quality and frame size, bounded input
  message count and size, and a per-session ten-minute wall clock.
- No anonymous starts. The session is bound to the authenticated owner and the
  ticket is one-use and short-lived.
- The web service caps upstream WebSocket reconnects and tears down an upstream
  stream when the client disconnects.

## Alchemy composition (plan only)

- Add a hosted-browser service to `infra/hosts/cloudRun.ts`: image build,
  dedicated runtime service account, internal ingress/IAM invoker, VPC
  connector, NAT/firewall dependencies, scaling, timeout, and environment for
  the provider allowlist. Do not expose it through Cloudflare.
- Add a browser image build (Playwright Chromium and OS dependencies) alongside
  the shared Node image build. Pin the browser revision with the dependency
  lockfile; publish the image through the existing registry.
- Wire the service URL and invoker identity through `infra/stage.ts` to the web
  runtime as `HOSTED_BROWSER_URL`. The local node target keeps its in-process
  factory; the Cloudflare target stays unsupported.
- Store any descriptor-signing key in Secret Manager with least privilege. Do
  not add the application database URL or connection encryption key to the
  browser service.
- Plan output must show only creations or reviewed updates; no existing
  resource is adopted implicitly. No apply until the gates are met.

## Deployment gates

- Owner authorization, billing/budget review, and a fresh plan review.
- A human-run live Yahoo sign-in with a test account; automated tests must keep
  using the fake provider.
- Prove WebSocket upgrade and ten-minute streaming through the web proxy, IAM,
  and any ingress in front of Cloud Run, including cold start and disconnect.
- Prove metadata, link-local, private, and non-allowlisted egress is blocked
  from inside the browser service, and that allowed provider assets load.
- Verify profile removal after success, cancel, expiry, client disconnect, and
  service shutdown; verify no frame or credential appears in logs, traces, or
  artifacts.
- Verify image size, startup time, memory, concurrency, and cost at the planned
  limits. Keep the service dark and the local helper available until all gates
  pass.
- Rollback is disabling the hosted path (returning `hosted_browser.unsupported`
  or removing the service URL) and leaving the helper path intact. No data
  migration is required.

## Open decisions

- Whether the web proxy or a direct browser-to-service connection is preferable
  after measuring WebSocket latency and Cloud Run limits. The web proxy is the
  recommended default because it keeps the service private and centralizes
  authorization.
- Whether an egress proxy is required in addition to firewall rules and the
  application allowlist.
- The accepted Chromium sandbox mode for the chosen runtime.
- Initial `maxInstanceCount` and whether starts should wait for a cold instance
  or fail with a retryable message.
