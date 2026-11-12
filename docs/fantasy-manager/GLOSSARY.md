# Fantasy management

Language for managing fantasy teams across fantasy sports providers.

## Identifiers

**Lineupgrade identifier**:
An identifier Lineupgrade creates for its own records: a ULID, so it sorts by creation time and reads as 26 Crockford base32 characters in a link. Some stored identifiers are older UUIDs, so one column may hold either; nothing rewrites or renumbers a stored identifier. The authentication library's own identifiers and every provider key are not Lineupgrade identifiers.
_Avoid_: UUID when a new identifier is meant, provider key

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

**League roster read**:
One read of every fantasy team's roster in a league the account plays in, including teams the
account does not own, at the provider's current coverage. It pages whole teams, and each team row
carries a private team reference, its name, and whether the account owns it. A rival's roster facts
are readable only inside that league, and every team and player reference stays sealed to the owner
and league.
_Avoid_: League-wide roster when a single team or a player page is meant

**Left in place**:
A roster player the plan does not move because the league's slots cannot hold them legally, such as a player still listed in a reserve slot they are no longer eligible for. They keep the slot the provider reports, and the rest of the lineup is planned around them. It is not a plan failure, and it is not a missing assignment.
_Avoid_: Unassigned, orphan, invalid player, benched when the plan did not choose the bench

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
A provider's own construction of final scores for one league, such as the league's points rules applied to realised statistics, its projected rank for the period, or a published crowd share, together with its period window and population. It is provider implementation detail; the generic layer only learns the winner's opaque label.
_Avoid_: Value source, scoring model, lineup policy

**Period projection**:
The provider's own published projection for the period a lineup is being set, one score per player. It is either projected statistics scored by the league's rules or the provider's projected rank for that period, whichever the provider actually publishes; the recorded label names the period and the measurement. It is never a mean of completed periods, and a period the provider does not project has no projection rather than an estimate.
_Avoid_: Projected points when the provider published only a rank, trailing mean, expected score

**Projected rank**:
A provider's ordinal projection for a period, where a better place is a better projection and the number is not points. It is league-scoped, so the same player carries different places in different leagues, and a longer projection window is not a shorter one.
_Avoid_: Projected points, rank when a points forecast is meant, average rank

**Score behind the plan (provenance)**:
The opaque, provider-supplied label naming the scoring scheme that produced one plan, recorded on the run so a later reader can tell what happened. Nothing outside the provider parses it.
_Avoid_: Scoring basis, basis string, policy version when the label is meant

**Availability status**:
A named, provider-reported fact about whether a player can appear in a period, such as healthy, out, day to day, injured reserve, suspended, not active, or no game. It never adjusts that player's final score; it selects an availability tier.
_Avoid_: Injury when it also covers byes, suspensions, and inactive players; availability condition when an ordering is meant

**Starting lineup fact**:
A provider-reported fact that a player is confirmed in, confirmed outside, or unconfirmed for their real team's starting lineup. It is neutral and three-valued; whether being outside the lineup means the player is unlikely to appear is sport and position knowledge the provider adapter applies from a declared table covering every reference sport. Published on a team roster row and the summary roster as `startingStatus`: `confirmed_starting`, `confirmed_not_starting`, or `unconfirmed`; `not_requested` says the read's request shape did not include it, as on a league roster page, and is distinct from `unconfirmed`.
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

**Draft provenance**:
One player's place in the league's completed draft: `draftRound`, `overallPick`, the drafting team (`draftedBy`), and `draftSeason`. `undrafted` means the league drafted and did not take him; `not_published` means the league published no draft history to read. It is a fact, not a keeper price: the league's keeper arithmetic is the owner's house rule, so the client applies its own formula.
_Avoid_: Keeper cost, draft value, undrafted as "no data"

**Traded draft pick**:
A draft pick moved in a trade, carrying its round and the teams that sent it, received it, and originally owned it. It is part of the trade transaction, not a proposal, and the provider publishes no draft year or overall pick number for it.
_Avoid_: Pick ownership when referring to a traded pick

**Scheduled game**:
A game the provider publishes for a rostered player in a scoring period: the opponent's professional-team abbreviation and whether the game is home or away, on a date in a date-scoped league, or as the period's opponent when the league's coverage is a scoring week. It carries no start time.
_Avoid_: Fixture, matchup (a matchup is between fantasy teams), game time

**Provider opponent**:
The stored form of a `Scheduled game`: the provider's own schedule observation for a rostered player on a fantasy date. It is used when professional games cannot answer.
_Avoid_: Professional game, matchup

**Scoring-period schedule**:
Every rostered player's scheduled games in one scoring period, with each player's games-in-period count and a per-date count across the roster so a light night needs no arithmetic. A league whose provider publishes no period window has no scoring-period schedule; its schedule is read over a schedule window instead, and the result names the source.
_Avoid_: Season schedule, full schedule, light night when the per-date count is meant

**Schedule window**:
The inclusive dates a schedule read covers and where they came from: the league's scoring period, a window or day count requested on the call, or the rest of the provider's current week when the league publishes no period. The result states the window and its observation time. When the provider establishes neither a period nor a current date and the call requested neither, the window is refused with the argument to pass rather than invented.
_Avoid_: Guessed week, assumed dates, games remaining when the window is meant

**Professional team**:
A real-world team a rostered player plays for, identified by the provider's professional-team key (`nhl.t.26`). Its abbreviation is display text and is never an identity.
_Avoid_: Pro team, club, franchise, editorial team

**Professional game**:
A game between two professional teams, with a date, an optional start time and its venue time zone, a venue, and a status of scheduled, in progress, final, postponed, cancelled, or unknown. Its teams are provider professional-team keys, or an unresolved source identifier when no identity is known. It is a fact about the real world, not a `Scheduled game`, which is what the provider publishes for a rostered player.
_Avoid_: Fixture, event, scheduled game when the provider's fact is not meant

**Games remaining**:
The number of professional games a player's team plays in the schedule window, counted from the league's
professional games. When those are unavailable for a rostered player, the provider's own roster schedule
supplies the count and the answer names `provider_opponent`; a pool player has no such roster schedule and
reports `unavailable` rather than zero. When neither is available the answer refuses with a reason rather
than zero.
_Avoid_: Remaining player-games (that is the provider's fantasy-team total), projected games

**Game days**:
The dates a player's professional team plays inside a schedule window a caller chose, published on a pool row as `gameDays` when the call passes `gamesWindow`. A game day is a date, not a count, so a client can place a player on the days that matter instead of assuming the scoring window. A window wider than one schedule read is refused with the limit rather than truncated, and a row whose team key is unknown or unresolved reports `unavailable` with the reason rather than an empty list.
_Avoid_: Games remaining (that is a count over the scoring window), schedule when only the dates are meant

**Off night**:
A date on which fewer than half of the league's professional teams play, by the declared
`league_off_night` share. Half is the ordinary line between a night the league runs and one it does not:
below it, most managers have no lineup decision to make on that date. The result publishes the raw per-date
league game and team counts, so a client can apply a different threshold; hockey is the only sport whose
games make the marking computable today.
_Avoid_: Light night (that is a per-roster count), bye

**Schedule gate**:
The scheduled-run early return that skips provider work only when a fresh professional calendar, observed
after the fantasy day began, shows no rostered team game starting before the next tick and the team already
has a verified lineup run for the fantasy day, one that ended `changed` or `no_op`. Unknown, stale, or
unmapped schedule data runs the check, and so does a team with no run today, a blocked last run, or an
unverified last run; a manual `set_lineup` bypasses the gate and the skip is recorded with its reason.
_Avoid_: Precheck, cache miss

**Professional team identity**:
A stored pairing of a source's team identifier to a professional team's provider key, learned from a pairing the provider itself publishes and scoped to its sport. A pairing that resolves an identifier to two teams is not used, and an identifier with no pairing stays unresolved.
_Avoid_: Team alias, abbreviation map

**Professional team map**:
The checked-in list of a league's professional teams, each paired with the provider's professional-team key and carrying the league's identifier, abbreviation, and the club's name. It is read as data, never discovered at run time: a club it does not hold, or describes differently from the source's own read, stays unresolved and is reported.
_Avoid_: Team cache, identity table when the stored observations are meant, abbreviation map

**Game source**:
An external service that publishes professional games, such as the NHL's own API, reached through one provider-neutral interface and selected by the league it declares. It is not a `Provider`, which is the fantasy platform.
_Avoid_: Feed, scraper, schedule API

**Schedule observation**:
A professional game or the provider's scheduled game, stored with the window it covers, when it was observed, which source produced it, and how strongly it is held (`authoritative`, `corroborated`, or `reported`). The schedule store keeps one row per source, subject, observation kind, and window; a newer observation replaces an older one, and retention removes windows that ended more than 14 days ago.
_Avoid_: Observed fact, cache entry, truth

**Schedule source**:
A declared origin of schedule observations: the provider for its scheduled games, or a game source for professional games. Every observation records the source that produced it.
_Avoid_: Fact source, feed, data vendor

**Schedule freshness**:
The maximum age an observation or one of its aspects may have before a read must re-observe it, and what a read does when the re-observation fails. Professional-game calendar, start-time, and status aspects and the provider opponent have separate rules.
_Avoid_: Cache TTL, polling interval, sync schedule

**Schedule read**:
A read that serves a schedule window from stored schedule observations, refreshing from its source only when no sufficiently fresh observation exists. The result names the window, source, and observation time it served.
_Avoid_: Fact hook, cache lookup, source call

## Automation

**Disabled team**:
A fantasy team not enrolled in scheduled lineup automation. Newly discovered teams are disabled.

**Statistic period**:
The window a player-statistics read covers: a whole season, one scoring week, the last N days, the last N weeks, or an explicit inclusive date range. A provider declares per sport whether it serves each kind natively, by aggregating its daily reads, or not at all, and a kind it does not serve is refused with the alternative rather than replaced by season totals.
_Avoid_: Timeframe, split, timespan

**Recent-form window**:
The neutral window a pool can be ordered over: the last N days or the last N weeks. A league publishes which of its provider's windows it actually carries, and a window it does not publish is refused with the nearest published one named. The provider's own token, rank type, and sort-type names stay below the provider seam.
_Avoid_: Preset, L7, L4W, biweekly, lastmonth

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

## Account access

**Sign-in session**:
One browser's continued access to the account, recorded from when it starts and refreshed as it is used. The owner can list their own sign-in sessions and end one or all others; ending one takes effect on that browser's next request.
_Avoid_: Login, device, browser session when the account's other sessions are meant

**Device hint**:
The short browser-and-system phrase derived from a sign-in session's stored user agent, such as "Chrome on macOS". It never carries the full user agent, a made-up device name, or a location we did not receive.
_Avoid_: Device name, location, user agent

**Account erasure**:
The immediate, owner-scoped deletion of every row that carries a person's identity, directly or through a parent row, in one transaction. It runs only when the owner holds a fresh account export, and it consumes that export. It ends every sign-in session and hosted linking session, and revokes every grant an agent holds. It has no hold window, no retained copy, and no undo.
_Avoid_: Account deletion when the immediate, complete operation is meant, purge, anonymisation

**Account export**:
One versioned JSON document of the same classes an account erasure removes, taken by the signed-in owner. Credentials are named as withheld with the reason, never included in a form that could act for the person. An export counts for one hour after it is taken: long enough to download it and read it, short enough that what it holds still matches what an erasure would remove. One export justifies one erasure, and a second erasure needs a new one.
_Avoid_: Data dump, backup, subject access request when the product action is meant

## Feedback

**Feedback report**:
A bug, data issue, friction report, or wishlist item submitted by a signed-in person or by an agent acting for that person. It records who submitted it, its kind, its status, its text, and bounded optional context; it never contains credentials, provider payloads, or another person's data.
_Avoid_: Ticket, issue, comment thread

**Feedback status**:
The stored lifecycle state of a feedback report: open, acknowledged, resolved, or not planned. A report is filed open, and its status is set when the work lands, not through a tool; the stored status, optional note, and closure time are read back as recorded and are never rewritten by the application.
_Avoid_: Priority, milestone

**Feedback submission quota**:
The bounded number of feedback reports one account, and one acting client label, may submit within a clock hour. It is an abuse control, not an allowance a person spends.

## MCP tool calls

**Tool-call class**:
Which of three allowances an MCP tool call spends: a read, an ordinary write, or a destructive write. The tool's published read-only and destructive annotations decide it, so the bucket a client is told about is the bucket it pays; a tool that declares neither is treated as destructive.

**Tool-call quota**:
The bounded number of MCP tool calls one account, and one acting client of that account, may make for a class within that class's window. A refused call also counts. It is an abuse control that protects shared free allowances and the provider account's standing, not an allowance a person is meant to spend.
_Avoid_: Rate limit when the client-visible quota is meant

## Actions

**Native lineup action**:
A provider's own action to select active starters without using this application's lineup optimizer. It is not a guarantee of an optimal score.
_Avoid_: Start-active, provider action name

**Explicit assignment request**:
A provider write that sets named roster players to named slots for one lineup period. It is incapable of adding, dropping, or trading a player, and sends only assignments that differ from the provider's observed lineup and that the provider reports as editable.
_Avoid_: Roster submission when referring only to slot assignments

**Lineup optimization**:
Choosing roster-slot assignments according to an objective while respecting the applicable roster and eligibility constraints.

**Transaction proposal set**:
One agent or person's proposed player transactions across any of their own teams, created by one call, grouped by team, and reviewed together. It covers every team the account has at creation, including teams with nothing proposed, records who proposed it, the surface and optional client label, and when, and expires 24 hours after creation. A set stays open while a move in it has not settled; a set that has been submitted and holds only settled moves is an audit record.
_Avoid_: Proposal when the whole set is meant, batch, review queue

**Proposal item**:
One team's proposed operation inside a proposal set: the players to add, the players to drop, the draft picks a trade moves with their round and both teams, the declared intent (an add's active or reserve destination, or the player to activate or stash), the player and destination slot of a slot move, an optional FAAB bid, a required reason, the provider player references, and its state and check. A proposal set holds one item per distinct move.
_Avoid_: Proposal when one item is meant, transaction when it is not yet executed

**Proposal item kind**:
Which shape a proposal item takes: a free-agent add (players added, no bid, optionally with `to` saying active or reserve), a waiver claim (players added with a FAAB bid and the same optional `to`), a drop (players dropped only), an activate (one reserve-list player brought onto the active roster), a stash (one active player put on a reserve list that accepts their positions), a slot move (one rostered player moved to one named slot the league declares, including a reserve list; no add, drop, bid, or counterparty), or a trade (at least one player or draft pick going out and at least one coming back with one counterparty team, no bid). An activate or stash never names a slot; the server chooses the place with the lineup solver. A waiver claim is the only kind that spends a budget, so it is never presented as a free-agent add. A trade is an offer to another manager, not a change either manager has made. A slot move names only its destination; the server decides when it can run. An activate or stash is the normal way to move a player between the active roster and a reserve list; a slot move stays available when one exact destination is genuinely wanted. None of them is a lineup write or changes the team's membership.
_Avoid_: Claim when the bid is not part of it, move, action

**Slot move**:
One rostered player's move to a named slot on the same team, either declared as its own proposal item or added by the server as a repair before an add. The destination must be a slot the league declares and that accepts the player's positions; the client names the destination and never the order. A declared slot move may go into a reserve list or back out of one, and it executes as one recorded step when its turn in the computed order arrives. A server-added repair is specifically a move into a reserve list to open a non-reserve roster spot. A slot move is not a lineup assignment for a period and not an add, drop, or trade.
_Avoid_: Reserve move when any slot is meant, position change, lineup change

**Placement**:
The place the server chooses for an item stated as intent: the active place or reserve list an add should join, or the place an activate or stash moves the player to. The server chooses it with the same lineup solver and eligibility rules it uses for the proposal order, so a starting slot may stay empty and a bench place is generic. It is reported for a single-player add, an activate, or a stash; a reserve add names one player per item, because each player needs their own reserve place. The set read reports the chosen place beside one sentence saying why. A placement the solver cannot make refuses the item and names the player and the constraint.
_Avoid_: Slot assignment declared by the client, lineup, starting position when any active place is meant

**Proposal order**:
The sequence the server chooses for one team's current proposal items so every step leaves the roster legal under the league's own slots. It is computed against the league's published roster-change date, reported with a position for every move before submission, and used for submission, never accepted from the client. The server validates the team's items against a roster projected through that order, so a drop or declared slot move in the same set can make a later add legal. A player the provider reports as locked cannot be moved on that date. When no order keeps the roster legal at every step, the whole set for that team is refused: every move in it is illegal, the refusal names the conflicting operations in plain words, and nothing from that set is sent. An item that no operation in the set can make legal is stale or illegal on its own and names the missing operation instead of refusing its teammates. An order the server could not decide within its stated search bound is unresolved, not refused. Each included move records the position it held in that order, so the order remains visible after submission. A trade follows the roster moves in the published sequence, because it changes no roster until the other manager accepts.
_Avoid_: Client order, priority, queue, greedy plan

**Proposal item state**:
Where a proposal item sits in its lifecycle: proposed (its initial state, and still the state of a move left out of a submission), executed (the provider accepted the whole move), pending (a waiver claim the provider has not processed, or a trade offer awaiting the other manager), failed (an attempt was made and did not succeed), skipped (it was stale or illegal at submit, an earlier move stopped its team, a team's connection changed, or the provider's request cannot carry it), unknown (a request that may or may not have applied), or, for a trade, accepted (the counterparty accepted it), withdrawn (we withdrew it before acceptance), or expired (the provider no longer lists it and did not complete it). A skipped item carries a `settled` flag: true when its reason cannot change, false when the facts could change. Staleness and illegality are not states: a stale or illegal item keeps its state and carries the reason it cannot be submitted.
_Avoid_: Stale as a state, rejected when no attempt was made, done when a waiver is still pending

**Proposal staleness**:
Whether a proposal item still matches a state the provider would accept at its place in the plan, recorded as unchecked before any re-validation, current when it does, stale with one or more reasons when the facts behind it changed or no operation in the set can make it legal, or illegal when a rostered player sits in a slot that does not accept him and the set cannot resolve it. A stale or illegal item is never treated as failed and never executes; re-validation marks it again after the facts or the roster change. Stale and illegal are distinct: stale means the facts or the set's operations leave no way to make the item legal, illegal means the roster cannot be submitted as it stands. A stale add that needs a roster place names the drop or slot move its set is missing.
_Avoid_: Expired when the provider state changed, failed, invalid, stale when the roster is illegal

**Illegal roster position**:
A rostered player whose current slot does not accept any of his positions. The league declares each slot's eligibility; a reserve slot is one such slot, not a special case. It blocks every transaction for that team, not only a move that names him. When a slot the set opens accepts him, the proposal's order carries a slot move before the transaction; a person may also declare that move as its own item. The slot can be opened by a drop in the same set, including the drop in the same item. Otherwise it refuses and names the player, the slot, and the choice only the person can make, and says which drop or slot move would resolve it in this set. The team summary publishes them as `illegalSlots` when its roster group is read, beside each roster entry's own `slot` and `eligiblePositions` so the comparison is visible, and a proposal refuses them with the same sentence. It is not a failed move and not staleness.
_Avoid_: Stale player, invalid player when the slot is meant, unhealthy player when eligibility is meant

**Proposal check reason**:
The named cause a proposal item is stale or illegal: the added player is no longer available in the pool, a dropped player is no longer on the roster, a moved player is no longer on the roster, a destination slot is not one the league declares, the set has no way to give the add a roster place, the player cannot sit on a reserve list the league lists, the player is already on the part of the roster the move would put them, a rostered player's slot does not accept him and the set cannot resolve it, no order keeps the roster legal, the order could not be decided within its search bound, the league's period has closed, the bid exceeds the team's remaining FAAB budget, the league does not use a FAAB budget, or the team's current state could not be read. Each carries a readable detail and, where it names a player, that player's reference.
_Avoid_: Error, failure, conflict, stale reason when an illegal slot is meant

**Proposal set expiry**:
The 24-hour window after a proposal set is created within which it may be re-validated. An expired set refuses re-validation rather than re-checking or executing, and a person proposes the transactions again to create a fresh set.
_Avoid_: Timeout, TTL, stale set when the window is meant

**Proposal submission**:
One person's decision to execute the moves of a proposal set that are still proposed. Each submission records who submitted and when, re-checks current state immediately before writing, writes one provider transaction per included move, and records the position and outcome of every move it sent and the outcome of every step. A team's moves run in the proposal order the server computed for that submission, never in the order the client sent. When a submission's items finish, each team whose roster changed gets one lineup run, and the set read reports that run separately from the moves. The database claims a submission atomically, so two submissions of one set never run at once. A set whose moves have all settled is an audit record and refuses another submission; a set whose submission left a move failed, or that still holds a proposed move, stays open, and a later submission sends only the moves that are still proposed.
_Avoid_: Approval, retry, batch, execution queue

**Proposal outcome**:
The result recorded for a proposal item or one of its steps: executed, pending on waivers, failed, skipped, or unknown. A waiver claim is pending until the provider processes it, never executed early. An unknown request may or may not have applied and is never retried automatically. A partial failure is recorded per step, so a reserve move that succeeded is not collapsed into an add that failed.
_Avoid_: Success, done when a claim is pending, error when no attempt was made

**Execution step**:
One recorded action inside a proposal item: a reserve move added by the server to free a roster spot, a declared slot move, then the add or drop movement sent in the provider transaction. Each step carries its own outcome and the provider's wording when it failed, so a swap cannot half-apply without being reported.
_Avoid_: Sub-transaction, retry, hidden precondition

**Proposal review**:
The grouped view of one proposal set that presents each team, the reason beside each item, the drop beside the add, the item's state and check, when the league applies the moves in plain words, and a quiet section for a team with nothing proposed. A refusal names the conflicting operations in the person's terms rather than by a code. A signed-in person decides there, selects the moves that are still proposed, and submits them; after submission it shows the submission history, the order that was sent, each move's and step's outcome, and why a later move stopped. It offers another submission when the set stays open and holds a move that is still proposed.
_Avoid_: Approvals, cart, confirmation screen

**Pending trade offer**:
A trade the provider reports as proposed and awaiting a response on a team the account manages, carrying both parties, both ends of every player, any traded draft picks, and whether this session can respond. An offer this account made can be withdrawn before acceptance from either our own record or the provider's pending feed; accepting, rejecting, voting on, or countering an offer belongs to the other manager or the league. Another manager's offer is never visible.
_Avoid_: Pending trade when no offer awaits a response, proposal when the provider's own offer is meant

**Trade proposal**:
One proposal item that offers named players and draft picks from one of the account's teams to one counterparty team in the same league, for named players and draft picks coming back. It carries the counterparty team and manager, both sides of the move, the required reason, and no bid. A pick names its round and the two teams it moves between, and the league's own switch plus the sending team's available picks decide whether it can be proposed. A provider's trade request may not name a pick: the review publishes that limit as `tradeProposal` with the provider's plain reason, and submitting a pick trade skips it with that reason rather than sending a player-only body or silently dropping the pick. That is a limit on the write host we can send to, not a claim that the provider's product cannot trade picks. The league's trade window and review rule are read beside it. The product proposes and withdraws; it never accepts, rejects, votes, counters, or selects a pick.
_Avoid_: Trade request when the item is meant, swap, trade offer when the stored item is meant

**Trade draft pick**:
One draft pick inside a trade proposal: its round, the team it leaves, and the team it joins. Both teams are the item's own team or its counterparty, and any other team is refused. The provider's request names a pick by round and source team, so the asset carries no original-team field and no draft year. It is not a traded draft pick (which is history on a completed trade) and not draft history.
_Avoid_: Draft asset, pick ownership when the proposal asset is meant

**Trade proposal state**:
Where a trade proposal sits: pending (the provider lists the offer and the counterparty has not accepted), accepted (the provider publishes a completed trade matching it), withdrawn (we deleted it before acceptance and confirmed it is no longer pending), or expired (the provider no longer lists it and it is not among completed trades; the provider publishes no ended record, so a declined or expired offer reads the same). The state is read from the provider for pending, accepted, and expired, and from our confirmed withdrawal for withdrawn.
_Avoid_: Done when the other manager has not accepted, cancelled when the provider may have accepted it
