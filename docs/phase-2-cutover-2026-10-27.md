# Phase 2 planner cutover (2026-10-27)

This record covers the [Stage 8
cutover](fantasy-manager/DELIVERY-PLAN.md#stage-8--direct-phase-2-cutover): scheduled and manual
runs now ask the custom planner, the provider's planner decides per team whether it can value the
league, structural refusals fall back to the provider's native action with a recorded reason, and
transient refusals block with a named reason. The decision is
[ADR 0008](fantasy-manager/adr/0008-refusal-kinds-and-planner-cutover.md).

**Privacy:** this record contains no provider keys, team or league identifiers, player names,
cookies, crumbs, payloads, or database URLs. The disposable read-only harness and its JSON live in
gitignored `.artifacts/phase2-evidence/` and are not committed. The owner authorized read-only use of
their linked account and one explicit write on their own football team; that write used only roster
slot changes and never added, dropped, or traded a player.

## Live value-source resolution

> This record is a historical account. The scoring scheme and the plan label it describes were later
> moved inside the provider, and each run now records an opaque provider label instead of a `basis`
> string ([ADR 0009](fantasy-manager/adr/0009-provider-score-ownership.md)). The live behaviour it
> records is unchanged.

Read-only, against the owner's linked account on 2026-10-27, through the committed `YahooProvider`
and policy. One rung per league, in the ladder's order:

| League     | Format                  | Roster | Modifiers | Value source         | Basis                                                |
| ---------- | ----------------------- | -----: | --------: | -------------------- | ---------------------------------------------------- |
| football-1 | head-to-head points     |     15 |        33 | league scoring rules | `mean-points-per-period:week:4,week:5,week:6,week:7` |
| hockey-1   | head-to-head categories |     21 |         0 | community start rate | `community-start-rate:overall:date:2026-10-27`       |
| hockey-2   | head-to-head categories |     19 |         0 | community start rate | `community-start-rate:overall:date:2026-10-27`       |
| hockey-3   | rotisserie              |     22 |         0 | community start rate | `community-start-rate:overall:date:2026-10-27`       |
| hockey-4   | head-to-head categories |     22 |         0 | community start rate | `community-start-rate:overall:date:2026-10-27`       |

Why: the football league publishes 33 scoring modifiers, so rung 1 values it in the league's own
points. All four hockey leagues publish categories with no modifiers at all, so they fall to rung 3.
The diamond cut was published and `0` for every roster player again, so rung 3 used the overall
percentage. Yahoo publishes no player projections, so its scoring has no projection rung.

All five plans were `planned`; none refused. Every required starting slot was filled (9 for
football, 12/15/15/15 for hockey), and no started player had a missing value except where noted below.

## The football plan

Target week 8, window weeks 4–7, values are trailing mean points at the league's own scale. Three
moves, all players editable:

| Move  | Before                      | After                           | Value change |
| ----- | --------------------------- | ------------------------------- | -----------: |
| RB    | a 12.15 back starting at RB | a 15.80 back moving from W/R/T  |        +3.65 |
| W/R/T | the 15.80 back above        | a 12.53 receiver moving from BN |        −3.27 |
| BN    | a 12.53 receiver            | the 12.15 back                  |            — |

Total selection value **125.73 → 126.11 (+0.38)**. Nine starting slots, zero unvalued starters.

**Judgement: sane.** Every move is legal and editable, the two-slot chain is exactly the
highest-total assignment of the fifteen-player roster, and availability does its job: a 13.53
receiver who will not play stays benched while a 12.53 receiver who will play takes the flex slot.
The small net gain is honest — the roster's improvement is a bench back upgrading the flex, not a
star sitting.

## The hockey plan

Target date 2026-10-27, values are published started percentages (hundredths of a percent; 43 means
43 % of leagues started the player). Four moves in the 21-player head-to-head category league:

| Move | Before                         | After                                  |
| ---- | ------------------------------ | -------------------------------------- |
| C    | a centre the crowd starts 64 % | a centre the crowd starts 87 % from BN |
| RW   | a winger the crowd starts 49 % | a winger the crowd starts 82 % from BN |
| BN   | the 87 % centre                | the 64 % centre                        |
| BN   | the 82 % winger                | the 49 % winger                        |

Twelve starting slots filled; value term **825.00 → 881.00 (+56.00)**. The other three hockey
leagues resolve the same way: 878 → 904, 659 → 789, and 911 → 945, with five, seven, and three
changes. The 19-player league still holds an injured-reserve goaltender with no published started
percentage; the plan parks that player on the reserve list it already occupies and invents no value.

**Judgement: sane as an ordinal ordering, with two stated limits.**

- Every hockey change moves a higher started percentage into a starting slot at a position the
  player is eligible for, and no player who will not play is started. Read as "start the players the
  crowd starts", the plans are right.
- **Goaltenders are the weak spot.** In hockey-1 the 11 % goaltender starts because the two other
  goalies are on injured reserve and the league requires two goalie starts; the choice is forced,
  not judged. Percent started cannot tell a confirmed starter from a backup, and the provider does
  publish `starting_status` for a goalie whose team plays that day; the adapter does not read it.
- **Category and rotisserie formats are not modelled.** The value term prices the player the crowd
  likes, not the categories this team needs, and the rotisserie league in particular is won on
  season-relative standing rather than today's crowd. The basis string says the number is a started
  percentage; nothing pretends it is a category projection or an expected score.

No plan is nonsense. The hockey plans are the decided policy applied honestly, not a claim that a
crowd percentage is a hockey score.

## Explicit write and readback

On the owner's own football team, the committed adapter sent the football plan's three changed
assignments as one explicit roster request (week 8). The provider accepted it and the roster readback
reported:

| Observation             | Result                                           |
| ----------------------- | ------------------------------------------------ |
| Requested assignments   | 3 changed slots, no add/drop/trade element       |
| Readback slot changes   | the same 3 moves                                 |
| Mismatches              | 0                                                |
| Roster membership       | 15 before, 15 after; every member retained       |
| Coverage after          | week 8                                           |
| Re-plan after the write | 0 assignments; the solver agrees with the roster |

The readback — not the write response — is the authority: a rejected request would have left the
three slots unchanged. A subsequent read-only planning pass produced no assignments, which is the
same fact from the other direction.

## Deployment

Deployed from the committed cutover change through the documented Alchemy stages. The `database` and
`platform` plans reported no changes; the `cloud-run` plan proposed only updates (no creates,
replacements, or deletions): one image build and publish, the browser image publish, the migration
run, web and worker revisions, the scheduler job, and five new secret versions.

| Resource       | Before        | After         | Image digest (after)           |
| -------------- | ------------- | ------------- | ------------------------------ |
| Web            | `…-00016-fzl` | `…-00017-tfl` | `web@sha256:6a607a23…3e40`     |
| Worker         | `…-00017-gpd` | `…-00018-vld` | `web@sha256:6a607a23…3e40`     |
| Hosted browser | `…-00005-vh7` | `…-00006-j6x` | `browser@sha256:3e551d86…6dd5` |

Smoke after deploy: the web origin returned `200 text/html`, an unauthenticated worker request
returned `403` (invoker IAM), and the Scheduler job was `ENABLED` with the hourly `0 * * * *`
schedule. There were no non-terminal runs and no unresolved write intents before the deploy, so no
attempt could be reinterpreted underneath a deployment.

## Next scheduled tick

The first scheduled tick after the deploy started at 15:00 UTC, created one run per enabled team, and
completed all five. Each run was stamped `custom_policy` with `custom-policy/1`, planned in one
attempt, and recorded a verified outcome; the write intent for each team is `verified_no_op` or
`verified_changed`, and no run is non-terminal.

| Team     | Value source         | Outcome   | Changes | Readback           |
| -------- | -------------------- | --------- | ------: | ------------------ |
| football | league scoring rules | `no_op`   |       0 | `verified_no_op`   |
| hockey-1 | community start rate | `changed` |       3 | `verified_changed` |
| hockey-2 | community start rate | `changed` |       7 | `verified_changed` |
| hockey-3 | community start rate | `changed` |       5 | `verified_changed` |
| hockey-4 | community start rate | `changed` |       4 | `verified_changed` |

Reading the tick:

- **Football** planned from its 33 scoring modifiers and found the lineup already matched, because the
  authorized explicit write above had applied the same plan. The run is a verified no-op, not a
  skipped or unverified success.
- **All four hockey teams** planned from the published started percentage and verified explicit slot
  changes by reading the roster back. The exact move counts differ slightly from the read-only pass
  earlier in the day because the provider's crowd percentages and lock state move during the day;
  the outcome that matters is the verified readback, not matching a stale rehearsal.
- **No team fell back and no team blocked.** Every one of these five leagues is valuable to its
  provider, which is what the cutover is supposed to produce. The structural fallback remains the
  safety net for a league the planner genuinely cannot value, and the transient block remains the
  honest response to facts that might change. Neither was needed here.
- The scheduler attempt at 15:00:02 recorded no error, the worker returned `200`, and the worker log
  shows no shape mismatch or failure.

The next hourly tick repeats the same path. There is no per-team switch to flip: the planner decides
from the league facts, and the run records what happened.
