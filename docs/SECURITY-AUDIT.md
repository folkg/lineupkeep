# Security and privacy audit

Status: written findings for review. Eight findings are fixed, seven are deferred with the reason they
were not taken, and one is accepted as designed. Several findings were fixed in follow-up changes once
their product decisions were made; each names its fix. The personal-data inventory and closing notes are
updated where the fixes changed them. This document contains no secret, token, cookie, crumb, or personal
datum; every credential is referred to by shape only.

Date: 2026-11-01. Baseline: `5871f3e8` (`mcp: reduce the scope set to four resource scopes`).

## Scope and method

Reviewed: sign-in and sessions, OAuth and the MCP server, the hosted browser, credential encryption and key
handling, every path that changes data upstream, the personal-data inventory, the address-based egress
policy, and the rate limits and caps that bound all of it.

Method: source review of this repository at the baseline, plus reading the installed source of the pinned
dependencies where a control lives there (`better-auth` 1.7.12, `@better-auth/oauth-provider`,
`@better-auth/mcp`, `@tanstack/start-*`). Reachability claims were checked against the code path, not
inferred from a name. Nothing was deployed, no live provider account was exercised, and no deployed
environment was probed; where a claim is deployment-only it says so. The dependency layer is out of scope:
its own record is [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md).

This is an audit, not a refactor. Only the findings that were unambiguously wrong and cheap were fixed here.

## Severity definitions

Severity describes what an attacker gains and what it costs to get it, not how alarming the topic sounds.

| Severity     | Definition                                                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Compromise of secrets or another account's data with no authentication, or code execution in our process. Nothing in this audit is critical.                                                                                            |
| **High**     | A remote party who already holds a normal account or one stolen bearer token can change or destroy data, recover secrets, or remove availability or budget for the whole deployment, at machine speed and without further owner action. |
| **Medium**   | A real weakness that needs a precondition beyond one token — a second bug, a specific architecture decision, an operator action, or the passage of a bounded window — or whose impact is confined to the attacker's own account.        |
| **Low**      | Defence in depth, truthfulness of what we tell a person or a client, or hygiene where the residual impact is narrow and already bounded by another control.                                                                             |

Two rules were applied to keep the word "high" meaningful:

- A finding is High only if the damage is not confined to the attacker's own account, **and** the
  attacker's position is one an outsider can plausibly reach (a self-registered account, a granted client,
  a stolen cookie). Anything needing owner cooperation, an operator error, or a second vulnerability is
  Medium at most.
- A finding whose only cost is that a control could be stronger, with no demonstrated gain, is Low even
  when the topic is serious. "This could be better" is not High.

`Fixed` means the change is in this audit's revision or in the follow-up named on the finding, with a
regression test that fails without it. `Deferred` means it is recorded for the named reason and left for the
reviewer to schedule.

## Summary

| #   | Finding                                                                                    | Severity | Status    |
| --- | ------------------------------------------------------------------------------------------ | -------- | --------- |
| F1  | No rate limit or cost ceiling on the expensive and destructive MCP tools                   | High     | **Fixed** |
| F2  | Dynamic client registration is unauthenticated, uncapped and never cleaned up              | Medium   | **Fixed** |
| F3  | Session revocation lags up to five minutes and there is no session inventory or revoke-all | Medium   | **Fixed** |
| F4  | No erasure or export path for personal data, and some tables have no retention at all      | Medium   | **Fixed** |
| F5  | A connection-key compromise has no fast remediation                                        | Medium   | **Fixed** |
| F6  | Google sign-in would store provider OAuth tokens unencrypted                               | Medium   | Deferred  |
| F7  | `/api/telemetry` has a process-global budget and no authentication                         | Low      | Deferred  |
| F8  | The internal worker route is gated only by an environment variable on a shared image       | Low      | Deferred  |
| F9  | Rate-limit buckets are keyed by client address, so one account can spend another's         | Low      | Deferred  |
| F10 | An `uncertain` run never ages out and has no resolution path                               | Low      | Deferred  |
| F11 | The unverified Resend sender makes sign-in an address-classification oracle                | Low      | Deferred  |
| F12 | An abandoned hosted-browser session holds the single browser slot until it expires         | Low      | Deferred  |
| F13 | The consent screen presents an unverified client name as the destination                   | Low      | **Fixed** |
| F14 | `fantasy:read` grants a write and the consent text did not say so                          | Low      | **Fixed** |
| F15 | The egress proxy records an unbounded number of distinct refusals per session              | Low      | **Fixed** |
| F16 | The hosted browser can reach Lineupkeep's own public origin                                | Low      | Accepted  |

Count: 0 critical, 1 high, 5 medium, 10 low. Eight fixed, one accepted as designed, seven deferred.

## Findings

### F1 — No rate limit or cost ceiling on the expensive and destructive MCP tools

**Severity: High. Fixed in a follow-up change, after the product decision this audit asked for.**

Evidence. `/mcp` has no application-level limiter: `apps/web/src/server/mcp/mcpEndpoint.ts:25` verifies the
bearer token and scopes, then serves the toolkit. The only limiter in the system is
`packages/backend/src/contexts/auth/internal/BetterAuthAdapter.ts:475` (`rateLimit`), and `better-auth`
applies it to its own `/api/auth/*` endpoints only — it never sees a `/mcp` request. Per-tool input caps
bound one call (`packages/backend/src/contexts/connections/LineupRun.ts:104` caps a request at ten teams;
`TransactionProposals.ts:304` caps a proposal at twenty items), and nothing bounds calls per owner per unit
of time.

The expensive tools are the read tools (each one is at least one provider HTTP request plus database work),
`revalidate_transaction_proposal_set` (one roster, league, and pool read per team in the set), and
`set_lineup`, which is not merely expensive but **destructive**: `LineupRuns.submit`
(`internal/LineupRunsLive.ts:40`) creates a run per team, dispatches it, and the worker writes to the
provider. A caller that varies `requestId` creates a fresh run every time, so the ten-team cap bounds one
request and not a loop. Only the write-intent guard stops a _concurrent_ second write
(`internal/LineupWorkerLive.ts:148`); sequential writes are unlimited by design.

**What an attacker gains.** A stolen access token for any scope, or a client the person granted, can drive
provider traffic and upstream writes at machine speed. With `fantasy:read` alone: unbounded provider reads
and database work, which consumes the shared Neon free compute allowance, the Cloud Run free vCPU-seconds,
and the provider's own per-account quota. With `lineups:write`: repeated rewrites of the owner's lineups.
Because the deployment targets free allowances explicitly ([deployment.md](deployment.md)), exhausting them
is availability loss for the whole deployment, not just the caller. It also spends the provider account's
good standing, which we cannot repair from here.

**Fix.** One bounded limiter in front of the MCP toolkit, keyed by owner and by client, with a smaller
bucket for the destructive tool than for reads, plus a durable count (the database, not process memory, so
it survives scale-to-zero). Refusals must be a `rejected` outcome with `Retry-After`, not a 500. It belongs
beside the existing scope check so every tool inherits it.

**Why it waited.** The numbers are a product decision (how many lineups per hour is a person allowed to ask
for?), and a wrong guess either blocks a legitimate agent loop or does nothing.

**How it was fixed.** `ToolCallQuota` (`contexts/toolCalls`) reserves a durable count in the
`tool_call_quota` table before the tool runs, and `mcpEndpoint` calls it beside the bearer and scope checks
so no tool can be added without it. The allowance is priced by the tool's published `readOnlyHint` and
`destructiveHint`: reads get 60 per client and 180 per owner per minute, other writes 20 and 60 per hour,
and `set_lineup` 6 and 18 per hour, each with its own window. The client key is the token's `client_id`,
never the client address. A refusal increments the counters like any other call, and answers `429` with
`Retry-After` and a JSON-RPC error, annotated as `app.outcome: rejected` with the tool name. The numbers and
the contract are documented in [MCP.md](fantasy-manager/MCP.md#tool-call-limits). Regression tests cover the
read loop, the smaller write and destructive buckets, client isolation, survival across a fresh process, and
the refusal shape.

### F2 — Dynamic client registration is unauthenticated, uncapped and never cleaned up

**Severity: Medium. Fixed in a follow-up change.**

Evidence. `packages/backend/src/contexts/auth/internal/BetterAuthAdapter.ts:429-431` sets
`allowDynamicClientRegistration`, `allowUnauthenticatedClientRegistration`, and `allowPublicClientPrelogin`.
Anyone can POST a registration with no account and no token. The only bound is the plugin's
`/oauth2/register` rule of five per sixty seconds per client address
(`@better-auth/oauth-provider`, `rateLimit.register`), which is per address, not global. Nothing caps the
total: `packages/backend/src/contexts/auth/internal/OAuthTables.ts:11` has no expiry column for
`oauth_client`, and this repository has no cleanup for it — `OAuthClientRepository` is the only module that
mentions the table and it only reads and widens. At the allowed rate one address adds about 7,200 rows a
day.

The same rows are read on every process start:
`packages/backend/src/contexts/auth/internal/OAuthClientRepository.ts:25` selects every dynamic
registration, decides in memory, and rewrites the stale ones with one `UPDATE`. `loadAuth` is cached per
process (`BetterAuthAdapter.ts:110`), so this is not per request, but it is per cold start — and this
service cold-starts on the first request after fifteen idle minutes.

A related amplification is inherent to CIMD: with `cimd` enabled, a `client_id` that is an HTTPS URL makes
the authorization server fetch it
(`BetterAuthAdapter.ts:92`, `clientMetadataRequest`). That fetch is properly bounded — `PublicInternet`
requires HTTPS, rejects credentials in the URL, refuses redirects, caps the body at 1 MiB, times out at 15
seconds, and pins the resolved address against rebinding
(`packages/backend/src/runtime/PublicInternet.ts:104`,
`packages/backend/src/runtime/public-internet/transport/node/PublicInternetProcess.ts:21`). So it is a
one-request-in, one-request-out beacon from our egress address, not an open proxy.

**What an attacker gains.** Unbounded storage growth in the application database (availability and cost),
a growing cold-start and `UPDATE` cost, and the ability to use our egress address as a blind HTTP GET
beacon. It is not a way to reach another account: a registration grants nothing until a signed-in person
consents, and consent shows the scopes asked for.

**Fix.** Cap concurrent live dynamic registrations (a global ceiling with a clear refusal), age out
registrations that never completed an authorization, and make `widenDynamicRegistrations` set-based with a
`WHERE scopes <> advertised` predicate instead of loading every row. The last part is a pure efficiency fix
and could be taken alone.

**Why not here.** A ceiling on registrations and a retention rule are product decisions with a visible
failure mode (refusing a legitimate new client), and the cleanup needs a migration. The set-based
predicate alone is cheap but changes nothing about the unbounded growth, so it does not resolve the finding.

**Cheap half fixed.** `widenDynamicRegistrations` no longer loads every registration and rewrites the stale
ones in a second statement. One `UPDATE` selects on the same conditions plus `scopes <@ advertised` and
`NOT (scopes @> advertised)`, so it widens exactly the rows the previous loop widened and never narrows a
registration that holds a scope we no longer advertise.
`packages/backend/src/contexts/auth/internal/OAuthClientRepository.test.ts` compares the stored scopes and
timestamps before and after over a mixed set: a strict subset, the same set in another order, a retired
scope, an owner's client, a discovered client, a resource client, and a row with no scopes. The ceiling and
the retention rule remain open.

**Fixed.** A dynamic registration counts as unapproved when it has no consent, access token, or refresh token.
At most 100 may be live; a registration request at the cap is refused with `temporarily_unavailable` and a
message that names the limit. The hourly sweep removes unapproved registrations seven days after they
registered in one set-based delete and reports the count as `registrations`. The scope-widening update is
set-based, as described above. Retention windows are named in
`packages/backend/src/retention/RetentionPolicy.ts`.

### F3 — Session revocation lags up to five minutes, and there is no session inventory

**Severity: Medium. Fixed in a follow-up change.**

Evidence. `BetterAuthAdapter.ts:471-472` enables the cookie cache with `maxAge: 5 * 60`.
`better-auth`'s `getSession` returns the session from the signed cookie cache without a database read until
that cache expires (`better-auth/dist/api/routes/session.mjs`, `shouldUseCookieCache` branch). Session
lifetime is the `better-auth` default — seven days, sliding with a one-day `updateAge`
(`better-auth/dist/context/create-context.mjs:147-148`) — and this repository sets no `expiresIn`, no
`updateAge`, and no cookie-prefix hardening. There is no `/list-sessions` surface and no revoke-all in the
UI; `apps/web/src/browser/session/sessionRemote.ts:8` calls `signOut`, which ends only the current cookie.

`deployment.md` records the analogous MCP fact (a locally verified access token stays valid until it
expires) and `deferred` mentions of explicit grant disconnection, but the browser-session half is not
recorded anywhere.

**What an attacker gains.** With a stolen session cookie: up to five minutes of use after the owner signs
out, and up to seven days of sliding use otherwise. Deleting the session row — the only revocation this
deployment can perform — is not effectual for five minutes either. Nothing lets an owner see or end another
device's session, so a stolen cookie cannot be discovered or cut off from the product.

**Fix.** Either drop the cookie cache for the session lookup (one indexed database read per request, which
is the same read the rest of the page performs anyway) and shorten `session.expiresIn`, or keep the cache
and add a session table view with revoke and revoke-all. Both are small; they trade one read per request
against a five-minute window.

**Why not here.** It is a deliberate latency/revocation trade, not an unambiguous defect. It also changes
the sign-in continuity the deployment notes promise.

**How it was fixed.** The cookie cache is off (`session.cookieCache.enabled: false`), so the chosen window
is zero and a deleted session is refused on the next request rather than when a signed cache expires. That
costs one indexed read of the `session` row per authenticated request, which the request already made for
its own authorization; the trade is recorded in the [runbook](deployment.md#browser-sessions). The row
refresh interval (`session.updateAge`) is five minutes instead of one day, which bounds the write rate while
making the row's `updated_at` a usable last-used time. `SignInSessions` (`contexts/auth`) lists the owner's
active sessions with a short device hint derived from the stored user agent, ends named sessions, and ends
all but the current one; every statement is scoped by owner id. The Connections page lists them, marks the
current device, and offers both actions. Sign-out is labelled "Sign out this device". Session lifetime is
still the seven-day default: shortening it is a product decision and is not part of this change.

### F4 — No erasure or export path for personal data, and some tables have no retention

**Severity: Medium. Fixed in a follow-up change.**

Evidence. Nothing in the repository deletes an account or exports its data: there is no `deleteUser` call,
no erasure service, and no operator surface. `deployment.md` stated the position plainly before this
fix: entities use soft deletion, and legal erasure needed a future job. The retention that does exist is
narrow:
`internal/RetentionSweepRepository.ts:20` sweeps terminal lineup runs older than thirty days, their
attempts, write intents, diagnostics, and orphan requests and deliveries;
`FeedbackRetentionLive` sweeps resolved and not-planned reports after 180 days and expired quota rows. Not
swept: `session`, `verification`, `oauth_client`, `oauth_consent`, `oauth_refresh_token`,
`hosted_linking_sessions`, `feedback_quota` beyond its window, and `provider_teams.ownerNote`.

Two consequences are specific:

- `uncertain` runs are excluded from the sweep by design (`terminalOutcomeStatuses` omits it) and have no
  transition out of `uncertain` that the sweep would then pick up, so a run whose write outcome was never
  settled retains its outcome, its connection reference, and its plan forever. That is defensible as "an
  unresolved incident is current work", but nothing resolves it, so "current" is unbounded.
- Before this fix, a subject access request meant hand-written SQL across seven tables, and an erasure
  request meant deleting rows that other rows reference by `userId` text with no cascade
  (`AuthTables.ts` has `onDelete: "cascade"` only from `session` and `account`).

**What an attacker gains.** Nothing directly. This is a legal and privacy exposure, and the risk of an
incomplete delete leaving copies behind.

**Fix.** One owner-scoped erasure routine that deletes, in transaction order, provider credentials (already
hard-deleted on disconnect), teams, runs and their children, hosted-linking sessions, feedback, consents,
refresh tokens and sessions, then the user row; plus a read-only export of the same set. Also give
`uncertain` a resolution transition and a clock.

**Why not here.** Ordering, what must survive for an incident record, and the retention promise are policy
decisions, and the change wants a migration. Recorded as roadmap group J2.

**Retention fixed.** The hourly sweep now removes expired sessions and verification rows, consents unused for
180 days, hosted linking sessions one day after they end, and unapproved dynamic registrations after seven
days. The windows live in `packages/backend/src/retention/RetentionPolicy.ts`.

**Fixed.** `AccountErasure` (`contexts/privacy`) deletes every row that carries the owner, directly or
through a parent row, in one transaction. It removes children before parents, ends sign-in sessions and
hosted linking sessions, revokes access and refresh tokens together with consents and the owner's client
registrations, deletes the sign-in codes and the sign-in code quota keyed by a hash of the address, and
deletes the account row last. Access-token resolution now also refuses a token whose user row no longer
exists, so a JWT minted before the erasure stops working when the transaction commits rather than when it
expires. The routine is idempotent: a second call with a fresh export reports nothing removed. A failure
partway through rolls the whole transaction back. `AccountExport` produces one JSON document with
`schemaVersion: 1` over the same inventory; credential fields are never included and are named in a
`withheld` list with the reason. The Your data surface (`/account`) offers the download and the erasure;
erasure requires the typed phrase `erase my account` on the client and again on the server, signs the
browser out, and lands on `/erased`. It also requires an export recorded within the last hour, shows when
that export was taken and what it holds, and deletes the record in the same transaction, so a used export
cannot justify a second erasure.

The erasure test enumerates owner-carrying columns from `information_schema` and refuses to pass when a
table is not named in the inventory, so a table added later cannot be missed silently. It seeds every class,
erases, then queries every enumerated owner column and every inventory class for a remaining row, and it
checks that a second owner's rows are untouched. It refuses an erasure with no export and one whose export
is older than the hour, proves a fresh export is consumed, and proves a second erasure is refused until a
new export is recorded. A trigger that refuses a delete proves the transaction leaves the account exactly
as it was. The export round-trips through its schema, and the E2E test proves a sign-in cookie captured
before erasure cannot reach a protected page afterwards. `uncertain` runs still have no resolution
transition (F10).

### F5 — A connection-key compromise has no fast remediation

**Severity: Medium. Fixed in a follow-up change: the configuration keyring.**

Evidence. The envelope is sound: AES-GCM with a 12-byte random nonce, an authenticated-data string binding
the envelope version, key version, owner, connection, and provider
(`internal/ConnectionCredentialEncryption.ts:148-161`), versioned JSON with base64url fields, and a decrypt
path that rejects a mismatched key version, a wrong nonce length, or a ciphertext shorter than the tag
(`:90-96`). A database-only exposure therefore yields no provider session, and a ciphertext cannot be
moved to another owner or connection. `ConnectionEncryptionKey` reads one base64 32-byte key and one key
version (`connectionEncryptionKeyVersion`), and nothing in the product can re-wrap an existing envelope.

**What an attacker gains.** If `CONNECTION_ENCRYPTION_KEY` itself leaks, every stored provider session is
readable and every linked team is under the attacker's control upstream — the provider cannot tell us from
them. Remediation today is the documented incident path: pause provider work, disconnect every affected
connection so the ciphertext is deleted, replace the key, and have each owner link again by hand. There is
no in-place rotation, so the window between "we know" and "we are safe" is however long it takes the owner
to re-link, and it cannot be shortened from our side.

**Fix.** The keyring release already sketched in `deployment.md`: decrypt with any retained key version,
encrypt with the current one, re-encrypt on the next successful credential use, then retire the old
version. The envelope already carries the version and binds it as authenticated data, so the format does
not need to change — only the key provider does.

**Fix released.** The key provider now reads a configuration keyring: `CONNECTION_ENCRYPTION_KEY` with
`CONNECTION_ENCRYPTION_KEY_VERSION`, plus `CONNECTION_ENCRYPTION_RETAINED_KEYS` for versions that may
still decrypt. An envelope under a retained version opens and is resealed under the current key by a
compare-and-swap, so the ring converges under normal traffic without a migration. A version absent from
the ring is refused by name (`connection.credential_key_version_unavailable`) with the operator action,
and the hourly maintenance tick reports `olderEnvelopes` and `unreadableEnvelopes` so retirement is
decided from counts. The envelope format, authenticated data, and endorsed cipher are unchanged;
`deployment.md` owns the rotation and leak runbook.

### F6 — Google sign-in would store provider OAuth tokens unencrypted

**Severity: Medium. Deferred: conditional on a sign-in method that is currently disabled, and fixing it
means changing how `better-auth` persists accounts.**

Evidence. `account` in `internal/AuthTables.ts` carries `access_token`, `refresh_token`, `id_token`,
`access_token_expires_at`, `refresh_token_expires_at`, and `scope` as plain `text`, which is the
`better-auth` schema. Google is wired at `BetterAuthAdapter.ts:398-410` and offered when
`GOOGLE_CLIENT_ID` is set. Production currently runs email codes only, so the columns are empty there.

The asymmetry is the point: provider _session_ material — the more valuable secret, because it controls a
fantasy team — is envelope-encrypted with a key that is not in the database, while a Google refresh token,
which controls the person's identity, would sit in the clear beside the user row. A database read would
therefore yield less than a provider session but more than nothing.

**What an attacker gains.** With the application database and Google sign-in enabled: a Google OAuth
refresh token for each person who signed in that way, usable against Google outside this product. The same
read already yields `jwks.private_key`, which is `better-auth`'s plaintext signing key and can mint a token
for any user — so a database compromise is fatal regardless of this finding. The reason to fix this one is
that the asymmetry is unexpected: the more sensitive provider session is protected and the identity token
is not, which invites a false sense of safety.

**Fix.** Either keep Google disabled until the account table is encrypted or moved off-row like provider
credentials, or store the Google tokens through a second encryption envelope with its own key version.

**Why not here.** It requires deciding whether Google sign-in is part of the product at all, and it touches
a table owned by `better-auth`.

### F7 — `/api/telemetry` has a process-global budget and no authentication

**Severity: Low. Deferred: the documented remedy is an ingress rule, and the in-process alternative needs
a key we do not have.**

Evidence. `apps/web/src/routes/api/telemetry.ts` accepts anonymous POSTs and
`telemetryServer.ts:188` creates one budget of 100 reports per minute for the whole process — not per
address, not per owner. `deployment.md` already requires rate-limiting this path at ingress, and deployment
is what would have to prove it. Only classifications and numeric facts are exported; the caller-supplied
`message`, `pathname`, `name`, `target`, `blockers`, and `id` fields are validated but never annotated, so
this is not a log-injection or privacy path.

**What an attacker gains.** Silence: one anonymous loop that sends 100 well-formed reports a minute
consumes the budget, after which genuine client-error reports are dropped (`app.outcome: dropped`). No data
is written and no memory grows.

**Fix.** Key the budget by client address (the trusted-header policy already exists for auth) or by a
client-generated token, and confirm the ingress rule with a deployed probe.

**Why not here.** A per-address budget needs the same trusted-address plumbing the audit cannot verify from
source alone, and the documented control is ingress.

### F8 — The internal worker route is gated only by an environment variable on a shared image

**Severity: Low. Deferred: it is currently correct, and hardening it means verifying a Google identity
token inside the app.**

Evidence. `apps/web/src/server/lineupWorker.ts:38` returns 404 unless `LINEUP_WORKER_ENABLED` is `"true"`,
then accepts `tick`, `deliver`, and `repair` with no caller authentication.
`infra/hosts/cloudRun.ts:162` sets that variable only on the worker service; the web service
(`cloudRun.ts:274-292`) does not receive it, and the worker sets `invokerIamDisabled: false` while the web
sets it `true`. Both services run the same image. So the boundary today is: Cloud Run invoker IAM on the
worker service, plus an environment variable that must not be copied to the web service.

**What an attacker gains.** If that variable ever appears on the web revision, an unauthenticated stranger
could drive scheduled automation for every owner, which means upstream lineup writes no person asked for.
That is a configuration mistake away, not a code path away.

**Fix.** Require and verify the Cloud Run identity token in the handler as well, with the expected audience,
so the flag is a convenience rather than the control. Setting the flag on the public service alone would
then be harmless.

**Why not here.** Verifying a Google-issued OIDC token needs a JWKS fetch and a cache, which is a small
subsystem, not a one-line fix.

### F9 — Rate-limit buckets are keyed by client address, so one account can spend another's

**Severity: Low. Deferred: it is a consequence of the shared-key design and the deployment has one person.**

Evidence. `better-auth` keys its limiter by `(client address, path)` and falls back to one shared bucket
when no address resolves (`rate-limiter/index.mjs`, `createRateLimitKey` and the `NO_TRUSTED_IP_KEY`
fallback). `AUTH_CLIENT_IP_HEADERS` is required in production so the address normally resolves
(`BetterAuthAdapter.ts:606-628`), and `deployment.md` requires the header choice to match real ingress.

**What an attacker gains.** If two people share an address (a household, an office NAT, a shared proxy),
one of them can exhaust another's sign-in budget and lock them out of signing in, and if the header is ever
mis-set for the real ingress topology, every caller lands in one bucket and a single loop denies sign-in to
everyone. The second case is the serious one, and it is a deployment-configuration claim that source review
cannot settle.

**Fix.** Key the sign-in limiter by address _and_ address-independent per-address-quota (the per-address
email quota already exists and is the right shape), and verify header attribution under the deployed
topology with two addresses, which `deployment.md` already asks for and which has not been recorded.

**Why not here.** It needs a deployed probe, and deployment is outside this change.

### F10 — An `uncertain` run never ages out and has no resolution path

**Severity: Low. Deferred: shortening it would delete the only record that a write may have happened.**

Evidence. `internal/RetentionSweepRepository.ts:20-26` sweeps only `completed`, `skipped`, `blocked`,
`failed`, and `superseded`. `uncertain` is excluded, correctly, because the run is the only record that a
request may have reached the provider. But nothing transitions an `uncertain` run to a settled state later:
`LineupRunStatus` includes `uncertain` as a terminal-looking value and the repository exposes
`recordUncertain` with no matching resolution call.

**What an attacker gains.** Nothing. The cost is that the data inventory has no upper bound for these rows,
and a reader cannot tell a fresh uncertain run from a year-old one.

**Fix.** Give `uncertain` a resolution transition (a person reconciles by readback and records the answer)
and only then let the thirty-day clock start. Do not simply add `uncertain` to the sweep list.

**Why not here.** It adds a state transition, which the audit was told not to invent.

### F11 — The unverified Resend sender makes sign-in an address-classification oracle

**Severity: Low. Deferred: already a recorded launch gate, and the fix is a verified sending domain.**

Evidence. `BetterAuthAdapter.ts:516-529` turns a delivery rejection into `422 EMAIL_REJECTED` and a
transient failure into `503 EMAIL_UNAVAILABLE`. `deployment.md` records that production currently sends from
Resend's test sender `onboarding@resend.dev`, which delivers only to the owner's address, and that a
verified domain is a launch gate. The recorded smoke result is exactly this: the owner's address returned
200 and another address returned 422.

**What an attacker gains.** While the test sender is in use, anyone can ask whether a given address is
acceptable to our sender — which for the test sender means whether it is the owner's address. That is a
single-account deployment, so the value is low, but it is a fact about a person that an anonymous caller
can confirm.

**Fix.** Verify the sending domain before open registration, as already planned. After that, a 422 stops
distinguishing recipients.

**Why not here.** Deploying and verifying a domain is a deployment action.

### F12 — An abandoned hosted-browser session holds the single browser slot until it expires

**Severity: Low. Deferred: a heartbeat or reclaim needs a protocol change.**

Evidence. `apps/hosted-browser/src/server.ts:120-129` refuses a second session with `1013` while `live` is
set, and one browser per instance with concurrency 1 and at most two instances
(`infra/hosts/cloudRun.ts:343-354`). A session ends on capture, cancel, expiry, fault, or shutdown. On the
web side, `hostedLinkingStream.ts` closes the browser when the stream closes, and a Cloud Run request
timeout closes the stream, so the ordinary timeout path does tear down promptly; the recorded 295–325 s
sample in `deployment.md` is that path working. The residual case is a web process that dies without closing
its sockets (an instance kill), leaving the browser to run until its own ten-minute expiry.

**What an attacker gains.** A person who starts a link, walks away, and never closes the tab can occupy the
only slot for up to ten minutes, so the next attempt is refused as busy. That is availability, self-inflicted
in the common case, and it costs at most ten minutes of one 1 vCPU/2 GiB instance.

**Fix.** A web-side heartbeat that the browser treats as liveness, or reclaiming a session whose owning
stream is silently gone. Both change the transport protocol.

**Why not here.** It adds protocol state for a bounded, self-inflicted cost.

### F13 — The consent screen presents an unverified client name as the destination

**Severity: Low. Fixed here.**

Evidence. `getConsentRequest` built the display object as
`host: metadataHost ?? client.client_name ?? "an unverified client"`
(`packages/backend/src/contexts/auth/internal/BetterAuthAdapter.ts`). For a client whose `client_id` is a
CIMD HTTPS URL, `metadataHost` is the real metadata host — a fact the client cannot fake, because it had to
serve a document there. For a dynamically registered client with an opaque `client_id`, `metadataHost` is
`undefined`, so `client_name` — an attacker-supplied string with no verification — became the `host`. The
consent page renders that value in its first line, "Connecting to {host}", and only then says "Calls itself
“{name}”. Names are not verified." So the phishing-relevant line showed unverified text while the
disclaimer sat underneath it, and a stranger could register `client_name: "Lineupkeep Support"` and be
introduced as the destination.

**What an attacker gains.** A better phishing pretext on a page whose whole purpose is to make the client's
identity checkable. Nothing is granted without the person pressing Allow, and the scopes are still listed
honestly, so this is a trust-signal defect rather than a grant bypass.

**Fix.** Use only the verified metadata host for the destination line; an opaque client is "an unverified
client". The unverified name is still shown, under the existing disclaimer, because it is useful context
and it is now never mistaken for a host.

**Test.** `BetterAuthAdapter.test.ts`:
"does not present an unverified client name as the address it is connecting to" registers a client named
`Lineupkeep Support`, drives the real authorize redirect, reads the consent lookup, and asserts the host is
`an unverified client` and the name is still `Lineupkeep Support`. It fails against the previous line.

### F14 — `fantasy:read` grants a write and the consent text did not say so

**Severity: Low. Fixed here.**

Evidence. `submit_feedback` is annotated with the read scope
(`apps/web/src/server/mcp/feedbackTools.ts:47`) so that a client holding the smallest grant can report a
problem — a deliberate and reasonable choice, and the tool's own description says so. But the consent screen
shows only the scope descriptions from `packages/backend/src/contexts/connections/QueryScopes.ts`, and the
read description said the grant "cannot change a lineup or an automation setting, cannot propose or submit
a transaction" while never saying that it _can_ create a feedback report. A person granting "read" was
therefore granting a write that the consent text did not disclose.

**What an attacker gains.** Nothing. The write is the caller's own feedback, capped at 20 per owner-hour and
10 per client-hour (`packages/backend/src/contexts/feedback/Feedback.ts:34-35`). The defect is
truthfulness: a permission screen described a narrower grant than the token carries.

**Fix.** The read description now names the feedback write, and keeps the three prohibitions. The repair is
a disclosure, not a scope change: splitting feedback into its own scope would force every client to request
a fifth scope for the one action that must never need one.

**Test.** `apps/web/src/server/mcp/mcpScopes.test.ts`:
"says in the read scope description that the grant can file a feedback report". It fails against the
previous wording.

### F15 — The egress proxy records an unbounded number of distinct refusals per session

**Severity: Low. Fixed here.**

Evidence. `packages/hosted-browser/src/egress.ts` deduplicated refusals by `(reason, host)` and then
appended every new one to `refusals` and called `onRefused`. The page inside the hosted browser is
untrusted by construction — that is the point of the proxy — and it can ask for any number of distinct
destinations (`https://a1.attacker.test`, `a2`, …). Each one is a new key, so both the array and the
`Refused` messages sent to the web and shown in the Connections surface grew without bound. The array is
also copied into the session log line, so a hostile page could write a multi-megabyte log entry.

**What an attacker gains.** Memory and log growth inside the browser service for the length of one session,
from a page the browser was pointed at. It costs a session start, and the session is capped at ten minutes,
so the ceiling is one session's worth of junk; the value is pressure on a 2 GiB instance and on log volume,
not persistence.

**Fix.** Report at most the first twenty distinct refusals per session and stop recording the rest. Every
destination is still refused, and the refusing 403 page still names the host — the visited page and the
person lose nothing operationally; the log stops being writable by the page.

**Test.** `packages/hosted-browser/src/egress.test.ts`:
"stops reporting new refusals after a bounded number and still refuses them" drives twenty-one distinct
non-public destinations, asserts every one still gets 403, and asserts exactly
`maximumReportedRefusals` were recorded and reported. It fails against the previous code.

### F16 — The hosted browser can reach Lineupkeep's own public origin

**Severity: Low. Accepted: it is a property of the address policy, and it grants nothing.**

Evidence. Egress is decided by resolved address, not hostname
([ADR 0010](fantasy-manager/adr/0010-address-based-egress.md)); our own origin is a public Cloud Run URL,
so the browser can load it. The browser profile is freshly created per session with no cookies and no
storage from any prior session, and it has no Lineupkeep session, so it reaches our origin as an anonymous
visitor. The surfaces it could touch are public: `/`, `/auth`, `/.well-known/*`, `/mcp` (which requires a
bearer token), and `/api/auth/*` (which is origin-checked by `better-auth`'s `originCheckMiddleware`). The
app also has no state-changing `GET`.

**What an attacker gains.** A way to make the hosted browser fetch our own public pages. Nothing more,
because there is no ambient authority in the profile to spend.

**Why accepted.** Excluding our own origin would reintroduce exactly the maintenance problem ADR 0010
removed, and the address policy is the boundary the owner approved. It is recorded here so the next reader
does not have to rediscover that "cannot reach application-private services" is not "cannot reach us".

## The write surface

Every path that can change data upstream, with the four facts that decide whether it can be aimed or
replayed. "Once-only" means the same stored intent cannot produce a second upstream write; "replay-safe"
means a repeated request is either refused or a no-op against current provider state.

| Path                                  | Who can trigger                                   | Bound to                                                          | Once-only                                                                                               | Replay / aiming                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_lineup` (native action)          | `lineups:write`                                   | owner + team + connection generation + run                        | No — each new `requestId` is a new run                                                                  | A repeated `requestId` replays the stored run, not a new write (`LineupRunRepository.createRequest`, conflict target `(userId, id)`). A different intent on the same id is `lineup.request_conflict`. Another owner's team id is `team_not_found`. |
| `set_lineup` (explicit assignments)   | `lineups:write`                                   | same, plus the roster read before and after                       | No — but a concurrent second write is blocked by `unresolved_prior_write` (`LineupWorkerLive.ts:148`)   | Same. Before writing, the plan is re-derived from a fresh roster and league read (`:239-260`), and the write is compared with both the intended and the before-state.                                                                              |
| Scheduled automation run              | The hourly worker, never a client                 | owner + team enrollment + active implementation stamp             | One scheduled pending run per team (`lineup_runs_one_scheduled_pending_idx`)                            | Delivery is by run id; a redelivered run resumes its recorded plan instead of re-planning.                                                                                                                                                         |
| Reconnect (`completeReconnect`)       | A signed-in person through the hosted browser     | owner + connection + expected credential generation               | Yes — the generation check rejects a stale race (`ConnectionsLive.ts:218`)                              | Needs the one-use ticket hash and the owner's session cookie; wrong owner is `not_found`.                                                                                                                                                          |
| Transaction proposal `submit`         | **A signed-in person only.** There is no MCP tool | owner + proposal set + team + connection                          | Yes — `claimSubmission` is a single conditional update; a second submit is `proposal.already_submitted` | The set expires after 24 hours and refuses; each item is re-checked against current provider state before its write; a non-`executed` outcome stops the rest of that team.                                                                         |
| `withdrawTrade`                       | **A signed-in person only**                       | owner + team + stored proposal item or sealed offer reference     | Effectively — the provider is re-read first and the offer must still be pending                         | A replay finds it no longer pending and changes nothing (`proposal.trade_not_pending`). References are sealed AES-GCM values bound to owner and league, so one cannot be aimed at another account's league.                                        |
| `set_team_automation`                 | `teams:manage`                                    | owner + team                                                      | n/a — Lineupkeep state only                                                                             | Idempotent: repeating an action returns `unchanged`. Contacts no provider.                                                                                                                                                                         |
| `propose_transactions` / `revalidate` | `transactions:review`                             | owner + proposal set + every referenced team                      | n/a — reads only                                                                                        | Writes no upstream state; the identical set returns the existing set instead of a duplicate (`transaction_proposal_sets_user_id_fingerprint_idx`).                                                                                                 |
| Review links (`TransactionReviews`)   | `transactions:review`                             | owner + team + league + validated player and counterparty refs    | n/a — a URL handed to a person                                                                          | The provider executes nothing from the link; forbidden path segments (`submit`, `confirm`, `transaction`, `execute`) are rejected when the link is built.                                                                                          |
| Provider connection linking           | A signed-in person through the hosted browser     | owner + one-use ticket hash + ten-minute window + one active lock | Yes — the ticket is consumed and the session id is refused on reuse                                     | Another owner's session id is `not_found`; a replayed ticket is `ticket_rejected`.                                                                                                                                                                 |
| Disconnect                            | A signed-in person                                | owner + connection                                                | n/a — deletes the ciphertext                                                                            | Hard-deletes `provider_credentials` in the same transaction as the state transition, so future work cannot decrypt.                                                                                                                                |

Two structural facts make the whole table stronger than it looks. First, no upstream write takes its
provider identity from the request: `providerIdentity(context)` is built from the stored owned team
(`TransactionProposalsLive.ts`, `LineupWorkerLive.ts`), so a request cannot name a provider team key, a
league key, or a cookie. Second, no tool accepts a URL: review links are built from a closed provider map
and validated path segments, so there is no request-supplied destination anywhere in the write surface.

What the table cannot promise, and the architecture doc already says so: with no provider idempotency key,
exactly-once effects are impossible. A submit that dies mid-way leaves a partially applied set marked
submitted, and the honest recovery is to look at the provider, not to retry blindly.

## Personal data inventory

| Data                                                | Where                                                                           | Retention today                                                                               | What deletes it                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sign-in address                                     | `user.email` (unique)                                                           | Until the account is deleted                                                                  | Account erasure                                                                                |
| Display name                                        | `user.name`                                                                     | Same                                                                                          | Account erasure                                                                                |
| Session rows, with IP address and user agent        | `session.ipAddress`, `session.userAgent`                                        | Seven days, sliding                                                                           | Sign-out, or ending one on Connections, deletes its row; the hourly sweep removes expired rows |
| Sign-in code                                        | `verification.value`, stored hashed by `emailOTP`                               | Ten minutes to expiry; attempts capped at three                                               | Deleted on use by the plugin; the hourly sweep removes expired rows                            |
| Sign-in code quota                                  | `sign_in_code_quota.key` — SHA-256 of the lowercased address                    | One-hour window; the row is reused or replaced, and stale rows are deleted on the next insert | The quota repository's own delete-then-insert path                                             |
| MCP refresh token                                   | `oauth_refresh_token.token` — hashed by the provider plugin                     | Thirty days from issue or last rotation, then revoked                                         | Rotation, revocation, or expiry; no sweep of consumed rows                                     |
| MCP refresh-token rotation replay window            | `oauth_refresh_token.rotation_replay_response`                                  | Up to thirty seconds                                                                          | Replaced on the next rotation; encrypted with `BETTER_AUTH_SECRET`                             |
| MCP consent record                                  | `oauth_consent`                                                                 | 180 days after the last consent interaction                                                   | The hourly sweep removes consents past the window                                              |
| OAuth signing keys                                  | `jwks.private_key`                                                              | No expiry, no sweep                                                                           | Nothing; rotating them invalidates every live token                                            |
| Dynamic client registration                         | `oauth_client` (name, URIs, contacts, metadata)                                 | Unapproved registrations 7 days; at most 100 may be live                                      | The hourly sweep removes unapproved registrations; at the cap, registration is refused         |
| Provider session (the fantasy account's own cookie) | `provider_credentials.envelope` — AES-GCM ciphertext                            | Until disconnect or reconnect                                                                 | Disconnect hard-deletes it; reconnect replaces it and bumps the generation                     |
| Team identity and configuration                     | `provider_teams` (provider team and league keys, slots, automation, owner note) | Until disconnect sets availability, or the account is deleted                                 | Disconnect clears availability; account erasure deletes the row                                |
| Lineup run outcome and plan                         | `lineup_runs`, `lineup_run_attempts`, `lineup_write_intents`                    | Ninety days after a terminal outcome                                                          | `RetentionSweep` — except `uncertain` rows, which never age out (F10)                          |
| Run diagnostics                                     | `lineup_run_diagnostics`                                                        | Seven days by `expiresAt`                                                                     | `RetentionSweep`                                                                               |
| Feedback report                                     | `feedback` (title, body, optional tool, team reference, client label)           | Open and acknowledged stay; resolved and not-planned are deleted 365 days after closing       | `FeedbackRetention`                                                                            |
| Feedback quota                                      | `feedback_quota`                                                                | Until its hour can no longer accept a report                                                  | `FeedbackRetention`                                                                            |
| Hosted linking session                              | `hosted_linking_sessions` — status, timestamps, ticket **hash**                 | One day after the session ends                                                                | The hourly sweep removes terminal rows; cancelled and expired rows no longer stay              |
| Google identity tokens (only if Google is enabled)  | `account.access_token`, `refresh_token`, `id_token`                             | Until the account row changes                                                                 | Account erasure; the storage encryption remains F6                                             |
| Telemetry and traces                                | Cloud Logging wide events and Cloud Trace spans                                 | Cloud Run / Logging retention, owned by the platform                                          | Platform retention only                                                                        |
| Artifacts                                           | Container images in Artifact Registry; no user data                             | One image per package by the cleanup policy                                                   | Registry policy                                                                                |

What is deliberately absent, verified by reading the code that would carry it: no provider cookie, crumb,
page content, screenshot, keystroke, or password is logged, traced, recorded, or persisted; the hosted
browser holds them only in its ephemeral profile and sends exactly `T` and `Y` once, after the profile is
removed (`packages/hosted-browser/src/browser.ts`, `captureWhenSignedIn`). The wide-event writer drops
suffix keys `cookie`, `crumb`, `token`, `secret`, `password`, `email`, `note`, `body`, and `payload`
(`packages/backend/src/runtime/WideEventTracer.ts:362-374`). No provider payload, email address, note text,
or feedback body is annotated on any span in `packages/backend/src` or `apps/web/src` — checked by reading
every `annotateCurrentSpan` call site.

A subject access request is one export from Your data, and an erasure request is one typed confirmation
there. Both are owner-scoped and cover the same inventory. The table's retention windows are independent:
an erasure does not wait for any of them.

## Checked and found sound

Each item below was checked; silence would have been a gap, so each carries its evidence.

- **Concurrent session reuse and the ticket binding.** The hosted-linking ticket is 32 random bytes, stored
  only as a SHA-256 hash, compared to the presented value, and delivered in an `HttpOnly`,
  `SameSite=Strict`, `Secure` (when the request is HTTPS), path-scoped cookie that is deleted on cancel
  (`server-functions/connections/hostedLinkingServerFunctions.ts:58-71`). The stream authorizes with the
  application session cookie **and** the ticket (`server/hostedLinking/hostedLinkingStream.ts:47-77`), so a
  leaked stream URL alone is not enough, and a wrong owner is `not_found`. The descriptor that the web signs
  for the browser service is HMAC-SHA256 over a JSON payload, verified with a length-checked
  `timingSafeEqual`, bounded to a fifteen-minute remaining lifetime, and refused on session-id reuse
  (`packages/hosted-browser/src/descriptor.ts`, `apps/hosted-browser/src/server.ts:120-123`).
- **A session cannot observe another session.** One live browser per browser-service instance, enforced in
  three places: `live` in the service (`server.ts:120`), `containerConcurrency: 1` with at most two
  instances, and a fresh `mkdtemp` persistent profile destroyed on every exit path
  (`browser.ts`, `close()` → `removeProfile`). Capture reads only cookies that would be sent to the
  provider login URL, and the profile is removed **before** the cookie is sent onward.
- **Egress is address-based and rebinding-resistant.** Every destination is resolved per connection, refused
  if **any** answer is non-public, and the verified address is dialled directly with no re-resolution
  (`packages/hosted-browser/src/egress.ts`, `choosePublicAddress`, `destination`, `dialAddress`). The refused
  set covers metadata, loopback, RFC1918, link-local, CGNAT, documentation, benchmarking, multicast,
  reserved, and all IPv6 outside `2000::/3`, with IPv4-mapped IPv6 classified by its embedded address. The
  loopback exception exists only for a non-production fixture origin and its host is required to be loopback
  (`fixtureAuthority`). Chromium's resolver is blackholed, loopback proxy bypass is disabled, QUIC and
  non-proxied WebRTC UDP are off, and service workers are blocked.
- **Provider credentials at rest.** See F5 for the envelope. Additionally: the plaintext is only ever a
  `Redacted`, it is validated with the provider before it is encrypted
  (`ConnectionsLive.ts:73-86`), a decrypt is bound to the owner and connection it was written for, and a
  failed decrypt is one opaque error. The `CONNECTION_ENCRYPTION_KEY` is read through `Config.Redacted`,
  length-checked to 32 bytes, and imported non-extractable.
- **A stolen session's reach.** Session-authenticated server functions resolve the owner from the session
  and pass only that `UserId` down (`apps/web/src/server/auth/authenticatedUser.ts`); every domain read and
  write is owner-scoped in SQL, including the request-id conflict target. Sealed references (player,
  counterparty, trade offer, cursor) are AES-GCM values with authenticated data binding purpose, owner, and
  league, so a reference from one account cannot be opened in another
  (`internal/QueryTokens.ts`, `sealReference`/`openReference`). A stolen browser cookie therefore reaches
  everything the owner has and nothing else; a stolen MCP token reaches only its granted scopes.
- **Provider session material never crosses a client boundary.** No tool result, stream message, span
  attribute, task payload, or error detail carries it. `LineupDeliveryCloudTasks` sends run references and
  the worker loads and authorizes stored work. The hosted-browser service's environment holds only the
  descriptor key and `NODE_ENV` (`infra/hosts/cloudRun.ts:257`).
- **MCP scope enforcement is per tool and fails closed.** `mcpEndpoint.ts:25` derives the required scope
  from the tool's annotation before the handler is reachable, `resolveAccessToken` refuses a token without
  it (`BetterAuthAdapter.ts:206-252`), and a refusal is a 403 naming the scope. Retired names are accepted
  only as aliases and never advertised; the alias resolves to the current scope before comparison. A test
  asserts every shipped tool's scope is an advertised resource scope and that no retired name is required
  (`apps/web/src/server/mcp/mcpScopes.test.ts`). The onboarding grant reaches only read tools plus feedback
  submission and read-back, asserted by the same file.
- **Token lifetime, rotation, and the reuse window.** Access tokens last five minutes, refresh tokens thirty
  days from issue or last rotation, and every refresh rotates; a rotated token replayed inside thirty
  seconds replays the same response instead of revoking, and outside that window revokes the family
  (`BetterAuthAdapter.ts:432-434`; `@better-auth/oauth-provider` `invalidateRefreshFamily`). Refresh tokens
  are stored hashed; the replay response is encrypted with `BETTER_AUTH_SECRET`. DPoP-bound tokens are
  rejected (`resolveAccessToken` refuses a `cnf` claim) because this resource does not do DPoP — a token
  that claims a binding we cannot verify must not be accepted as a bearer token.
- **PKCE and public clients.** `@better-auth/oauth-provider` requires PKCE for `token_endpoint_auth_method:
  none` and by default for every client (`isPKCERequired`), and the provider is configured with only the
  `authorization_code` and `refresh_token` grant types (`BetterAuthAdapter.ts:435`).
- **The metadata documents tell the client the truth.** The authorization-server document advertises the
  five scopes the server accepts; the protected-resource document advertises the four that apply to `/mcp`
  and omits `offline_access`; no retired name appears in either. Asserted directly
  (`BetterAuthAdapter.test.ts`, "publishes one scope set…"). The 401 challenge names the resource metadata
  URL and the scope the tool needs; the 403 names the scope to request in addition.
- **The consent screen is not an open redirect or a preview of unverified scope text.** It validates the
  client id shape, strips the caller's cookie before the public prelogin lookup, rejects a requested scope
  that is not advertised, and renders only `scopes.filter(...)` from our own definitions
  (`BetterAuthAdapter.ts:231-309`). It shows the client identifier and an explicit "names are not verified"
  disclaimer. F13 closed the remaining inconsistency.
- **CSRF.** Server functions are same-origin RPC: with no `src/start.ts` request middleware, the framework
  applies its own default CSRF middleware to every server-function request
  (`@tanstack/start-server-core`, `createStartHandler.js:288`), which requires `Sec-Fetch-Site:
  same-origin`, else a matching `Origin`, else a same-origin `Referer`. `/api/auth/*` is protected by
  `better-auth`'s `originCheckMiddleware` against the single configured origin. The session cookie is
  `SameSite=Lax` by default, which closes the classic cross-site form POST as a second layer. No
  state-changing operation is exposed on `GET`.
- **Provider responses we do not understand cannot cause a write.** Every decode goes through a schema and
  maps a shape mismatch, a non-2xx, and a period mismatch to a named failure (`YahooProvider.readJson`,
  `decodePayload`, `ProviderPeriodMismatch`); a 401/403 becomes `provider.session_rejected` and marks the
  connection reconnect-required instead of retrying. A mismatch is never treated as an empty dataset, and
  no provider text is echoed into an error, a span, or a run outcome. A read is bounded to 30 s and 4 MiB;
  a write to 30 s and 256 KiB; every Yahoo URL is rebuilt and re-checked against the fixed origin, path, and
  an allowlist of query fields.
- **The worker's write path is serialized and reconcile-first.** A write intent is persisted before the
  request, an unresolved prior intent blocks a new write for that team, a timeout is `uncertain` and is
  resolved by readback rather than replayed, and the provider's readback — not the write response — is the
  authority for what changed (`internal/LineupWorkerLive.ts`, `LineupRunWorkflow`).
- **Feedback is owner-scoped with a real quota.** Twenty per owner-hour and ten per client-hour, reserved
  atomically in `feedback_quota` before the insert, with the text length-capped, control characters
  stripped, and stored as plain text that is never rendered as markup (`FeedbackText.ts`).
- **Sign-in brute force is bounded three ways.** Six digits, ten-minute lifetime, and three attempts per
  code (`BetterAuthAdapter.ts:441-445`). `better-auth`'s own rules allow three requests per client address
  per sixty seconds on the `/sign-in*` endpoints and three per client address per sixty seconds on
  `/email-otp/send-verification-otp`. Above that, the application allows five codes per **recipient** address
  per hour, keyed by a SHA-256 of the normalised address so the quota table itself holds no address
  (`BetterAuthAdapter.ts:145`, `SignInCodeQuotaRepository.keyFor`). Unrelated email-OTP paths (verify-email,
  change-email, request-password-reset, reset-password) are disabled outright.
- **The MCP server is stateless and request-scoped.** `handleMcpRequest` builds the handler layer per
  request from the resolved `UserId`, so one request cannot leave state that another request inherits.
- **Every MCP tool call spends a durable allowance.** Reads are 60 per client and 180 per owner a minute,
  writes 20 and 60 an hour, and `set_lineup` 6 and 18 an hour, counted in `tool_call_quota` before the tool
  runs and keyed by the token's owner and `client_id` rather than by client address. A refusal is a `429`
  with `Retry-After` and a JSON-RPC error, and the refused call is counted too
  (`contexts/toolCalls`, `mcpEndpoint.ts`).
- **Nothing in this repository logs a secret.** Cloud Run's own request log contains the path and status;
  the ticket lives in a cookie, which that log does not contain. The hosted-browser service logs one line
  per session with id, outcome, duration, failure class, and refused host and reason — verified in
  `apps/hosted-browser/src/server.ts`, `settle()`.

## Residual risk outside this audit

These are real and recorded elsewhere; naming them here keeps "checked and found sound" honest.

- The pinned Solid Start server transport carries the reflected-XSS advisory, mitigated by a local backport
  and a committed built-app regression. That is the publication gate, tracked in
  [DEPENDENCY-AUDIT.md](DEPENDENCY-AUDIT.md) and [release-readiness.md](release-readiness.md).
- Publication requires a coherent fixed dependency closure, installed-source acceptance, and live
  hosted-MCP acceptance; none of that is established by this audit.
- Every deployment-only claim in this document — the ingress rate limit on `/api/telemetry`, the client-IP
  header attribution, IAM invoker bindings, the Secret Manager version count, and the absence of a public
  tunnel — is unproven from source and must be re-verified against the deployed revisions before
  publication. This audit deployed nothing.
