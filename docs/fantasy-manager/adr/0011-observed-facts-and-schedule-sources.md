# Observed facts, a refresh policy per fact, and schedule sources

## Context

The product needs to know which professional games exist, when they start, where they are played, and
whether they are still on. The fantasy provider publishes none of it. Its only schedule fact is one opponent
abbreviation per rostered player per date or scoring week, carrying no key, no start time, no venue, and no
cancellation state, and it reaches only as far as the current period
([round 13](../DECISIONS.md#round-13--schedule-cache-source-and-identity),
[research](../RESEARCH.md#pool-player-schedule-shapes-2026-10-31)).

That fact is also expensive to ask for. Every automation tick re-reads one roster per linked team per date in
the window; five linked teams over three dates is fifteen provider reads an hour, up to 360 a day, for the
same handful of answers.

The owner asked for the schedule from an external source, because the point is efficiency and our reads are
not efficient. He named a Yahoo endpoint and possibly Sportsnet, and asked for a view that generalises so the
same machinery serves any other fact we want cached rather than only schedules.

Probing found that the two halves of that request are different problems. Caching is what makes our reads
efficient. An external source is what gives us facts the provider never publishes. [SCHEDULE-SOURCES.md](../../SCHEDULE-SOURCES.md)
records every request, every response shape, the terms of each candidate, and the comparison.

The Yahoo endpoint he means is `graphite-secure.sports.yahoo.com`, and it is technically the best candidate:
whole-season schedules for all four sports, with `startTime`, `venue`, and `POSTPONED` / `CANCELLED` status
codes, and team identifiers that are literally the fantasy provider's own `editorial_team_key` values, so it
joins with no mapping. Yahoo's Universal Terms of Service prohibit automated collection of its services "for
any purpose without our express, prior permission" and prohibit using its data "to create any database,
archive, ... or any other aggregated data source". A schedule cache is both of those things.

Sportsnet's ticker is a live scoreboard, not a schedule: 2.0 MB per request, an eight-day horizon, its `date`
parameter ignored, no game identifier that matches anything the provider publishes.

Of the remaining candidates, the NHL's own `api-web.nhle.com` is free, keyless, publishes a whole league week
in one 100 KB request with `startTimeUTC`, `venueTimezone`, and a `gameScheduleState` field, and allows the
site with a `use=reference` content signal. MLB's own API is more efficient still — a whole season in one
request — but its copyright notice permits only "individual, non-commercial, non-bulk use". The NBA CDN
refuses our client with 403. ESPN is undocumented and unlicensed. TheSportsDB needs $20/month for untruncated
results. nflverse is CC-BY-4.0 but publishes abbreviations only, which is the one join this product forbids.

## Decision

**Facts are stored as observations, refreshed per fact type, joined on provider keys, and read through one
hook. External sources are added per sport, and only where the terms permit.**

1. **Observed facts, not truth.** Every cached fact is an observation carrying its subject, the fact kind, the
   window it covers, the value, the observation instant, the source, a confidence of `authoritative`,
   `corroborated`, or `reported`, and the upstream identifier. Observations are append-only; the read path
   takes the newest inside the requested age, a tie on time resolves to the higher confidence, and two
   authoritative observations that disagree are a recorded conflict rather than a silent pick. Retention keeps
   the newest observation per key plus the previous one where the value changed.

2. **A refresh policy per fact kind, not per table and not per job.** League season state: 24 hours. A game
   fixture: 7 days. A start time: 6 hours inside 48 hours, 7 days beyond. Game status: 30 minutes inside 12
   hours, 6 hours otherwise. Venue: 7 days. The provider's own opponent fact: the fantasy day boundary. A
   source may narrow a policy it cannot satisfy, and the narrowed bound is what the reader sees. Steady state
   is 8 to 10 requests a day for the owner's two leagues and five linked teams, against up to 360 today.

3. **Identity is the provider's professional-team key.** Abbreviations are display text and are never a join.
   A new source's identifiers are attached to the canonical team only through a pair the provider itself
   publishes on one roster row — `editorial_team_key` beside `editorial_team_abbr` — recorded with its source
   and observation instant. A mapping is scoped to its league, is one-to-one or is not used, and an unmatched
   source team stays unresolved and is never served for a canonical team.

4. **One hook, and the consumer never names a source.** `Facts.require({ subject, fact, window, maximumAge })`
   resolves the canonical subject, reads the newest qualifying observation, and asks the source registry only
   when none qualifies, batching every subject in one call. It returns the fact with its observation instant,
   source, confidence, and window, or a named refusal. Sources are a keyed registry injected at the composition
   root, mirroring [ADR 0007](0007-provider-registry-and-planner-capability.md); adding one is a module plus an
   entry.

5. **Sources are chosen per sport, and the choice is a terms decision before it is a technical one.**
   - **The fantasy provider stays authoritative for what it publishes**: whether a rostered player's team has a
     game on a fantasy date, because that is what the league scores.
   - **The NHL's own API is the first external source**, for the facts the provider does not publish.
   - **Yahoo graphite is not used** without written permission from Yahoo. The integration shape is recorded so
     a grant does not need a second investigation.
   - **No NFL source is added yet.** The provider's opponent fact answers the automation question, and no
     feature needs NFL start times or a full season. If one does, TheSportsDB at $20/month is the cheapest
     licensed option covering all four sports, and that cost is stated before it is recommended.
   - **MLB, NBA, and ESPN are rejected on terms or reachability**, with the evidence recorded.

6. **Failure is named, never guessed.** Serve the newest observation inside its maximum age and show its
   instant. Outside it, refuse with a reason. Work gating refuses open, because a wrong skip is worse than a
   wasted read. A disagreement between sources is split by question: the provider wins on "is there a game on
   this fantasy date", the external source wins on "when, where, and is it still on". An empty result and a
   malformed result are different things and are decoded differently.

## Consequences

- The efficiency the owner asked for arrives without an external dependency. Caching our own reads takes the
  same answers from up to 360 provider reads a day to five, and it is the first slice.
- The external source buys facts the provider cannot supply — start times, venues, a horizon beyond the
  current period, and a cancellation state — rather than buying efficiency. It costs one request a day per
  league.
- Every cached fact can answer "when did we learn this", which is what makes a stale value showable instead of
  hidden, and what makes a conflict recordable instead of silent.
- One generic hook and one registry serve schedules, season state, and whatever fact is added next, so a later
  feature does not learn where a fact came from.
- The identity rule survives the second source without amendment: the mapping comes from a pairing the
  provider publishes, and an unmapped team produces a refusal rather than a plausible wrong answer.
- Two sports now have different coverage: hockey gets start times and postponements, football keeps the
  provider's opponent-only fact. That asymmetry is visible in the published coverage rather than implied.
- Yahoo graphite remains the best technical fit and is unused. If Yahoo grants permission, the adapter is a
  module plus a registry entry and a declared capability set, and its team identifiers need no mapping at all.

## Residual risk

- **Licensing posture beyond graphite.** The product already depends on the Yahoo Fantasy Sports API under its
  own terms, and this decision does not re-litigate that. It does record that graphite is a different service
  under different terms, and that "we already read Yahoo" is not permission for a different Yahoo service.
- **The NHL API is undocumented.** It is the API the league's own site and app use, and it publishes no
  versioning or deprecation policy. A rename or a new required parameter breaks the adapter; the failure is a
  named refusal and a stale-but-marked fact, not a silent empty schedule.
- **The NHL `gameScheduleState` values beyond `OK` are unobserved.** The field is the right place for a
  postponement, but only `OK` was seen. Until a postponed game is observed, the adapter must treat an
  unrecognised value as "unknown status", not as "on".
- **Postponement latency is unmeasured.** How long after a league announcement a source flips its status is
  unknown for every candidate. The 30-minute maximum age bounds our own staleness, not the source's.
- **A 7-day fixture age assumes fixtures are stable.** A league can move a game a week out. The 6-hour start
  time age inside 48 hours catches it, but a fixture added inside the week is only found by the daily sweep.
- **The mapping depends on the provider continuing to publish key and abbreviation together.** It does today on
  every roster row. If it stops, new teams stay unresolved until a mapping is established another way, which
  is the intended failure.
- **Request-count estimates assume five linked teams and two leagues.** More teams or more leagues scale the
  provider reads linearly and the external reads barely at all.

## Revisit when

- Yahoo grants written permission, or a licensed feed becomes affordable.
- A feature needs NFL start times, venues, or a full-season horizon.
- A postponement is observed, which settles the latency question and the NHL status vocabulary.
- A second external source is added, which is the test of whether the registry and the identity rule generalise
  as claimed.
- The provider starts publishing a schedule, which would remove the external dependency entirely.

## Alternatives rejected

- **Use Yahoo graphite now.** It is the best source technically and the worst contractually. The terms prohibit
  the automated collection and the database this decision creates, and a product cannot be built on a
  prohibition that is one legal letter away from being enforced.
- **Use Sportsnet as the schedule source.** It is a live scoreboard with an eight-day horizon and a 2 MB
  payload, its date parameter is ignored, and it carries no identifier that joins to anything we hold.
- **Use MLB's own API because it is the most efficient.** A whole season in one request is exactly the shape we
  want, and its copyright notice permits only individual, non-commercial, non-bulk use.
- **Use ESPN as the single cross-sport source.** Undocumented, unlicensed, and the same objection as Yahoo
  without Yahoo's clarity.
- **Buy TheSportsDB now at $20/month.** It is the right shape and a real monthly cost for facts no feature
  needs yet. Buy it when a feature needs it.
- **Join on abbreviations because every source publishes them.** The provider's own abbreviations differ from
  the leagues' (`LAK` against `LA`), an abbreviation is not unique across leagues, and a wrong join produces a
  confident wrong lineup.
- **One global sweep cadence.** A fixture published in July does not need an hourly re-read, and a postponement
  announced at 4 pm is worthless at 7 pm. One cadence is either too expensive or too stale, and usually both.
- **Keep deriving everything from our own reads.** It answers "does this player's team play today" and nothing
  else, and it is the reason the reads are expensive in the first place.
- **A generic cache with no fact vocabulary.** It would accept anything, refresh nothing deliberately, and
  answer questions it cannot substantiate.
