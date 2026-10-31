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
Whether the provider currently lets a stored fantasy team be read through its connection, as one
observed fact with its time. A team is available when the last check read it; it is unavailable when
the provider refused the read, the account's own team list no longer includes it, or its connection
cannot be used, and the recorded reason and the provider's own wording are kept. An unavailable team
keeps its configuration, note, and runs, is skipped by automation, and is never treated as deleted.
It is separate from a paused team, which the owner suspended.
_Avoid_: Connection status when the team's own read state is meant; paused when the provider refused

**Roster**:
The players held by a fantasy team, including starters, bench players, and reserve players.

**Lineup**:
The assignment of a fantasy team's rostered players to its roster slots for a particular period.
_Avoid_: Roster when referring only to assignments

**Unverified slot**:
A roster row whose provider-published lineup slot names no slot the league declares, such as an
empty selected position. It keeps the provider's raw value and a readable reason, is never treated
as a known position for eligibility or value, and is never moved by lineup planning or a lineup
write.
_Avoid_: Unknown slot when the raw value is retained, default slot, bench when the slot is unverified

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
Every rostered player's scheduled games in one scoring period, with each player's games-in-period count and a per-date count across the roster so a light night needs no arithmetic. A league whose provider publishes no period window has no scoring-period schedule; its schedule is read over a schedule window instead, and the result names the source.
_Avoid_: Season schedule, full schedule, light night when the per-date count is meant

**Schedule window**:
The inclusive dates a schedule read covers and where they came from: the league's scoring period, a window or day count requested on the call, or the rest of the provider's current week when the league publishes no period. The result states the window and its observation time. When the provider establishes neither a period nor a current date and the call requested neither, the window is refused with the argument to pass rather than invented.
_Avoid_: Guessed week, assumed dates, games remaining when the window is meant

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

**Transaction proposal set**:
One agent or person's proposed player transactions across any of their own teams, created by one call, grouped by team, and reviewed together. It covers every team the account has at creation, including teams with nothing proposed, records who proposed it, the surface and optional client label, and when, and expires 24 hours after creation.
_Avoid_: Proposal when the whole set is meant, batch, review queue

**Proposal item**:
One team's proposed transaction inside a proposal set: the players to add, the players to drop, an optional FAAB bid, a required reason, the provider player references, and its state and staleness. A proposal set holds one item per distinct move.
_Avoid_: Proposal when one item is meant, transaction when it is not yet executed

**Proposal item kind**:
Which executable shape a proposal item takes: a free-agent add (players added, no bid), a waiver claim (players added with a FAAB bid), or a drop (players dropped only). A waiver claim is the only kind that spends a budget, so it is never presented as a free-agent add.
_Avoid_: Claim when the bid is not part of it, move, action

**Proposal item state**:
Where a proposal item sits in its lifecycle: proposed (its initial state), executed (the provider accepted the whole move), pending (a waiver claim the provider has not processed yet), failed (an attempt was made and did not succeed), skipped (a person left it out, it was stale at submit, or an earlier move stopped its team), or unknown (a request that may or may not have applied). Staleness is not a state: a stale item keeps its state and carries the reason it no longer matches current state.
_Avoid_: Stale as a state, rejected when no attempt was made, done when a waiver is still pending

**Proposal staleness**:
Whether a proposal item still matches current provider state, recorded as unchecked before any re-validation, current when it does, or stale with one or more reasons. A stale item is never treated as failed and never executes; re-validation marks it again after the state changes.
_Avoid_: Expired when the provider state changed, failed, invalid

**Proposal stale reason**:
The named cause a proposal item is stale: the added player is no longer available in the pool, a dropped player is no longer on the roster, the roster would exceed its declared capacity, the league's period has closed, the bid exceeds the team's remaining FAAB budget, the league does not use a FAAB budget, or the team's current state could not be read. Each carries a readable detail and, where it names a player, that player's reference.
_Avoid_: Error, failure, conflict

**Proposal set expiry**:
The 24-hour window after a proposal set is created within which it may be re-validated. An expired set refuses re-validation rather than re-checking or executing, and a person proposes the transactions again to create a fresh set.
_Avoid_: Timeout, TTL, stale set when the window is meant

**Proposal submission**:
One person's once-only decision to execute the included items of a proposal set. It records who submitted and when, re-checks current state immediately before writing, writes one provider transaction per item, and records the outcome of every item and step. The database claims the submission atomically, so a set cannot be submitted twice; afterwards the set is an audit record.
_Avoid_: Approval, retry, batch, execution queue

**Proposal outcome**:
The result recorded for a proposal item or one of its steps: executed, pending on waivers, failed, skipped, or unknown. A waiver claim is pending until the provider processes it, never executed early. An unknown request may or may not have applied and is never retried automatically. A partial failure is recorded per step, so a reserve move that succeeded is not collapsed into an add that failed.
_Avoid_: Success, done when a claim is pending, error when no attempt was made

**Execution step**:
One recorded action inside a proposal item: an optional reserve move that frees a roster spot, then the add or drop movement sent in the provider transaction. Each step carries its own outcome and the provider's wording when it failed, so a swap cannot half-apply without being reported.
_Avoid_: Sub-transaction, retry, hidden precondition

**Proposal review**:
The grouped view of one proposal set that presents each team, the reason beside each item, the drop beside the add, the item's state and staleness, and a quiet section for a team with nothing proposed. A signed-in person decides there, selects the current items, and submits them once; after submission it shows each item's and step's outcome in place.
_Avoid_: Approvals, cart, confirmation screen

**Pending trade offer**:
A trade the provider reports as proposed and awaiting a response on a team the account manages, carrying both parties, both ends of every player, any traded draft picks, and whether this session can respond. It is read-only in this product, and another manager's offer is never visible.
_Avoid_: Pending trade when no offer awaits a response, proposal when the provider's own offer is meant
