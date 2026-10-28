# Roadmap

Tracked work for Lineupkeep. Stages 0–8 of the [delivery plan](fantasy-manager/DELIVERY-PLAN.md) are
complete and deployed; this file tracks what remains, including defects, operational gaps, and product
work that needs a decision before it becomes implementation.

Check an item only when it is verified, not when it is written. Each item names how it will be
verified, because "done" has meant different things at different times in this project.

## Current state

| Area                 | State                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Phase 1 (stages 0–6) | Complete, deployed, live-accepted                                                           |
| Phase 2 (stages 7–8) | Complete, deployed, hourly automation verified                                              |
| Lineup algorithm     | Custom solver live for all five owner teams, seven consecutive verified ticks               |
| Provider boundary    | Providers injected through a keyed registry; no adapter import outside the composition root |
| MCP surface          | 17 tools, seven scopes, per-tool enforcement; round-2 and round-3 fixes deployed            |

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

## 3. Operational gaps

- [ ] **Database restore drill.** Back up, restore into a scratch database, prove the application reads
      it. Never rehearsed; the largest unverified operational claim.
- [ ] **Hosted-browser live sign-in.** Operator handshake and real login page load are proven; a real
      provider sign-in through the deployed app with owner credentials is not. Needs the owner present.
- [ ] **Publication security gate.** A temporary backport of an upstream fix is in force. Removal
      condition and acceptance are recorded in [release-readiness.md](release-readiness.md); replace it when
      the fixed upstream parent ships.
- [ ] **Dependency audit refresh.** The prior scan's 47 records are untriaged, and the lineup work added
      `munkres` and no other runtime dependency.
- [ ] **Muse acceptance on the hosted deployment.** OAuth, paging, and pending-outcome behaviour against
      the deployed origin rather than a local one.
- [x] **Deploy the ownership-delta clamp.** Deployed with the round-2 MCP rollout (web `00026-nss`,
      worker `00027-knr`); affects only leagues declaring a games limit, of which the owner has none.

## 4. Lineup algorithm follow-ups

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

## 5. Product work needing a decision

- [ ] **Transactions.** Review links exist; execution and add/drop recommendations do not, by design.
      Scarcity (section 3) is the prerequisite.
- [ ] **Category-aware recommendations.** Depends on the objective decision above.
- [ ] **Second provider.** The seam supports it; no provider is planned. Adding one is an adapter plus a
      registry entry.
- [ ] **Domain and production email.** The Resend test sender delivers only to the owner address. A
      domain makes this a non-issue and is otherwise cheap.

## 6. Known non-goals

Recorded so they are not rediscovered as gaps: no server-side LLM in the solver, no scoring controls, no
premium provider actions, no arbitrary URL or SQL escape hatches, no multi-period planning, no
cross-account feedback triage.
