# Agreed decisions from grilling

These records preserve the answers and corrections from all eight rounds. Later rounds refine earlier ones; [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) is the consolidated current scope. Technical recommendations remain subject to final plan approval.

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
