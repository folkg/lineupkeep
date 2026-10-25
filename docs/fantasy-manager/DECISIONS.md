# Agreed decisions from grilling

These records preserve the answers and corrections from all recorded rounds through Round 10. Later rounds refine earlier ones; [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) is the consolidated current scope. Technical recommendations remain subject to final plan approval.

## Round 1 decisions

1. Accepted: Phase 1 includes minimal frontend and scheduled native start-active automation, with the MCP slice delivered first.
2. Accepted: Yahoo NFL/NHL first; other integrations deferred.
3. Corrected: keep shared interfaces minimal and generic. Diamond cohorts and source-specific projection variants are private implementation details. No speculative capability framework is approved.
4. Accepted: state machines coordinate; pure functions calculate and solve.
5. Accepted: provider mechanics and sport/league selection policy are separate concerns.
6. Corrected: completely independent product, with no migration ever. Invitations to old users are not in scope.

## Round 2 decisions

1. Accepted: default-off team automation; distinct disabled, enabled, and paused states; team-level controls initially.
2. Accepted: scheduled work targets the currently actionable provider period, not proactive multi-period editing.
3. Accepted: use comparable scoring evidence; consistent fallback for incomplete projections; preserve affected choices when evidence is insufficient. Zero and missing remain distinct.
4. Accepted: documented scalar heuristic for category leagues; true category-outcome optimization deferred.
5. Accepted: include legal reserve-list moves within the existing roster. Do not execute transactions to resolve blocked moves.
6. Accepted: minimize assignment changes among equal-value legal lineups, then deterministic tie-breaking.
7. Shadow rollout rejected: switch scheduled execution to custom optimization immediately when ready, without another per-team opt-in. Existing enabled/paused/disabled controls still apply.

## Round 3 decisions

1. Corrected: pause lasts only for the rest of the fantasy day. Indefinite suspension is disable, not pause.
2. Accepted: recheck controls before writes; stop queued/in-flight work that has not begun writing; reconcile already-sent writes without automatically undoing them.
3. Accepted: explicit manual MCP requests may run while paused/disabled, without changing automation enrollment.
4. Accepted: automation may replace unlocked manual assignments while enabled; use pause for manual control. No persistent player pins initially.
5. Corrected: do not exclude injured or non-starting players purely on availability grounds. They may fill otherwise empty slots, preferably not displacing players who will play. Scoring-policy design must address this without assuming the old multiplier scheme is best.
6. Corrected: a negative-value player should remain benched in favor of an empty starter slot. The scoring policy determines negative value; occupancy is not an unconditional primary objective.

## Round 4 decisions

1. Accepted: provider fantasy-day rollover bounds pause, even in weekly leagues; resume at the next normal scheduled run. Confirm Yahoo's exact rollover rather than assume fixed PST. Prefer Effect-native date/time handling and keep dependencies low.
2. Accepted explicitly in follow-up: legality/locks, total signed selection value, zero-value filling, minimum changes, deterministic tie-break. Empty is zero; missing is not zero.
3. Accepted with emphasis: participation preference belongs in the sport/league policy, not in the sport/provider-agnostic solver. Carefully address baseball starter/reliever edge cases when MLB is added.
4. Strengthened: scoring controls should not exist as a user-facing product feature. Scoring is opinionated and built into the appropriate abstraction layers.

## Round 5 decisions

1. Accepted: separate provider-connection, team-automation, and lineup-run machines.
2. Accepted with clarification: a team is the atomic recovery/outcome unit, but provider adapters should batch compatible operations, including writes if supported, to minimize API calls. Provider mechanics and rollover rules can differ. The old Yahoo implementation accepts an array but loops over one PUT per team; it does not demonstrate cross-team write batching.
3. Accepted: hourly scheduled checks initially; finer pre-game scheduling deferred.
4. Accepted: reconcile unfinished writes and collapse missed ticks into fresh current-period work rather than replaying stale edits.
5. Accepted with addition: retain enrollment and require explicit reconnect; show UI status and email the user when action is required.
6. Accepted: last-run status and small recent activity inline with teams.
7. Hosting reopened: compare Cloudflare, GCP, and AWS; recurring free-tier fit is preferred where practical, with Alchemy compatibility required.

## Round 6 decisions

1. Cloudflare-first recommendation rejected for launch: choose Cloud Run first. Actual initial audience is the user with five teams. Optimize GCP cold starts; reconsider Cloudflare only if expansion makes it worthwhile.
2. Accepted as a sizing/test scenario: model 100 enabled teams, not as a claim about launch usage. Actual initial workload is five teams.
3. Accepted: scale-to-zero cold starts rather than always-warm capacity initially.
4. Accepted: one action-required email per unresolved connection incident, with no repeated reminder campaign initially.

## Round 7 decisions

1. Accepted: Cloud Run + a fresh independently owned Neon Free PostgreSQL project. Recurring free-tier fit is required, not merely minimizing a paid baseline. Cloud SQL has no ongoing free PostgreSQL instance allowance and is not selected. Verify the complete stack's quotas rather than relying on temporary trial credits.
2. Accepted: separate public web/MCP and IAM-protected background Cloud Run services, shared domain implementation, both scale-to-zero.
3. Accepted: starter passwordless email-code sign-in, with first successful sign-in creating the account; no password authentication implementation.
4. Allowlist rejected: proper open registration from launch. Do not build allowlist, invitation-only, or owner-only registration gates. Ordinary authentication, authorization, and abuse controls still apply.

## Round 8 decisions

1. Accepted: one generic public `set_lineup` operation across phases. Phase 1 uses provider-native start-active behavior; Phase 2 uses the custom optimizer. Results identify the implementation used without promising perfect real-world outcomes.
2. Accepted: manual requests normally return verified results, but return a durable run reference after a bounded wait. Clients can query status; disconnecting a request does not lose an accepted job. MCP remains stateless.
3. Accepted: retain configuration for teams that become inaccessible, mark them unavailable, and suppress writes rather than deleting configuration or repeatedly attempting writes. Newly discovered teams remain disabled.
4. Accepted: retain concise run outcomes/explanations for 30 days, minimal normalized diagnostic inputs for 7 days, and no raw provider-response dumps by default. No credentials in history, logs, or email.

## Round 9 — Local-helper pairing mechanism

Status: chosen and proved locally against the installed Better Auth 1.7.12 auth layer. The app-side pairing lifecycle and the first-party helper client land with the connection vertical; this record fixes the mechanism so that vertical does not invent a competing flow.

### Chosen mechanism

Use the OAuth 2.0 Device Authorization Grant (RFC 8628) from the installed `@better-auth/oauth-provider` (`oauthDeviceAuthorization()`), paired with the existing `mcp()` OAuth provider. The helper is a first-party public client; completion yields a short-lived access token scoped to the helper scope rather than a full account session.

The helper initiates, the signed-in application user approves, and the helper redeems the scoped token. The application's pairing/connection record binds the approval to the authenticated owner and tracks the lifecycle.

### Flow: who holds what

1. **Helper starts.** `POST /api/auth/device/code` with the helper's public `client_id` and the helper scope. The helper keeps `device_code` in its own memory or private state and shows the user only the public `user_code` and verification URL.
2. **User approves.** The user opens the verification URL in a browser, signs in to Lineupkeep if needed through the existing email code, reviews the helper name and requested scope, then approves or denies. The first authenticated user to claim the `user_code` becomes the attempt owner; the application records the pairing attempt for that owner.
3. **Helper completes.** The helper polls `POST /api/auth/oauth2/token` with the device grant at the advertised interval. On approval it receives a Bearer access token scoped to the helper scope and expiring within 300 seconds. It stores the token in private local state (mode 0600 file or OS keychain), never logs it or passes it as a shell argument, and uses it only for the provider-credential upload.
4. **Application.** A different signed-in person cannot approve the claimed request. The device code is consumed atomically at redemption. The helper token is revoked after the upload, or expires on its own.

### Expiry, replay, and ownership properties

- **Expiry:** device codes expire after ten minutes. Redemption after expiry deletes the code and returns `expired_token`.
- **One-use:** redemption uses an atomic claim; replay returns `invalid_grant`. Both are proved.
- **Wrong owner:** approval requires an authenticated session, the first authenticated claim binds the code to that user, and another signed-in user receives `access_denied`. Unauthenticated approval is rejected.
- **No bearer secrets in shell arguments or logs:** the only value the person transfers is the public `user_code`; the device code and access token remain in helper-controlled state.
- **No browser extension, hosted login, remote CDP, or custom auth protocol:** the helper opens the application's own approval page in an ordinary browser; the standard RFC 8628 endpoints are served by the existing auth layer.
- **Dedicated provider browser profile:** unchanged. The helper's temporary local browser profile is for the provider's own sign-in while linking credentials, not for application pairing.

### Rejected alternatives

- **Standalone `deviceAuthorization()`:** the same endpoints but returns a full Better Auth session token, which is broader than the scoped OAuth access token and not independently revocable from the browser session.
- **`one-time-token`:** the token is a copy of the existing browser session's long-lived token, requires transferring a bearer secret from the application UI to the helper, and is not scoped.
- **`email-otp`:** proves control of the email address rather than approval from the authenticated session, and conflates pairing with sign-in.
- **`magic-link`:** a bearer link delivered by email is not a helper-held proof and is not one-use for a second device.
- **Custom pairing code/proof protocol, browser extension, hosted browser login, remote CDP:** unnecessary for helper pairing where a supported flow fits. Round 10 supersedes the hosted-browser rejection for the primary provider-linking flow; it does not change the helper contract.

### Helper responsibilities

- Keep the device code and access token out of argv, logs, telemetry, and shell history; store the token privately.
- Show only the public user code and verification URL; never request the provider password.
- Poll at the server-advertised interval and stop on denial or expiry.
- Use the token only for the provider-credential upload, then discard it and revoke the session it established.
- Use a dedicated temporary local browser profile for the provider's own login and never export that profile.

### Proof

`packages/backend/src/contexts/auth/internal/DevicePairing.test.ts` exercises start → claim → wrong-owner rejection → approve → scoped redemption → replay rejection → expiry rejection against the installed auth layer with a fake client-metadata transport and no live provider or network. The production adapter enables `oauthDeviceAuthorization()` with a ten-minute code and five-second polling interval. The first-party helper client and the application pairing lifecycle are delivered by the pairing vertical.

## Round 10 — Hosted browser linking

Status: chosen and proved locally with a fake provider. The owner rejected
local-helper-first onboarding: it requires an install, copying a pairing code,
a second approval, does not refresh the provider session, and does not discover
teams until the helper finishes. Hosted browser linking is now the primary flow;
the RFC 8628 local helper remains the fallback.

This round supersedes the Round 9 rejection of **hosted browser login and remote
CDP** for provider linking only. That rejection still describes helper pairing:
the helper does not need a hosted browser or remote CDP to pair with the
application. The helper flow, scoped token, and ten-minute device-code contract
are unchanged.

### Chosen mechanism

- A click on **Connect Yahoo** creates an owner-bound, one-use hosted linking
  session. The session expires within ten minutes, is rate-limited, and is the
  only open hosted session for that owner.
- The browser receives a one-use ticket as an HttpOnly, `SameSite=Strict`,
  path-scoped cookie. The response body and URL contain only the session id and
  stream path; the ticket is never exposed to JavaScript, logs, or the client.
  Only a SHA-256 hash of the ticket is stored.
- A fresh Chromium profile is launched per session. The provider page is
  streamed as bounded JPEG frames over an authenticated WebSocket and input is
  relayed as bounded click, text, key, and scroll messages. Passwords are
  relayed transiently to the provider page and are never stored, logged, traced,
  or written to disk by this application.
- Chromium egress is restricted to the exact provider login and asset origins.
  Redirects, downloads, popups, service workers, private/link-local/metadata
  addresses, and arbitrary proxying are blocked. The browser cannot reach
  application-private services.
- The browser is killed and its profile removed as soon as the required `T` and
  `Y` cookies are captured and validated, and on cancel, expiry, disconnect, or
  fault. The web process completes the connection, discovers teams, and the
  Connections page moves to `/teams` without a manual refresh or code copy.
- Wrong-owner joins, replayed sessions, expired sessions, concurrent starts, and
  excessive starts are rejected. The local end-to-end test proves the
  wrong-owner and replay paths against the real WebSocket endpoint; domain tests
  prove expiry, one-use completion, cancellation, concurrency, and rate limits.
- The local helper remains fully supported and documented as the fallback. It
  keeps its RFC 8628 pairing, temporary local profile, scoped upload token, and
  tests.

### Failure states

The stream distinguishes expired sessions, blocked logins, additional
verification (two-factor), provider unavailability, browser unavailability, and
a rejected or unconfirmed completion. The UI gives an actionable message and
keeps the helper fallback visible. A failed completion never leaves the browser
open for an unbounded retry.

### Infra status

The local node target runs the browser in-process for development and tests.
Cloudflare returns `hosted_browser.unsupported`. The dedicated production
service is planned in [HOSTED-BROWSER-INFRA-PLAN.md](HOSTED-BROWSER-INFRA-PLAN.md):
IAM-private, WebSocket-capable, scale-to-zero, one browser per instance,
sandboxed, and egress-restricted. It is not provisioned or deployed.

### Rejected alternatives

- **Local helper as the primary flow:** rejected by the owner for onboarding
  friction, no refresh, and no automatic discovery.
- **Asking the user to copy a code or paste cookies:** rejected; it moves a
  secret into the client and keeps the second-device approval.
- **Using the user's existing browser through an extension or remote CDP:**
  rejected; it exposes the user's normal profile and broad session.
- **A public or unauthenticated viewer/WebSocket:** rejected; every stream is
  owner-bound and short-lived.
- **A general-purpose browser proxy or arbitrary CDP endpoint:** rejected;
  egress and provider scope are fixed.

### Proof and remaining work

Local proof: `apps/web/src/server/hostedLinking/playwrightHostedBrowser.test.ts`
(frames, input, `T`/`Y` capture, egress block, profile cleanup, expiry) and
`e2e/hostedLinking.e2e.ts` (fake provider sign-in, auto-ready, teams, wrong
owner, replay). No live Yahoo login is performed by automated tests. Production
still needs the dedicated service, a manual live sign-in, IAM/egress review,
WebSocket duration/cold-start evidence, and the deployment gates recorded in
the infra plan.

## Round 11 — Transient keystroke relay in the hosted browser

Status: owner-accepted, implemented, and deployed. This round records the
security posture of the hosted browser service; it does not relax the
owner-bound, one-use session, hashed-ticket, or egress contracts from Round 10.

1. **Accepted: transient keystroke relay.** The hosted browser necessarily
   relays input through our web process into the ephemeral Chromium: the user's
   clicks, text, and keys travel over the authenticated WebSocket, through the
   web service, and into the temporary browser. This is accepted rather than
   hidden.
2. **Never persisted.** Keystrokes, page text, frames, cookies, provider session
   material, and passwords are never logged, traced, recorded, written to disk,
   or retained by the application. The browser service logs only session id,
   lifecycle outcome, duration, and failure class. The temporary browser,
   profile, and Chromium scratch data are destroyed after capture, cancel,
   expiry, disconnect, or fault.
3. **Honest copy.** The Connections surface says the password is "entered
   directly into Yahoo's page in a temporary browser; never stored or logged".
   It must not claim that a password cannot transit our servers, and it must not
   imply end-to-end encryption between the client and Chromium.
4. **Deferred hardening.** End-to-end input encryption, a remote-attestation
   story, or a direct client-to-browser transport would be a separate decision
   with its own threat model. None of them is claimed today.
5. **Runtime isolation.** The service runs one browser per instance behind
   Cloud Run IAM, as a non-root user, with a fresh temporary profile under
   `/tmp`, a read-only image, and no attached volumes. Chromium's namespace
   sandbox is unavailable in the Cloud Run sandbox, so it runs with
   `--no-sandbox`; the compensating controls are the single-tenant container,
   non-root process, immutable image, ephemeral profile, exact-origin egress
   allowlist, signed one-use session descriptor, and IAM-only invocation.
6. **Egress without a VPC connector.** A VPC connector plus Cloud NAT would add
   a recurring charge above the owner's CAD 5/month budget, so network-level
   defense in depth is not deployed. Egress is enforced inside Chromium: exact
   provider/asset origin allowlist on requests and WebSockets, a resolver rule
   that fails every non-allowlisted hostname, and the absence of any generic
   proxy. Metadata, link-local, private, and arbitrary public destinations are
   refused by that policy. This gap is recorded in the infrastructure plan and
   deployment runbook rather than presented as network isolation.
