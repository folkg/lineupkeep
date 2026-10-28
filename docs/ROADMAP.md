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
| MCP surface          | 17 tools, seven scopes, per-tool enforcement; round-2 feedback fixes in progress            |

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

## 2. Operational gaps

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

## 3. Lineup algorithm follow-ups

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

## 4. Product work needing a decision

- [ ] **Transactions.** Review links exist; execution and add/drop recommendations do not, by design.
      Scarcity (section 3) is the prerequisite.
- [ ] **Category-aware recommendations.** Depends on the objective decision above.
- [ ] **Second provider.** The seam supports it; no provider is planned. Adding one is an adapter plus a
      registry entry.
- [ ] **Domain and production email.** The Resend test sender delivers only to the owner address. A
      domain makes this a non-issue and is otherwise cheap.

## 5. Known non-goals

Recorded so they are not rediscovered as gaps: no server-side LLM in the solver, no scoring controls, no
premium provider actions, no arbitrary URL or SQL escape hatches, no multi-period planning, no
cross-account feedback triage.
