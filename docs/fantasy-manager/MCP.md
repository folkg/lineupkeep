# MCP contract plan

Status: proposed surface and acceptance criteria. Names other than the agreed generic `set_lineup` are working names for final review, not an implementation registry.

## Interface principles

- Generic domain operations; resolve provider behavior from owned connection/team/league references.
- Minimal current-use-case fields, no diamond/cohort interface, Yahoo endpoint selectors, arbitrary URLs, query languages, raw payloads, or agent code execution.
- Backend services are batch-first. Tool schemas expose bounded collections where useful; no upstream N+1 work hidden behind a bulk tool.
- Progressive discovery: list compact resources, then select fields and bounded players/teams for detail.
- Explicit actual/projected meaning, period coverage, scoring context, freshness, missingness, and partial failure.
- App-user OAuth and provider linking are separate. Tools never return credentials or internal manager/account identity data.
- MCP transport remains stateless even though runs, linking, and authorization grants are durable.

## Proposed tool families

| Tool                                | Purpose and important limits                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_connections`                  | Safe owned provider connection metadata/status only                                                         |
| `list_teams`                        | Compact owned team discovery with season/sport/connection filters; stable paging                            |
| `get_calendar`                      | Valid current/historical periods and relevant fantasy-day/lock context; no guessed week equivalence         |
| `get_league`                        | Selected league settings, scoring definitions, roster rules, standings/team summaries; bounded groups/pages |
| `get_rosters`                       | Exact selected team/period rosters, compact by default; rich detail single-team by default                  |
| `search_players`                    | Bounded league/sport-context player search, available/free-agent/waiver filters and validated sorts         |
| `get_players`                       | Bounded selected-player hydration including generic stats/projections/availability groups                   |
| `get_matchups`                      | Selected matchup/scoreboard data with explicit period                                                       |
| `get_transactions`                  | Read transaction history; no execution                                                                      |
| `generate_transaction_review_links` | Typed add/add-drop/drop/trade review intents; return provider human-review URLs only                        |
| `set_lineup`                        | The sole roster mutation operation; creates durable team runs and returns verified or pending outcomes      |
| `get_lineup_runs`                   | Owned run status, safe concise explanations, observed changes, and unresolved conditions                    |

Do not expose a general policy-mode selector, native/premium action selector, custom formula, or fallback override. Return the implementation actually used. The initial MCP need not expose registration, helper secret upload, automation enrollment editing, or every frontend control as tools.

A league/opponent read requires verified access through the user's connection; it does not permit managing another team's lineup. Tool annotations and scopes do not replace ownership enforcement in backend services.

## `set_lineup` behavior

Inputs: explicit owned team references and validated target periods, plus stable request identity. MCP's protocol request ID is not assumed to be a durable retry identity. Decide one stable client request field with clear same-key/different-intent rejection.

Phase 1 uses the provider's native start-active action; Phase 2 uses the custom optimizer after direct cutover. No transaction execution or provider-premium optimization.

Response includes per-team run reference, status, implementation, target period, observation time, and safe change/no-op/blocked/pending explanations. A bounded wait may return pending work; `get_lineup_runs` retrieves the result later. Do not report success merely because work was queued or a provider returned HTTP 200 with invalid coverage.

Manual authorized requests may run while paused/disabled without enabling automation. They still obey ownership, connection availability, legal/locked assignments, and unresolved-write protection.

## Budgets and paging

Initial service policy: aim for about 12 KiB and enforce a 16 KiB model-facing application-result ceiling. These are our proposed application budgets, not claimed Muse/MCP limits. Validate actual client serialization, including any duplicate text/structured representations, before finalizing the measurement.

- Bound both row counts and encoded UTF-8 bytes, including metadata and continuation information.
- Return complete records. Do not truncate strings midway, silently drop requested fields, or mark omitted values zero.
- If a requested record cannot fit, return an actionable narrowing-required result listing the requested group/record causing the issue.
- Continuations bind the owner, query, selection, period, stable ordering, and expiry; they are not arbitrary database offsets or raw provider URLs.
- Distinguish an internally paged upstream collection from a stable application snapshot. If the provider cannot provide snapshot consistency, disclose that concurrent upstream changes may affect traversal.
- No silent subset success for exact requested teams/player keys. Return explicit per-resource failures/omissions with reasons and meaningful completion metadata.
- Keep per-record failures and page metadata bounded; many failures must not bypass the byte budget.

Starting adapter bounds can reuse verified selected-player batches of at most 25 keys and bounded upstream search pages. These are configuration proposals informed by research, not universal provider limits. Agent pages can be much smaller than upstream pages.

Upstream response caps are separate from agent-output caps. The adapter may fetch a bounded megabyte-scale response, decode and select fields, then return a small page. Filtering statistics upstream was not demonstrated by earlier Yahoo probes; local projection must not pretend it saved upstream bytes.

## Coverage correctness

A period reference must be resolved against the provider calendar, sport, season, and league. Day, scoring-period/week, and season datasets are not interchangeable. Ancillary coverage is retained or explicitly distinguished.

Do not advertise multi-week aggregation, advanced-stat availability, diamond data, all legacy sorts, or NHL projection completeness without proof. Rates, percentages, ratios, and time-on-ice averages are not summed like counts. Missing games/stats are not automatically zero.

Separate roster membership reads from bounded player hydration where that is the verified way to obtain projections. Yahoo NFL selected-key weekly projections were demonstrated; requesting a projection flag on a roster did not prove projections were present.

## Review-link safety

Generate links from typed domain intents and verified relationships. Users may choose players/counterparty, not origins, endpoint stages, or submission parameters. Validate provider, league, owning team, membership, and numeric-ID mapping privately.

Return a clear human-review instruction and no guarantee of add/drop/trade eligibility. No POST/PUT execution, final confirmation automation, waivers/bid submission, or multi-add/drop behavior not validated by the adapter.

## Client acceptance

Use actual hosted Muse with a harmless read first: discovery, OAuth/consent, correct scopes, egress, expiry/reconnect, structured/text output, continuation use, and bounded-run waiting. Do not assume Muse's managed browser can execute the local helper.

OpenCode is a possible fallback after an actual test. Pi compatibility can improve later; retain the starter's stateless/serverless transport rather than adding a legacy/stateful branch.

Acceptance requires actual protocol tests, not only direct handlers. Preserve Effect-free browser/universal runtime contracts and request-scoped identity across simultaneous users.
