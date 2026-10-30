# Fantasy management

Language for managing fantasy teams across fantasy sports providers.

## Teams and providers

**User**:
A person registered with this application who owns their provider connections and team automation configuration.
_Avoid_: Provider account when referring to application identity

**Provider**:
A fantasy sports platform that hosts leagues and teams, such as Yahoo, ESPN, or Fantrax.

**Provider key**:
The identifier of the provider implementation a connection or team uses. The application resolves the implementation through the provider registry from this key; it never branches on a display name.

**Provider capability**:
A fact a provider declares about itself — its fantasy-day boundary, supported sports, player-search sorts and statistic periods, whether it publishes projections, and named limitations — that generic layers render and enforce instead of assuming one provider's behavior. How it constructs a score is not a declared capability.

**League**:
A provider-hosted fantasy competition with its own roster, scoring, and participation rules.

**Fantasy team**:
A participant's team within a particular league on a particular provider.
_Avoid_: Professional team, account

**Scoring category**:
A stat category the league's own configured scoring rules count toward a team's result. Only a
scoring category can order a scored search or define a competition the league is playing.
_Avoid_: Enabled category, stat category when the league's configured set is meant

**Informational category**:
A stat the provider publishes for a league without the league scoring it, such as a display-only
category a provider shows in stat columns. It is labelled as informational wherever it is published
and is never presented as a category the league plays for.
_Avoid_: Display stat when the published marking is meant, inactive category

**Provider team key**:
A provider's stable identifier for a fantasy team within one provider connection. The same provider team key may appear under a different connection without referring to the same accessible team.

**Provider league key**:
A provider's stable identifier for the league that contains a fantasy team.

**Team availability**:
Whether the provider still reports a discovered fantasy team through its connection. An unavailable team keeps its configuration and is not treated as deleted.

**Roster**:
The players held by a fantasy team, including starters, bench players, and reserve players.

**Lineup**:
The assignment of a fantasy team's rostered players to its roster slots for a particular period.
_Avoid_: Roster when referring only to assignments

**Provider connection**:
A user's linked access to an account on a fantasy provider. Multiple fantasy teams may be accessible through one connection.
_Avoid_: User account when referring to provider access

**Hosted linking session**:
An owner-bound, one-use, short-lived authorization to open a provider sign-in inside an isolated hosted browser. The session issues a one-use ticket, stores only its hash, and ends on capture, cancellation, expiry, or fault.
_Avoid_: Login token when referring to the browser ticket

**Hosted browser**:
A temporary browser process and profile created for one hosted linking session, with restricted provider egress and no persisted recording. It is destroyed when the session ends.
_Avoid_: Remote desktop, general proxy

**Provider session material**:
The minimal provider tokens or cookies required to act on a linked account after sign-in. It is captured only after the provider accepts the sign-in, encrypted at rest, and never treated as a password.
_Avoid_: Credentials when referring to a provider password

**Starting position**:
An active lineup position whose assigned player can contribute to the fantasy team's result.

**Bench**:
The portion of a roster whose players are retained but are not assigned to contributing starting positions or a reserve list.

**Reserve list**:
A restricted roster area whose players must meet the league's reserve eligibility rules, such as an injured reserve list.

**Final score**:
The single signed number a provider publishes for one player for a target period, in that provider's own unit, which is the only value the lineup objective compares. A player without one is unscored rather than zero, and a provider that cannot score a league says so instead of publishing numbers. How the provider arrives at it — which measurement, which arithmetic, which period window — never crosses the provider seam.
_Avoid_: Selection value when the seam is meant, projection, crowd points

**Scoring scheme**:
A provider's own construction of final scores for one league, such as the league's points rules applied to realised statistics or a published crowd share, together with its period window and population. It is provider implementation detail; the generic layer only learns the winner's opaque label.
_Avoid_: Value source, scoring model, lineup policy

**Score behind the plan (provenance)**:
The opaque, provider-supplied label naming the scoring scheme that produced one plan, recorded on the run so a later reader can tell what happened. Nothing outside the provider parses it.
_Avoid_: Scoring basis, basis string, policy version when the label is meant

**Availability status**:
A named, provider-reported fact about whether a player can appear in a period, such as healthy, out, day to day, injured reserve, suspended, not active, or no game. It never adjusts that player's final score; it selects an availability tier.
_Avoid_: Injury when it also covers byes, suspensions, and inactive players; availability condition when an ordering is meant

**Starting lineup fact**:
A provider-reported fact that a player is confirmed in, confirmed outside, or unconfirmed for their real team's starting lineup. It is neutral and three-valued; whether being outside the lineup means the player is unlikely to appear is sport and position knowledge the provider adapter applies from a declared table covering every reference sport.
_Avoid_: Starter bonus, confirmed-start when the fact is meant, probable starter when the value is unconfirmed

**Availability tier**:
One rung of an ordered ladder from most to least likely to appear — confirmed start, will play, might play, unlikely to play, will not play, no game — that the lineup objective ranks above the final score. The provider selects the rung for each player from its own status and starting-lineup facts; the generic layer declares only the order.
_Avoid_: Health score, injury penalty, availability factor

**Player movement**:
One player's two ends in a transaction: the team it left and the team it joined, each absent when the move has no team on that side. A trade player has both ends; an added player joined a team and left no team; a dropped player left a team and joined none. This replaces a single direction, which cannot describe a trade from both sides.
_Avoid_: Direction, incoming/outgoing, transfer when referring to one player's two ends

**Trade parties**:
The teams on the two sides of a trade. The proposing team and the receiving team are named only when the provider publishes those keys; otherwise the involved teams are reported as participants derived from the player movements, without assigning a proposing or receiving role.
_Avoid_: Trade sides when the roles are unknown

**Transaction completeness**:
Whether the provider payload lets a client reconstruct every movement in a transaction. An incomplete transaction carries a code and reason, and an empty transaction is incomplete rather than a complete trade with no assets.
_Avoid_: Success, empty trade

**Transaction rule**:
One rule the league declares for adding, dropping, or trading players: its waiver type, waiver rule, or FAAB flag; the weekly deadline or days a dropped player stays on waivers; an acquisition limit per week or per season; a trade end date, ratification form, or objection window; or a games-played or innings-pitched cap. Each rule carries the league's declared value or an explicit not-set state.
_Avoid_: League setting when a transaction rule is meant, default value

**Not set**:
A transaction rule the league does not declare. It is never zero, never a per-team count, and never a cap the sport happens to lack; a cap that does not apply to the league's sport is also not set rather than omitted.
_Avoid_: Zero, unset, default

**Acquisition usage**:
How many acquisitions a team has already used in a covered week and in the season, as the provider's own team object reports them: `seasonMovesUsed` from its move count and `weeklyAddsUsed` over the stated coverage. The remaining count is published only where the league declares a limit, and a team whose payload carries no counter is not published with a reason, never reported as zero. It is not derived from transaction history.
_Avoid_: Estimated usage, transaction count as usage, zero when the provider published nothing

**Draft history**:
The picks a league's draft actually made: round, pick number, the team that made the pick, and the player taken. It is not current or future pick ownership, and a traded pick appears on the trade transaction that moved it rather than in this history.
_Avoid_: Draft board, pick ownership when the read is history

**Traded draft pick**:
A draft pick moved in a trade, carrying its round and the teams that sent it, received it, and originally owned it. It is part of the trade transaction, not a proposal, and the provider publishes no draft year or overall pick number for it.
_Avoid_: Pick ownership when referring to a traded pick

**Scheduled game**:
A game the provider publishes for a rostered player in a scoring period: the opponent's professional-team abbreviation and whether the game is home or away, on a date in a date-scoped league, or as the period's opponent when the league's coverage is a scoring week. It carries no start time.
_Avoid_: Fixture, matchup (a matchup is between fantasy teams), game time

**Scoring-period schedule**:
Every rostered player's scheduled games in one scoring period, with each player's games-in-period count and a per-date count across the roster so a light night needs no arithmetic. A league whose provider publishes no period window has no scoring-period schedule, which is stated with the reason rather than returned as an empty list.
_Avoid_: Season schedule, full schedule, light night when the per-date count is meant

## Automation

**Disabled team**:
A fantasy team not enrolled in scheduled lineup automation. Newly discovered teams are disabled.

**Statistic period**:
The window a player-statistics read covers: a whole season, one scoring week, a fixed recent preset window, or an explicit inclusive date range. A provider declares per sport whether it serves each kind natively, by aggregating its daily reads, or not at all, and a kind it does not serve is refused with the alternative rather than replaced by season totals.
_Avoid_: Timeframe, split, timespan

**Aggregated period**:
A statistic period a provider serves by summing its own daily reads for every day in the window. It reports the covered dates and its method, and it never sums categories the provider publishes as rates or percentages.

**Enabled team**:
A fantasy team enrolled in scheduled lineup automation and not paused.

**Paused team**:
An otherwise enabled fantasy team whose scheduled lineup automation is suspended for the rest of the fantasy day. Its configuration is retained, and the suspension expires at the end of that day.

**Fantasy day**:
The provider-defined daily period used to bound a fantasy team's temporary pause, including when its lineup period is weekly.

**Lineup run**:
One attempt to evaluate or update a fantasy team's lineup for a particular period, including its outcome. Multiple runs may share a provider request without sharing their outcomes.

**Connection incident**:
An unresolved provider-access problem requiring the user to act, such as reconnecting an expired login. An expiration after access has been restored is a separate incident.

**Uncertain lineup result**:
A lineup attempt whose provider acceptance or resulting assignments cannot be established reliably. It is neither verified success nor proof that no change occurred.

**Plan provenance**:
The recorded implementation and opaque provider label — or the provider's refusal and its explanation — for one lineup attempt. It lets a later reader tell what the attempt actually ran rather than what was requested.
_Avoid_: Policy, basis, version when referring to the whole provenance

**Structural refusal**:
A planner refusal meaning the provider cannot value the league at all, so no later attempt could plan it either. The team falls back to the provider's own action and the reason is recorded.
_Avoid_: Fallback when referring to the refusal itself

**Transient refusal**:
A planner refusal meaning the league can be valued but not from the facts available now, such as incomplete history, an unopened period, unreadable data, or a roster that admits no legal plan. The attempt blocks with a named reason and the next scheduled tick retries.
_Avoid_: Error, temporary failure

**Active lineup implementation**:
The implementation a deployment stamps on fresh lineup runs. Changing it changes future execution only; it cannot restore assignments an earlier implementation already wrote.

## Feedback

**Feedback report**:
A bug, data issue, friction report, or wishlist item submitted by a signed-in person or by an agent acting for that person. It records who submitted it, its kind, its status, its text, and bounded optional context; it never contains credentials, provider payloads, or another person's data.
_Avoid_: Ticket, issue, comment thread

**Feedback status**:
The lifecycle state of a feedback report. An open report is unreviewed; an acknowledged report is being worked on; a resolved or not-planned report is closed with an optional note and cannot change again.
_Avoid_: Priority, milestone

**Feedback submission quota**:
The bounded number of feedback reports one account, and one acting client label, may submit within a clock hour. It is an abuse control, not an allowance a person spends.

## Actions

**Native lineup action**:
A provider's own action to select active starters without using this application's lineup optimizer. It is not a guarantee of an optimal score.
_Avoid_: Start-active, provider action name

**Explicit assignment request**:
A provider write that sets named roster players to named slots for one lineup period. It is incapable of adding, dropping, or trading a player, and sends only assignments that differ from the provider's observed lineup and that the provider reports as editable.
_Avoid_: Roster submission when referring only to slot assignments

**Lineup optimization**:
Choosing roster-slot assignments according to an objective while respecting the applicable roster and eligibility constraints.

**Transaction review link**:
A link to a provider's human-facing page with a proposed player transaction prefilled for review. Opening the link does not authorize this application to submit that transaction.
