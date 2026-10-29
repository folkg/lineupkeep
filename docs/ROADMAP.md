# Roadmap

Tracked work for Lineupkeep. Stages 0–8 of the [delivery plan](fantasy-manager/DELIVERY-PLAN.md) are
complete and deployed; this file tracks what remains, including defects, operational gaps, and product
work that needs a decision before it becomes implementation.

Check an item only when it is verified, not when it is written. Each item names how it will be
verified, because "done" has meant different things at different times in this project.

## Current state

| Area                 | State                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Phase 1 (stages 0–6) | Complete, deployed, live-accepted                                                              |
| Phase 2 (stages 7–8) | Complete, deployed, hourly automation verified                                                 |
| Lineup algorithm     | Custom solver live for all five owner teams, seven consecutive verified ticks                  |
| Provider boundary    | Providers injected through a keyed registry; no adapter import outside the composition root    |
| MCP surface          | 17 tools, seven scopes, per-tool enforcement; rounds 2 to 6 resolved and deployed              |
| Client feedback      | Zero open items after round-6 triage on 2026-10-29                                             |
| Connections          | Hosted browser only; the local helper and its device flow are deleted                          |
| Interface            | Voice, connections, teams, activity and the mobile browser reworked from the owner walkthrough |

## 1. MCP client feedback — round 2

Source: Muse round-2 report, Oct 26 2026. Round-1 items are regression-tested as fixed except where
noted. These are ordered by severity.

### R2-6 — full-set scope enforcement locks out restricted clients (top priority)

Every call requires all seven advertised scopes, so a client platform that refuses `teams:manage` and
`feedback:manage` cannot read anything. Muse worked for ~30 minutes on a five-scope grant and then began
receiving the full-set 401 on ordinary reads.

- [x] Each tool declares the single scope it needs, and enforcement happens per tool
- [x] A token holding `fantasy:read` can call read tools without holding write or manage scopes
- [x] A 403 names the missing scope for _that tool_, not the whole advertised set
- [x] The 401 challenge no longer instructs clients to request scopes the call does not need
- [x] Test: a five-scope grant reads successfully and is refused only on the manage tools
- [x] Verify with a real restricted-scope grant against the deployed server

### R2-5 — review links use the wrong provider path (high)

`generate_transaction_review_links` emits `/add?apid=…&dpid=…`; the working form is
`/addplayer?apid=…&dpid=…`. Every link from rounds 1 and 2 lands wrong while the tool reports `ok`.

- [x] Correct the path template: `addplayer` for add and add/drop, team-scoped `dropplayer` for drop,
      and an explicit unsupported result for trade, whose page has no verified parameterized prefill
- [x] Fixture test asserting the exact URL per supported sport, so a template change cannot ship silently
- [x] Report the template version in the tool result so clients can detect staleness
- [x] Verify each intent's generated link opens the intended review page for the intended player
      against all five linked leagues (see RESEARCH.md)

### R2-2 — feedback cannot be submitted from restricted clients

`submit_feedback` requires `feedback:manage`, so the channel for reporting the scope problem is behind
the scope problem.

- [x] Submitting feedback requires a narrower grant than triaging it
- [x] Rate limits and owner scoping still apply to submission
- [x] Test: a read-only grant can submit feedback but cannot list or triage it

### R2-0 / R2-1 — a scope-set change invalidates every existing grant

Yesterday's grant died the moment the advertised set grew, with no grace path. New scopes are also
rejected as "invalid" by the client connect flow even though both discovery documents advertise them.

- [x] Adding a scope no longer invalidates grants that do not need it
- [x] Existing grants keep working for previously-existing scopes; only new-scope tools 403
- [x] Documented as versioned behaviour rather than incidental
- [x] Protected-resource metadata and authorization-server metadata record the deliberate
      `offline_access` difference with a citation
- [x] Confirm whether the client-side rejection is stale metadata caching and record the finding

### R2-3 — roto standings return unexplained nulls and unlabelled stat ids

`categoryPoints` is null for GA, SA and SV while their totals are present, and the category arrays carry
stat ids that appear in no scoring dictionary. A client cannot distinguish "not published" from zero.

- [x] Populate category points where the provider publishes them
- [x] Where it does not, say so explicitly instead of returning null
- [x] Name or omit stat ids that appear in no scoring dictionary
- [x] Build realistic captured fixtures so this class of gap is caught by tests rather than by a client

### R2-4 — search rows omit the field the sort advertises

Rows sorted by `actual_rank` do not surface a rank value, and `percentOwnedChange` was null everywhere
tested, so a client cannot explain the ordering it was given.

- [x] Align row field names with the sort names
- [x] Surface the rank value that the sort orders by
- [x] Confirm whether `percentOwnedChange` is genuinely absent or dropped in decoding

## 2. MCP client feedback — round 3

Source: Muse round-3 report, filed through `submit_feedback` on Oct 28 2026. These are the first
reports filed through the product's own feedback channel. Ordered by severity.

### R3-3 — `get_team_summary` was unreachable for every hockey team

The summary asked for narrowing on `team_summary.roster` but exposed no `groups` or selection input,
and the returned record token was not a cursor. A 22-player hockey roster never fit, so the one-call
snapshot could not be used for four of the owner's five teams.

- [x] Add a `groups` input (`league`, `standings`, `categories`, `matchup`, `roster`) with league,
      standings, matchup, and roster as the default, and make category arrays opt-in
- [x] Page the roster with a cursor the tool issues and accepts; keep every fixed section on each page
- [x] Name the selectable groups and the remedy in every summary narrowing result, and omit the
      misleading record token from a paged summary
- [x] Test: a multi-section summary pages a 40-player roster to completion, accepts each cursor, and
      fits every page inside the hard budget; a one-record overflow names the groups
- [x] Verify live: the 21-player hockey roster returned league, standing, record, 10-team standings,
      matchup, and schedule, then paged 10 + 11 through the returned cursor

### R3-7 — `submit_feedback` rejected a null optional context field its schema allowed

Three of five calls failed with an opaque `400 Invalid tool arguments`; the published JSON schema
marked the optional context fields nullable, while the validator rejected `null`.

- [x] Accept `null` for optional feedback context fields and a null context object, normalizing them
      away before storage; keep the response context non-null
- [x] Return the offending field path from every invalid-arguments 400, in the message and in
      `error.data.field`
- [x] Test: the published schema and validator agree for `context.tool: null`; an invalid limit names
      `["limit"]`
- [x] Verify live: `submit_feedback` accepted `{tool: null, ...}` and stored only `client` and
      `surface`; an invalid summary limit returned 400 naming `["limit"]`

### R3-8 — `get_players` silently ignored `period`

`actual_stats` returned identical season totals for a supplied week, so a client could not tell
whether the argument was honoured.

- [x] Declare which sports publish weekly player series on the provider capability, and check it in
      the generic query layer rather than by provider name
- [x] Honour `period` for a completed week where the sport declares a weekly series
- [x] Refuse a period the provider cannot honour with the reason and the remedy; never fall back to
      season totals silently
- [x] Test: hockey refuses a period, football refuses the current week, and the declared capability
      gates the decision
- [x] Verify live: hockey week 4 was refused with the remedy; football week 7 returned basis `week`
      with week-7 values
- [ ] **Date-scoped recent-window splits.** Yahoo publishes date-scoped player statistics for
      hockey (`stats.type=date`, verified 2026-10-28) but no weekly series. Last-14/30-day waiver
      splits need a neutral date basis, date-window reads, and aggregation that does not sum rate
      statistics. Deferred until a date-window contract is designed; verify against the live
      hockey read and a captured fixture before exposing it.

### R3-5 — transaction rows omitted inline identity

`get_transactions` returned only references plus direction, so naming who moved cost a
`get_players` join per transaction.

- [x] Add the provider's inline identity to transaction player rows, consistent with
      `search_players`, while keeping the private reference and dictionaries canonical
- [x] Carry the professional team through the adapter
- [x] Test: a transaction row carries name, display position, and professional team with its
      reference
- [x] Verify live: the hockey transaction window returned name, display position, and `proTeam`
      inline

### R3-4 — do deploys invalidate grants?

The reporter saw reauthorization after three deploys and suggested a key grace window or a
changelog warning. Production evidence showed one signing key and long-lived refresh tokens.

- [x] Record the pre-deploy access token and refresh token, deploy, and test both
- [x] Confirm the `jwks` table and grant records were not rotated by the deploy
- [x] Document the result plainly in the MCP contract and changelog: deploys do not require
      reconnection; access tokens expire in five minutes by design; clients must persist each
      rotated refresh token, and replay after the 30-second window revokes the grant
- [x] Evidence: the round-3 deploy (web `00027-kwq`, worker `00028-29h`) accepted a pre-deploy
      access token and a pre-deploy refresh token; the single 2026-10-25 EdDSA key was unchanged

### R3-6 — the stray connection was not a lifecycle leak

A second Yahoo connection appeared on Oct 27 and disconnected two minutes later. It has no
`provider_credentials` row, so the disconnect path cleaned up the stored session.

- [x] Strengthen the disconnect test: prove the credential exists before disconnect, is deleted
      after, and the disconnected connection row remains without a credential generation
- [x] Record the answer in the feedback entry's resolution note

## 3. MCP client feedback — round 4, part 1

Source: Muse round-4 report, filed through `submit_feedback` on Oct 28 2026. Findings R4-5 to R4-8
(transactions and draft picks) are tracked separately.

### R4-4 — a period concept that declares what it can serve

`get_players` accepted only `{week: n}`, so every hockey request for actual statistics was refused and
a recent window could not be asked for at all; the client probed fourteen shapes to find the boundary.

- [x] Period kinds: season, scoring week, preset windows (`last_7_days`, `last_14_days`,
      `last_30_days`), and an explicit inclusive `{start, end}` range
- [x] Per-sport provider support declared as data beside the other capabilities: `native`,
      `aggregated`, or `unsupported`, plus preset windows and the range cap
- [x] Discoverable before a call: the tool description lists the accepted shapes and the result
      carries `periodSupport`; an unsupported kind is refused naming the kind, whether it is served at
      all, and what can be asked instead; season totals are never substituted
- [x] Hockey preset windows and ranges served by summing daily provider reads, batched per day across
      all requested players, capped at 31 days, with a whole-season range served as the season
- [x] Hockey scoring weeks stay refused, now as a declared capability with a remedy
- [x] Test per provider that the declared table matches what the adapter does, for every sport and
      period kind
- [ ] Verify live: a hockey preset window summed against the live daily series, a range cap refusal,
      and a football preset refusal

### R4-2 — a roto standings table should fit in one call

`get_league` with only the standings group returned one team per page, so a 13-team table cost 13 calls.

- [x] Compact standings: rank, points, and record for every team in one result, without per-category
      payloads
- [x] Keep the detailed per-category view, and state in the section that it pages
- [x] Test: a 13-team compact read returns every team in one result inside the budget
- [x] Verify live: the owner's 13-team rotisserie league returned every team in one call

### R4-3 — inline stat names in category totals

- [x] Category values carry the league's stat name beside the private reference in `get_league`,
      `get_matchups`, and `get_team_summary`
- [x] Test: a season category total carries its name and value without a dictionary read

### R4-1 — resolve the duplicated ownership field

- [x] `search_players` publishes one ownership-change field, `percentOwnedDelta`; the always-null
      `percentOwnedChange` is absent from the response and the published output schema
- [x] Both change fields state the provider window they measure
- [x] Test: a search row carries the provider delta once, and a missing started change stays null

## 3a. MCP client feedback — rounds 5 and 6

Source: the client's round-5/6 report, filed through `submit_feedback`. Ordered by value.

### R6-1 — provider-tracked stats presented as league scoring categories

`get_league` scoring listed fifteen categories, all `enabled: true`, including Saves and Shots
Against in a head-to-head league that does not score them, and `get_players` scoring context repeated
the list. A client built a recommendation on a category that does not count.

- [x] Derive the scoring surface from the league's configured categories, using the provider's
      display-only marking rather than its enabled flag
- [x] Mark every published stat `scoring` or `informational`, with the deciding flag named on each
      informational entry, in the scoring dictionary, standings totals, roto points, and matchup
      categories
- [x] List scoring categories only in `get_players` scoring context, and refuse an informational stat
      as a stat-sort key with the reason
- [x] Test: a league whose configured categories exclude a stat does not mark it scoring
- [x] Verify live: the owner's head-to-head hockey league returns fifteen categories, thirteen scored,
      Saves and Shots Against display-only (see RESEARCH/MCP evidence, 2026-10-29)

### R6-2 — no injury status where screening happens

`get_players` carried an injury object, but `search_players` rows carried no status, so a client
screening free agents could not see an injured-reserve player.

- [x] Put a compact status on search rows: healthy, day-to-day, out, injured reserve, or unknown
- [x] Pass through the provider's own code and wording, and the instant the status was observed
- [x] Never let an unknown code read as healthy
- [x] Test: search rows carry a status and an observation time, and an unknown code stays unknown
- [x] Verify live: the search payload returns `status` on every sampled row (`false` when healthy, a
      code when not) beside `status_full` and `injury_note`; no extra provider read is needed

### R5-2 — a summary attached a roster page nobody asked for

A four-group request without `roster` returned `narrowing_required` blaming the roster.

- [x] Include a roster page only when the `roster` group is requested
- [x] Name what actually consumed the budget: the roster page when requested, otherwise the selected
      sections
- [x] Test: a summary without the roster group carries no roster page; an overflowing request without
      it blames the selected groups

### R5-1 — a cursor error did not say what went wrong

Reusing a cursor with a different `groups` array answered "invalid or expired".

- [x] Distinguish a mismatch, an expiry, and an unknown cursor when opening a continuation
- [x] Say in the error and in the published `cursor` description that a cursor is bound to the
      request arguments
- [x] Test: a cursor reused with different arguments is refused as a mismatch naming the binding

### R6-3 — a submitter could not read back their own reports

`submit_feedback` worked under a lesser scope while `list_feedback` required `feedback:manage`.

- [x] Let a submitter list their own submissions and statuses under the scope submission uses
- [x] Keep triage behind `feedback:manage`, and keep ownership the boundary: a submitter never sees
      another account's reports
- [x] Test: a read grant lists its own report and cannot triage; a service test pins owner isolation

### R2-3 (reopened) — roto categories that publish no points

Totals publish for categories whose rotisserie points the provider leaves empty.

- [x] Publish points where the provider supplies them
- [x] State per category, in the row itself, that the provider publishes no points for it
- [x] Include a configured category the provider omits from a points array, so a missing entry is
      stated rather than absent
- [x] Test: a rotisserie category with no published points carries a `not_published` entry naming the
      gap

### Manage scopes could not be granted

Reported as: a connect flow requesting `teams:manage` and `feedback:manage` reached the hosted page,
then failed with a generic error naming no scope. Not reproduced; no scope path on our side refuses
either scope. Evidence, the two client-side candidates, and the next step are recorded in
[MCP.md](fantasy-manager/MCP.md#manage-scope-connection-failure-2026-10-29-investigation).

- [x] Check the consent and authorize path for both manage scopes against a fresh client locally and
      on the deployed origin
- [ ] Obtain the failing authorization's `error`/`error_description` and the client's registered or
      metadata-declared scopes before changing our path

## 3b. Interface rework from the owner walkthrough

Source: the owner's screen recording and written notes, 2026-10-28. Every item below is built, verified
by browser test and screenshot, and deployed.

- [x] **Voice.** No emdashes anywhere in product copy, no slogan headline, and no page repeating the
      product description another page owns. Landing leads with what the product does.
- [x] **Failed attempts leave nothing.** A hosted connection row was created when the session started, so
      abandoned attempts piled up as dead rows. A connection now exists only after a link succeeds, the
      three abandoned rows were deleted, and a migration test pins the ordering.
- [x] **Connection identity.** Each row names the team count, when it was connected, and what its status
      can do, without storing or showing any account identifier.
- [x] **Helper affordances.** Pairing codes, approve and cancel buttons, and the reconnect form are gone
      from the web surface, and the helper itself is deleted with its device flow and columns.
- [x] **Teams.** One line of context, what the last check actually did, and a recent-change tally. Status
      words appear only when something needs attention.
- [x] **Optimistic toggles.** One switch per team predicts from the in-flight mutation and returns to the
      server's confirmed state with a message when the write is refused.
- [x] **Quiet activity folded.** Consecutive checks that changed nothing collapse into one expandable
      line; changed, blocked, failed and in-progress runs stay on their own.
- [x] **Small fixes.** Times in the reader's zone, a back affordance from team and run pages, and feedback
      pre-filled with the team it was reported from.
- [x] **Mobile browser.** A real input surface so a phone keyboard opens, a phone viewport profile so the
      provider renders its own mobile layout, paste support, and no crosshair cursor.
- [x] **Google-account hint.** The phone-number workaround is a collapsible hint on the connections page
      and a one-line reminder inside the session.
- [x] **Two test stalls fixed structurally.** The browser reports input readiness from the live DOM
      instead of a timer, and shutdown awaits session teardown so profile removal cannot race Chromium.
      Fourteen consecutive chromium runs green.

## 4. Operational gaps

- [ ] **Database restore drill.** Back up, restore into a scratch database, prove the application reads
      it. Never rehearsed; the largest unverified operational claim.
- [ ] **Hosted-browser live sign-in.** Operator handshake and real login page load are proven, and the
      owner completed a real provider sign-in through the deployed app on 2026-10-29 using the phone-number
      route. Still unproven: a clean first-time sign-in by a different person on a phone.
- [ ] **Publication security gate.** A temporary backport of an upstream fix is in force. Removal
      condition and acceptance are recorded in [release-readiness.md](release-readiness.md); replace it when
      the fixed upstream parent ships.
- [ ] **Dependency audit refresh.** The prior scan's 47 records are untriaged, and the lineup work added
      `munkres` and no other runtime dependency.
- [ ] **Muse acceptance on the hosted deployment.** OAuth, paging, and pending-outcome behaviour against
      the deployed origin rather than a local one.
- [x] **Deploy the ownership-delta clamp.** Deployed with the round-2 MCP rollout (web `00026-nss`,
      worker `00027-knr`); affects only leagues declaring a games limit, of which the owner has none.

## 5. Lineup algorithm follow-ups

- [ ] **Positional scarcity.** A league-wide measure of how thin each position is, computed periodically
      rather than per run. Provider-neutral and portable beyond Yahoo. The natural foundation for add/drop
      and transaction recommendations. Recorded in
      [AUTOCOACH-KNOWLEDGE.md](fantasy-manager/AUTOCOACH-KNOWLEDGE.md); deliberately not built during the
      max-games work.
- [ ] **Postponed games.** Participation currently reads the opponent only. A postponed game needs an
      observed case to verify against.
- [ ] **Category- and rotisserie-aware scoring.** The owner chose the community start rate for category
      leagues. Changing the objective to expected categories won is a product decision, not a defect.
- [ ] **Baseball and basketball.** Starting-lineup rules for all four sports are declared and tested.
      Stat categories, games-played and innings-pitched limits, and provider request shapes for those sports
      are not built.

## 6. Product work needing a decision

- [ ] **Transactions.** Review links exist; execution and add/drop recommendations do not, by design.
      Scarcity (section 3) is the prerequisite.
- [ ] **Category-aware recommendations.** Depends on the objective decision above.
- [ ] **Second provider.** The seam supports it; no provider is planned. Adding one is an adapter plus a
      registry entry.
- [ ] **Domain and production email.** The Resend test sender delivers only to the owner address. A
      domain makes this a non-issue and is otherwise cheap.

## 7. Known non-goals

Recorded so they are not rediscovered as gaps: no server-side LLM in the solver, no scoring controls, no
premium provider actions, no arbitrary URL or SQL escape hatches, no multi-period planning, no
cross-account feedback triage.
