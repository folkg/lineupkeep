# Changelog

MCP-facing behaviour changes, newest first. Deployment revisions name the web and worker Cloud Run
revisions that carried each change.

## 2026-10-28 — round-3 MCP fixes (web `00027-kwq`, worker `00028-29h`)

- `get_team_summary` accepts `groups`, defaults to league, standings, matchup, and roster, and
  pages the roster with a cursor it issues and accepts. A 22-player hockey roster returns every
  fixed section plus a roster page instead of `narrowing_required`; `categories` adds season
  category totals and points. A narrowing result now lists the selectable groups and the remedy.
- `submit_feedback` accepts `null` for optional context fields, matching the published JSON
  schema, and stores only the provided fields. Invalid tool arguments return HTTP 400 with
  JSON-RPC `-32602` naming the field path in the message and `error.data.field`.
- `get_players` refuses a supplied `period` when the provider has no weekly player series for the
  sport, naming the reason and the remedy. Football completed weeks keep the weekly basis; hockey
  weekly series are absent. Date-scoped recent-window splits are deferred in the roadmap.
- `get_transactions` player rows carry inline identity (name, positions, professional team) beside
  the private reference and direction, so the common what-changed query needs no extra join.
- Deploys do not invalidate access tokens, rotate signing keys, or revoke grants. A pre-deploy
  access token and refresh token both worked after the round-3 deploy, and the single 2026-10-25
  signing key was unchanged. Access tokens expire in five minutes by design; clients must persist
  each rotated refresh token. See [the MCP contract](docs/fantasy-manager/MCP.md#discovery-documents).
