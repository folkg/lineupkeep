# Fantasy management

Language for managing fantasy teams across fantasy sports providers.

## Teams and providers

**User**:
A person registered with this application who owns their provider connections and team automation configuration.
_Avoid_: Provider account when referring to application identity

**Provider**:
A fantasy sports platform that hosts leagues and teams, such as Yahoo, ESPN, or Fantrax.

**League**:
A provider-hosted fantasy competition with its own roster, scoring, and participation rules.

**Fantasy team**:
A participant's team within a particular league on a particular provider.
_Avoid_: Professional team, account

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

**Local helper**:
The first-party command-line fallback that pairs with the signed-in application through RFC 8628 device authorization and opens a dedicated temporary local browser profile for provider sign-in.
_Avoid_: Hosted browser when referring to the helper

**Provider session material**:
The minimal provider tokens or cookies required to act on a linked account after sign-in. It is captured only after the provider accepts the sign-in, encrypted at rest, and never treated as a password.
_Avoid_: Credentials when referring to a provider password

**Starting position**:
An active lineup position whose assigned player can contribute to the fantasy team's result.

**Bench**:
The portion of a roster whose players are retained but are not assigned to contributing starting positions or a reserve list.

**Reserve list**:
A restricted roster area whose players must meet the league's reserve eligibility rules, such as an injured reserve list.

**Selection value**:
The signed relative benefit assigned to starting a player for a particular period. Values are comparable only within a consistent scoring basis; a negative value is worse than leaving a starting position empty when legally possible.

**Scoring basis**:
One declared set of rules, statistic coverage, and period arithmetic that makes two selection values comparable, such as one league's points rules applied to one period basis. Values from different scoring bases are never combined.
_Avoid_: Scoring model, formula, weighting

**Availability condition**:
A named, provider-reported fact about whether a player can contribute in a period, such as healthy, out, day to day, injured reserve, suspended, not active, or no game. It has exactly one stated effect on that player's selection value.
_Avoid_: Injury when it also covers byes, suspensions, and inactive players

**Observation window**:
The completed periods whose realised statistics are averaged into a player's selection value for a target period. The target period is never inside its own observation window.
_Avoid_: History, lookback, sample

## Automation

**Disabled team**:
A fantasy team not enrolled in scheduled lineup automation. Newly discovered teams are disabled.

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

**Native start-active action**:
A provider's own action to select active starters without using this application's lineup optimizer. It is not a guarantee of an optimal projected score.

**Lineup optimization**:
Choosing roster-slot assignments according to an objective while respecting the applicable roster and eligibility constraints.

**Transaction review link**:
A link to a provider's human-facing page with a proposed player transaction prefilled for review. Opening the link does not authorize this application to submit that transaction.
