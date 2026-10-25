# Hosted browser linking infrastructure

Status: the dedicated hosted browser service is **deployed** for the
`cloud-run` stage in `lineupkeep-prod` / `us-east1`. The local node target still
runs an in-process Playwright browser for development and tests; the Cloudflare
target remains `hosted_browser.unsupported`. A live Yahoo sign-in through the
deployed app is the remaining acceptance step.

The owner accepted transient keystroke relay in
[DECISIONS.md](DECISIONS.md#round-11--transient-keystroke-relay-in-the-hosted-browser).

## Topology

```text
user browser
  │  WSS: owner session + path-scoped one-use ticket cookie
  ▼
web service (public, authenticated)
  │  WSS: Cloud Run ID token + HMAC-signed one-use session descriptor
  ▼
hosted browser service (IAM-only, Cloud Run)
  │  HTTPS/WSS: exact provider and asset origins only
  ▼
provider login and assets
```

The web service stays the authority for application sessions, connection
ownership, completion, team discovery, and credential encryption. The browser
service is stateless apart from one live Chromium process and its temporary
profile. It never receives database credentials, the connection encryption key,
the application auth secret, or any other application setting.

The web proxies the browser WebSocket. The browser never connects directly to
the hosted browser service, so the service has no public application surface and
the web enforces owner, ticket, rate-limit, and session-lifecycle checks in one
place.

## Service shape (deployed)

| Property        | Value                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service         | `lineupkeep-hb` — `https://lineupkeep-hb-hcfc7y3kha-ue.a.run.app`                                                                                                 |
| Revision        | `lineupkeep-hb-00004-tb2` (fourth revision; earlier revisions were the first deployment and reviewed code follow-ups)                                             |
| Runtime account | `alchemgx4kg3sc7lv6v6t2vmqz6g6v@lineupkeep-prod.iam.gserviceaccount.com`                                                                                          |
| Access          | `run.googleapis.com/ingress=all` plus IAM required; only the web runtime account holds `roles/run.invoker`. Unauthenticated callers are refused by Cloud Run IAM. |
| Scaling         | min 0, max 2, `containerConcurrency: 1`, request timeout 780 s, startup CPU boost, request-based billing with CPU throttling                                      |
| Resources       | 1 vCPU / 2 GiB, `/healthz` startup probe every 5 s with 30 attempts                                                                                               |
| Image           | `us-east1-docker.pkg.dev/lineupkeep-prod/lineupkeepweb-registry-cloud-run-u4rplfecdzi27v3w/browser:<content-hash>` (~853 MB)                                      |
| Secret          | `lineupkeepweb-secret-hosted-browser-descriptor-key-cloud-run-ifx5uoc5omsxeu74`, read by both the web and browser runtime accounts                                |
| Configuration   | `HOSTED_BROWSER_URL` (plain) and the descriptor secret on the web service; only the descriptor secret and `NODE_ENV` on the browser                               |

The image installs the pinned Playwright Chromium headless shell and its OS
dependencies (`playwright install --with-deps chromium`), keeps only the
headless shell and drops the unused full Chromium and ffmpeg trees, runs as the
non-root `node` user, and exposes one HTTP port. Cloud Run mounts only `/tmp`;
the temporary profile lives there and no volume is attached.

## Session lifecycle

1. The web starts the existing owner-bound hosted linking session: rate limit,
   one-active-session lock, connection record, hashed one-use ticket, and
   ten-minute expiry.
2. The web sets the ticket only in an HttpOnly, `SameSite=Strict`, path-scoped,
   Secure cookie. The response body contains the session id and stream path,
   never the ticket.
3. The user's browser opens WSS to the web. The web authorizes the application
   session, owner, ticket hash, and active status.
4. The web opens WSS to the browser service with a Cloud Run ID token minted
   from the metadata server for exactly the service URL audience, plus a signed
   descriptor. The descriptor is an HMAC-SHA-256 envelope over a payload that
   carries only the session id, expiry (at most 15 minutes out), login URL, and
   allowed origins. The service verifies the signature, the bounded lifetime,
   that every origin is a known provider origin, and that the login URL origin
   is one of them.
5. The service remembers used session ids for its lifetime and allows at most
   one open browser per instance. It launches a fresh temporary profile,
   streams bounded JPEG frames and status messages, and relays bounded input.
   Input that arrives before Chromium is ready is buffered up to 64 messages.
6. When the provider session cookies are observed, the service kills Chromium,
   removes the profile, then sends the captured material to the web over the
   authenticated stream. The web validates it, completes the connection,
   discovers teams, and returns `Ready`.
7. Cancel, disconnect, expiry, or a browser fault terminates the stream, kills
   Chromium, removes the profile, and cancels or expires the session. The web
   remains the source of truth and all operations are idempotent.

The service sends only `Status`, `Captured`, `Failed`, and `Expired` control
messages plus binary frames. Session material is sent once, after the browser is
gone, and is never logged. The web proxy maps the transport onto the existing
hosted-linking callbacks, so the stream, UI, and completion behavior are
unchanged.

## Egress policy

The service is not a general proxy and cannot reach application-private
services, link-local addresses, the metadata server, or arbitrary public hosts.

- Every request passes an exact origin allowlist for the provider login and
  asset origins (`login.yahoo.com`, `www.yahoo.com`, `guce.yahoo.com`,
  `s.yimg.com`, `geo.yahoo.com`, `api.login.yahoo.com`, and the football and
  hockey fantasy origins). Redirects, downloads, popups, and service workers are
  closed; `data:`, `blob:`, and `about:` are allowed for page assets only.
  WebSockets are subject to the same origin set.
- Chromium's resolver rule maps every other hostname to `~NOTFOUND`, so a
  non-allowlisted host cannot be resolved at all. IP-literal destinations
  (including `169.254.169.254`, loopback, and private ranges) fail the origin
  check.
- No VPC connector, Cloud NAT, or generic HTTP proxy is provisioned. That
  network-level defense in depth would add a recurring charge above the owner's
  CAD 5/month budget; the application-level allowlist is the enforced boundary
  and this limitation is recorded rather than presented as network isolation.
- The browser tests prove a non-allowlisted origin is never contacted, that the
  profile is removed on capture, expiry, cancel, and shutdown, and that no
  frames or session material are logged.

## Limits and abuse controls

- Five starts per user per ten minutes; one active hosted session per user.
- `containerConcurrency: 1` and `maxInstanceCount: 2` bound global capacity; a
  second browser on an instance is refused with a retryable busy signal rather
  than queued.
- No unauthenticated invoker. The session is bound to the authenticated owner and
  the descriptor is one-use and short-lived.
- Five frames per second, JPEG quality 55, 1.5 MB per frame, 500 client control
  messages with 4 KB each, 2,000 service input messages, and a ten-minute
  session wall clock.
- The web caps upstream reconnects and tears down the upstream stream when the
  client disconnects.

## Alchemy composition

[cloudRun.ts](../../infra/hosts/cloudRun.ts) composes, in the same `cloud-run`
stage as the web and worker:

- `BuildHostedBrowser` / `HostedBrowserImage` from
  [hostedBrowser.ts](../../infra/build/hostedBrowser.ts) and the
  [browser Dockerfile](../../apps/hosted-browser/deploy/Dockerfile), published by
  `PublishHostedBrowserImage` through the existing Artifact Registry repository.
- `HostedBrowserRuntime` service account, `HostedBrowser` Cloud Run service,
  and `HostedBrowserInvoker` binding for the web runtime account.
- `Secret-HOSTED_BROWSER_DESCRIPTOR_KEY` and one secret accessor per runtime
  account plus an immutable version.
- `HOSTED_BROWSER_URL` and the descriptor secret reference in the web
  container. No other secret is added to the browser service.

The image build and publish are content-hashed; the descriptor version is
republished on every deploy like the other runtime secrets.

## Deployment and operating gates

Proven during the first deployment and operator probe:

- The service deploys scale-to-zero, reaches `Ready`, and its startup probe
  succeeds against `/healthz`.
- Unauthenticated requests are refused by Cloud Run IAM (request log: "The
  request was not authenticated"), while the web runtime account holds the only
  `roles/run.invoker` binding.
- A WebSocket session through Cloud Run completed the descriptor handshake,
  streamed 7 JPEG frames (first frame 4,941 bytes), reported `starting`,
  `loading`, and `waiting`, and loaded the real Yahoo login page through the
  service's egress before the operator closed it.
- Cloud Logging contains only the service's lifecycle record
  (`hosted_browser.session`, outcome, duration, session id) plus Cloud Run's
  platform lines. No frames, cookies, keystrokes, page text, or passwords.

Remaining acceptance and hardening:

- A human-owned live Yahoo sign-in through the deployed web app, including team
  discovery and the no-manual-refresh transition, is still required.
- Cold and warm start timings are recorded in
  [the deployment runbook](../deployment.md#cold-starts-and-cost): 9.4 s to the
  first frame cold versus 0.8 s warm. Actual per-session billing is still an
  estimate until the first invoice or billing export.
- Network-level egress isolation (VPC connector plus NAT or an egress proxy) is
  deferred for budget reasons; the application allowlist is the current
  boundary.
- Chromium's sandbox is unavailable in the Cloud Run runtime; the accepted
  `--no-sandbox` posture and compensating controls are recorded in
  [DECISIONS.md](DECISIONS.md#round-11--transient-keystroke-relay-in-the-hosted-browser).

## Rollback

Removing `HOSTED_BROWSER_URL` from the web service (or deploying the previous
web revision) returns hosted linking to `hosted_browser.unsupported`; the local
helper path is unaffected. The browser service can then be scaled to zero or
deleted with its image. No data migration is required: the browser service
stores nothing, and only the web process holds connection state.
