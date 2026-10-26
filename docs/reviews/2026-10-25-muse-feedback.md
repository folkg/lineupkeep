# Independent review — Muse-feedback fixes

Date: 2026-10-25

Reviewer: independent of the changes. This review did not defend the implementation; it tested the
claims, wrote failing tests first for every fix it made, and leaves the design questions it should
not decide alone.

Baseline: `psvqtxun` (hosted browser deployment). In scope: every change after it through `mlxsuumx`,
including the in-flight token-lifetime change, plus the review fixes that follow this document.
`jj diff -r <change>` was the primary reading tool; full `bun checks` and all three E2E targets were
run serially at the end.

## Verdict in one line

The provider payload is decoded **once at the adapter boundary** into typed values and the league
settings bug was a real over-required field, not evidence that validation happens in the query
layer. The normalisation pre-pass is defensible and should be kept, but two of its rules are shape
guesses that need a fixture before they are extended. The Muse fixes are broadly principled. The
checks-speed work was not: Chromium-launching tests were left in the shared worker pool, and the
first honest hosted-browser availability check exposed a shutdown handler that never ran when no
browser existed. Both blockers are fixed.

## Per-commit verdicts

| Change                          | Verdict                     | Notes                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kkwunmnt` container tests      | Accept                      | Moving the fake-Docker tests into one file is correct. The tests own the process `PATH`, and one file per process is the right ownership unit.                                                                                                                                                    |
| `tnxxupvs` shared worker pool   | Accept with the blocker fix | Sharing one pool for ordinary node/browser files is right. Raising to 70 % also put Chromium-launching files beside six siblings; fixed below. `it.concurrent` on lint fixtures spawns many short oxlint processes but does not share mutable state.                                              |
| `mmmxppky` checks documentation | Accept                      | The check matrix now says `checks` runs no E2E and lists what each target proves. It matches `package.json`.                                                                                                                                                                                      |
| `suzonvyl` blank search         | Accept                      | The tool schema now accepts a blank value and the service returns `selection_invalid` with the remedy. The boundary the handler sees is tested at both service and MCP layers.                                                                                                                    |
| `xxkuvvlo` league shapes        | Accept after fixes          | Treating the three week-window fields as one optional unit matches the captured roto league. Degrading roster and matchup reads is right; calendar necessarily fails without the window. Roster team identity, league-team membership and game identity were still unchecked; fixed below.        |
| `qwtoxvsz` statistics basis     | Accept after fix            | Week basis is now chosen only for football when the week is known to be complete; hockey and explicit season reads use season. The unknown-current-week case was still labelled weekly and returned zero-filled current-week data; fixed below.                                                   |
| `tolytpmo` dropped identity     | Accept                      | Identity resolves roster → selected-player hydration → transaction history. `primaryPosition` is honestly optional because the transaction payload does not carry it. The fetch is bounded to 50 transactions and only runs for unresolved keys.                                                  |
| `zxqxlzuu` fixture test split   | Accept                      | The fixtures are data, every exported fixture is consumed by at least one test, and the provider tests feed them through the real transport seam and decoder. The dedicated normaliser fixtures assert the normaliser's contract rather than a decoder's private shape, which is the right layer. |
| `vyknvrtx` missing week window  | Accept                      | `blocked` now distinguishes “no scoring-week window” from “stale period”, with a remedy. The pause/expiry and target arithmetic is covered by deterministic tests, including DST boundaries.                                                                                                      |
| `vrxxswzn` fixture proof doc    | Accept                      | It correctly requires captured structure and a new fixture for a new shape. One sentence overstated “only known fragment fields merge”; corrected in this review.                                                                                                                                 |
| `kwomnyny` token-free discovery | Accept after fix            | Token-free `server/discover` is the intended shape and the version check is tested. It advertised `logging`, `completions` and `tools.listChanged` that the server does not serve; fixed below.                                                                                                   |
| `nwmusvyw` tool-result budget   | Accept                      | The budget now counts both the structured payload and the escaped text copy a real client receives, not only the structured half. The narrowing-required path is retained, and the boundary is tested with a record that only fails after escaping.                                               |
| `xrkpxnrp` CIMD redirect        | Accept                      | The patch distinguishes a policy-refused redirect from a network failure and the tests cover both. It does not weaken redirect refusal; it makes the refusal honest.                                                                                                                              |
| `mloyklym` first requests       | Accept                      | The published requests match the endpoint, including `_meta`, protocol header, DCR fallback and the dual result representation. Later commits updated the scope count to six resource scopes.                                                                                                     |
| `vmlxmxqx` automation controls  | Accept                      | Ownership is enforced in the repository query, not the tool; unavailable is separate from enrollment; pause uses named-zone calendar arithmetic and `expirePauses` restores eligibility on the next normal check. Repeated/contradictory actions are no-op/rejected as documented.                |
| `uqnnqrwppkqu` feedback         | Accept with nits            | The record is owner-scoped at every query and triage path; foreign ids are `not_found`; the MCP tools never take an owner. Quota, retention, plain-text handling and the UI/MCP layers are exercised. See nits for context-team ownership and refused-attempt counting.                           |
| `mlxsuumx` grant lifetime       | Accept after E2E fix        | Five-minute access tokens and 30-day rotating refresh tokens are set explicitly, persisted signing keys are proven across a fresh auth instance, and the E2E really waits for expiry. The hosted-linking E2E was skipped on two targets; fixed below.                                             |

## Primary question: is validation at the source or patched by hand?

**At the source, with a deliberate hand-written layer for semantics the schema cannot express.**

1. **The decoding boundary is the adapter edge.** `readJson` (`YahooProvider.ts:531-576`) parses JSON
   once, applies `normalizeYahooJson`, and every read then crosses exactly one
   `Schema.decodeUnknownEffect` in `decodePayload` (`YahooProvider.ts:641-648`). Raw provider JSON does
   not cross the `ProviderGateway` interface. The query layer (`FantasyQueriesLive.ts`) selects,
   groups, budgets and maps typed provider values; it does not re-parse or defensively re-decode
   provider payloads. Its checks are domain checks: does the requested period fall inside the
   league season, is the connection ready, does this team belong to this owner.
2. **Field validation lives in Effect schemas.** The ~154 schema constructs are real: key shapes,
   numeric strings, flags, optional versus required fields, roster containers, stat coverage,
   transactions and membership. The ~18 `typeof` expressions are schema transforms (`Season`,
   `IntFromStringOrNumber`, `Flag`), URL safety and response-shape inspection — not ad-hoc field
   validation scattered through services.
3. **What remains hand-written is cross-field and cross-request validation.** `weekWindow`
   (`YahooProvider.ts:783-800`) enforces “three week fields or none”; `rosterFromPayload`
   (`YahooProvider.ts:802-...`) compares declared container coverage with every player entry; `statSeries`
   compares returned coverage with the requested basis; `readLeagueTeams` compares every team key with
   the requested league. Schemas cannot express “the response is for the team I asked for” without
   request context, so this belongs beside the decode. It is not a monkey patch, but it is the part
   that has to be kept small and tested.
4. **The league bug was an over-required schema field, not a missing hand check.** `current_week`,
   `start_week` and `end_week` were required; a rotisserie league publishes none. Making them one
   optional unit is the right fix. The same class still existed for roster/team and league/team
   identity and is fixed in this review.

The answer to “are the schemas doing the work?” is **yes for payload fields, no for request-relative
coverage and membership**. The latter is a legitimate adapter responsibility, but it is where the
next bug of this class will live, so it needs fixtures for each captured variant.

## Is the `YahooJson` pre-pass defensible?

**Keep it. Do not fold it into the schemas; do not replace it with a second decoder.** Folding the
same union into every schema site would spread the provider's shape knowledge across dozens of
schemas, make every schema difference a branch, and lose the one place where the shape rules can be
tested. Replacing it with a schema-first decoder with explicit unions would be a larger rewrite for
no additional field coverage.

The pass is doing three separable things:

- numeric-keyed maps become ordered arrays and expose sibling metadata (`normalizeRecord`,
  `YahooJson.ts:30-48`);
- nested fragment lists flatten, empty placeholders disappear, and disjoint-field records merge into
  one resource (`normalizeFragments`, `YahooJson.ts:60-74`);
- known single-key wrappers (`{ player: [...] }`, `{ team: [...] }`) unwrap before that decision.

The first two rules are **guesses about provider shape**, not types. They are backed by captured
fixtures and are the reason the real payloads decode at all. The review keeps them, but records two
limits:

- A numeric-keyed object that is a **map**, not a collection, is flattened to `entries`. The captured
  NHL settings fixture contains `week_has_enough_qualifying_days: { "1": 1, "2": 1, "3": 0 }`, which
  becomes `[1, 1, 0]`. Nothing reads it today. If qualifying-day data is ever needed, add an explicit
  rule and a fixture; do not add a decoder field onto the flattened value.
- Any singular-named list of records with disjoint fields merges into one resource. That is what
  Yahoo does for attribute fragments, but it is a heuristics, not a type. A new singular collection
  with disjoint fields would be silently merged. The safe next step is a fixture for a newly observed
  shape before changing the rule; the current captured set passes.

No rule in the pass should be extended without a captured fixture. That is the review's demand, not
a defect in the existing fixtures.

## Are the degraded-mode fixes principled?

Mostly. `readLeague` now returns an outcome rather than aborting the query, `rosterCoverage` and
`leagueCoverage` are derived from the actual dependency, and the degraded entry carries the failure
message and field. Roster and matchup reads proceed without the settings; calendar reports `failed`
when the league read failed because it cannot invent the week window, and `unsupported` when the
league is readable but publishes no window. Review links still fail when the league read fails because
the verified league web URL is the link base; failing is safer than generating a link from an
unverified URL. That is a real dependency, not a per-call special case.

Two gaps were fixed here:

- when the roster also failed, the league failure disappeared from coverage and failures; the roster
  failure path now carries the league outcome;
- when selected-player details failed, the coverage entry lost the reason (and suppressed
  `period_unavailable` with no replacement text); it is now `degraded` with the provider message, and
  each player's unsupported stat group names that reason.

A degraded league read must not silently turn current-week zero-filled statistics into “weekly
actuals”. The basis is now `season` whenever the current week is unknown, so the response never
labels an unproven week as complete.

## Do the captured-shape fixtures constrain the decoders?

Yes for the provider fixtures: every exported provider fixture is consumed by a `YahooProvider.test.ts`
case through `recordingInternet` and the real decoder, and the test assertions are on decoded values
and requests, not on fixture echoes. The normaliser-only fixtures are consumed by `YahooJson.test.ts`
and assert the normaliser's output; that is the correct seam, but those cases do not constrain the
provider schemas. The combination is sound: provider fixtures exercise both stages, normaliser
fixtures pin the structural rules.

The weakest test-quality point is old invalid-response cases that use invented minimal payloads rather
than a captured fixture with a field removed. They still prove the failure path but not the shape.
New named failures in `xxkuvvlo` use captured variants (`WithoutEndWeek`, text `num_teams`, another
league), which is the right pattern to continue.

## Ranked findings

### Blocker

1. **`bun checks` was flaky because Chromium tests shared the 70 % pool.**  
   Files: `vitest.config.ts:11-16`, `vitest.config.ts:88-102`; test set: `apps/hosted-browser/src/server.test.ts`,
   `apps/web/src/server/hostedLinking/playwrightHostedBrowser.test.ts`,
   `apps/linking-helper/src/ProviderBrowser.test.ts`.  
   Why: three files launch a persistent Chromium; under seven sibling workers the 60 s test timeout is
   reachable even though the file passes alone in ~1.7 s. Raising the timeout would hide contention and
   make the suite slower, not stable.  
   Fix (done): a separate `chromium` project with `maxWorkers: 1` and `sequence.groupOrder: 1`, excluded
   from the shared `node` project. It runs after the shared pool, so browser startup never competes with
   six siblings. `test:node` now runs both node projects. Evidence: three consecutive full `bun checks`
   runs below.

   A second, unrelated flake surfaced while proving the fix: one `scripts/verificationLifecycle.test.ts`
   run timed out after the 300 ms deadline because `acquireInfrastructure` could be called after the run
   signal had aborted. The fake then registered its abort listener too late and never rejected, so the
   test hung. Production now checks the signal before creating infrastructure, and the fake also rejects
   an already-aborted signal. This produced 1 failure in 6 full runs before the fix and none after.

2. **The SIGTERM handler was a no-op when no hosted browser existed.**  
   File: `apps/web/src/server/targets/node.ts:41-51`.  
   Why: `deploymentTarget.hostedBrowser?.closeAll().catch(...).then(...)` short-circuits the whole
   chain when `hostedBrowser` is `undefined`; the handler installed for SIGTERM then never calls
   `backend.dispose()` or `process.exit`. A browser-less Node deployment was killed after the Docker
   stop timeout (exit 137), and the container safety test caught it. This was introduced by the
   availability fix in this review.  
   Fix (done): close only the browser when present, then always dispose and exit. Regression: the
   existing `infra/local/container.container-safety.test.ts` failed with 137 before and passes with 0.

### Should-fix

3. **Hosted linking was skipped on Cloudflare and container, hiding the degradation.**  
   File: `e2e/hostedLinking.e2e.ts:1-27`.  
   Why: `test.skip` removed all coverage on two targets, and the container image had no honest path
   either: it attempted to launch a missing Chromium and reported a generic browser failure.  
   Fix (done): the node target reports `hosted_browser.unsupported` when the Playwright Chromium
   executable is absent (`playwrightHostedBrowser.ts:15-21`, `targets/node.ts:24-31`); the E2E runs the
   full owner-bound stream on Node and asserts the honest unsupported message and no WebSocket on the
   other targets. All three targets pass.

4. **Roster responses did not prove which team they belonged to.**  
   File: `YahooProvider.ts:814-818`, schema at `1554-1564`.  
   Why: a 200 roster for another team would be labelled with the requested key. That is the same class
   as the original “required field one league omits”: a validated field that the adapter did not check.  
   Fix (done): `TeamRosterPayload` requires `team.team_key` and `rosterFromPayload` compares it with the
   requested team. Test: `rejects a roster returned for a different team` (fails on the parent).

5. **League membership did not prove team keys belonged to the league.**  
   File: `YahooProvider.ts:433-439`.  
   Why: trade review links use `readLeagueTeams` for counterparty validation; a foreign team key could
   survive membership checks and produce a review link for another league.  
   Fix (done): every returned team key's league prefix must equal the requested league. Test:
   `rejects league membership that names another league` (fails on the parent).

6. **Discovery did not prove the returned game matched the requested sport.**  
   File: `YahooProvider.ts:690-719`, schema `1429-1433`.  
   Why: a mislabelled game would tag every team with the wrong sport and league context.  
   Fix (done): `GamePayload` requires `code` and `teamsFromPayload` rejects a game whose `code` is not
   the requested league. Test: `rejects a discovered game that does not match the requested sport`.

7. **Unknown current week was treated as “completed week”.**  
   File: `YahooProvider.ts:968-982`.  
   Why: after a league read failure, `currentWeek` is undefined; the old condition still selected
   `stats.type=week`. Yahoo reports zero for the current/future week, so a degraded read could present
   zero-filled in-progress statistics as completed weekly actuals.  
   Fix (done): week basis requires `currentWeek !== undefined && period.week < currentWeek`; otherwise
   season. Test: `uses the season basis when the current week is unknown`.

8. **A failed player-details read lost its reason.**  
   File: `FantasyQueriesLive.ts:748-765`.  
   Why: the coverage entry was `unsupported` with no detail while the failure was deliberately omitted
   to avoid a contradictory `period_unavailable`. The client saw only a generic per-player message.  
   Fix (done): `unsupported` stays for an unsupported operation; a failed read is `degraded` with the
   provider message, which is also the per-player unsupported detail. Test:
   `never pairs an unsupported stat group with a period failure` now asserts the detail.

9. **A roster failure erased the league failure when both failed.**  
   File: `FantasyQueriesLive.ts:484-486`, `1274-1296`.  
   Why: degraded coverage is only useful if it survives the primary failure. The old `rosterWithoutData`
   returned only the roster failure and coverage.  
   Fix (done): it now carries `leagueCoverage` and `leagueFailure`. Test:
   `keeps the league failure when the roster read also fails` (fails on the parent).

10. **Discovery advertised capabilities the server does not implement.**  
    File: `apps/web/src/server/mcp/mcpEndpoint.ts:118-121`.  
    Why: `logging`, `completions`, and `tools.listChanged: true` were hardcoded. The server serves tools
    and sends no list-changed notification, so a client could take an unsupported branch.  
    Fix (done): advertise only `tools: {}`. Test: `identifies the product during protocol discovery`
    asserts exact capabilities (fails on the parent).

11. **Two docs statements did not match the code.**  
    Files: `docs/fantasy-manager/MCP.md:93`, `docs/fantasy-manager/RESEARCH.md:136-142`.  
    Why: MCP.md claimed calendar reads are not erased when league settings fail; calendar necessarily
    reports failed without the window. RESEARCH.md claimed only known fragment fields merge; the
    normaliser also merges any singular list of disjoint-field records.  
    Fix (done): both now describe what the code does, including the calendar dependency and the exact
    merge rule.

### Nit / owner decision

12. **`providerNumber` turns an unknown non-numeric string into `null`.**  
    File: `YahooProvider.ts:1197-1207`. Known missing forms (`""`, `"-"`) are captured; a new sentinel
    or provider change would be silently reported as missing. Fixing this needs a captured payload or a
    deliberate “unknown string is invalid” decision. Not changed.

13. **`YahooJson` numeric-key maps become `entries`.**  
    File: `YahooJson.ts:30-48`. The captured `week_has_enough_qualifying_days` map is flattened and
    ignored. Safe today because no decoder reads it; add an explicit rule before anyone does.

14. **`readRoster` maps any HTTP 400 with a week selector to `period_unavailable`.**  
    File: `YahooProvider.ts:203-215`. The research observed exactly this for an NHL week request, but a
    different 400 would be mislabelled. The response body is discarded, so the adapter cannot split the
    cause without a provider change. Leave unless a second 400 cause appears.

15. **The current-period rule is implemented twice.**  
    Files: `LineupWorkerLive.ts:591-620`, `FantasyQueriesLive.ts:1360-1377`. `resolveTarget` and
    `currentPeriod` both decide whether `currentWeek` is inside the window. Extract the pure predicate
    when this area is next touched; not worth a refactor now.

16. **Feedback context accepts a team UUID without checking ownership.**  
    Files: `Feedback.ts:56-60`, `feedbackPrefill.ts`. The value is stored and shown only to the same
    owner and never used to read a team. If it becomes actionable, validate it against the owner's
    teams; today it is an opaque label.

17. **The feedback quota counts refused attempts.**  
    File: `FeedbackRepository.ts:59-92`. Over-limit requests increment both counters before returning
    `false`. The window resets hourly, so this is bounded, but a client can consume its owner's backstop
    with refusals. Decide whether refusals should count; the per-owner limit is still the backstop.

18. **Old invalid-response discovery tests use invented minimal payloads.**  
    File: `YahooProvider.test.ts:221-267`. The new captured-shape rule is applied to the league
    failures; the older cases would be stronger as the captured fixture with one field removed. Test
    quality, not behaviour.

## Fixes made in this review

| Change                                                              | Test that fails on the parent                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `test: schedule Chromium-launching node tests outside...`           | structural: the three files left the shared pool; `bun checks` x3 |
| `fix: verify discovered games and roster/league team...`            | three provider tests named above                                  |
| `fix: keep the statistics basis honest...`                          | provider season-basis test; player-details coverage detail test   |
| `fix: assert hosted linking honestly on every target`               | Node/Cloudflare/Container hosted-linking E2E and container safety |
| `docs: describe the decoder boundary...`                            | no behaviour; docs now match the assertions                       |
| `fix: advertise only the capabilities discovery serves`             | exact capabilities assertion                                      |
| `fix: retain league coverage when a roster read also fails`         | roster/league double-failure test                                 |
| `fix: do not create verification infrastructure after cancellation` | lifecycle deadline test (1 failure in 6 full runs before)         |

The shutdown regression was found while proving the container target and fixed in the same change as
the honest availability check.

## Verification

- `bun checks` was run six times while the review was in progress: five green, one failure in
  `scripts/verificationLifecycle.test.ts` before its cancellation race was fixed. Three consecutive
  full runs after the last code change are green. The reported 117 s / 60 s-timeout failure was
  load-dependent; the fix removes the contention structurally rather than extending the deadline.
- `bun run test:e2e` (Node): 51 passed.
- `bun run test:e2e:cloudflare`: 51 passed.
- `bun run test:e2e:container`: 51 passed, including the infrastructure safety test that previously
  exited 137.
- Suites were run serially. Each new regression was observed failing against the parent revision before
  the fix and passing after it.

## What is deliberately left for the owner

- Whether the normaliser's numeric-key map flattening should become an explicit rule now, or wait for a
  consumer of qualifying-day data.
- Whether an unknown string sentinel in a statistic value should fail the read or remain null.
- Whether refused feedback submissions should consume the hourly quota.
- Whether feedback context should validate a team reference against the owner's teams.
- The `readRoster` 400 classification, which needs a second observed cause before it can be split
  honestly.

None of these is a release blocker; each is a design question with a concrete tradeoff, not a missing
test.
