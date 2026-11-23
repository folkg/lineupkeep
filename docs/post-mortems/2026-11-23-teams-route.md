# Teams route performance, 23 November 2026

## Summary

The Teams page was reported as slow and, in Zen, as a page that was slowing the browser down. We could not reproduce the CPU warning in Playwright Firefox against production. We did find one new piece of work on the route that can leave the page looking stuck: season facts are read from the provider while the page is open, and that read could wait for up to 30 seconds while every card showed animated placeholder rows.

The read now stops after eight seconds and reports that facts could not be loaded. Rendered documents are also marked `no-store` so a tab cannot keep old markup across a deploy.

The CPU warning itself is still unexplained. If it returns, the next step is a performance profile from the affected browser, not another guess from the server side.

## What changed before the report

- `32d3000116b3` "Show season facts on team cards", 21 November 21:50, added a provider read to `/teams`. Before that the route read only Lineupgrade's database.
- `98cffef93b23` "Polish the team cards and season overview", 21 November 23:23, increased the amount of card content and added the loading layout.
- On 23 November at 16:16 a five-team connection was approved. The next `/teams` visit therefore had a ready connection and started the provider read for the first time since the reconnect.
- The report came at 16:19.

## What the route does

`/teams` renders the team list and controls from the database. The season facts are a second query. It runs after the list is available, only in the browser, and only when a ready connection exists.

The provider read has a 30 second deadline in the provider SDK. The card area shows eight placeholder rows per team while the read is in flight. With six teams that is 48 rows, each with a pulsing animation, for as long as the provider takes.

The page is not blocked: navigation, controls and the team list still work. The card area is what looks unfinished. A slow provider therefore looks like a slow page.

## What we measured

Playwright Firefox against production, signed in as the owner:

| Route           | Time to network idle | Long tasks | Largest frame gap |
| --------------- | -------------------- | ---------- | ----------------- |
| `/teams`        | 7.8 s                | none       | 46 ms             |
| `/transactions` | 6.7 to 7.2 s         | none       | 58 ms or less     |
| `/account`      | 6.7 to 7.2 s         | none       | 58 ms or less     |
| `/feedback`     | 6.7 to 7.2 s         | none       | 58 ms or less     |
| team detail     | 6.7 to 7.2 s         | none       | 58 ms or less     |
| run detail      | 6.7 to 7.2 s         | none       | 58 ms or less     |

Server logs put `/teams` responses at 1.5 to 1.8 seconds. A repeat navigation probe between `/teams` and `/account` found no repeated server function calls; the route chunks were already cached. `/teams` produced about 646 animation frames in three seconds, so the main thread was not frozen.

The probes did not reproduce the Zen warning. They do show that the visible card area depends on a live provider call, which is the part that can be slow without showing up as a long task.

## Why it slipped through

- Browser tests and the container end-to-end tests use a provider fake that answers immediately. A slow provider was never part of the test.
- There was no route level performance budget. The existing tests check content, controls, hydration and layout, not how long a route can stay in a loading state.
- The 30 second provider deadline is sensible for a background write. It is too long for a card that a person is looking at.
- Rendered documents had no explicit cache policy. This did not cause the slow provider read, but it made it possible for a tab to keep old markup and old chunks after a deploy.

## Fix

- The team card read now stops after eight seconds. A timed out read becomes the same contained failure the page already knows how to show: season facts could not be loaded, while the team list and controls remain usable.
- HTML responses now carry `cache-control: no-store`.
- A backend test holds the provider read open and advances the test clock past the deadline. A server test checks the document cache header.

## Follow ups

- Add a slow-provider case to the built-app end-to-end suite, not only the unit test.
- Measure the provider read's p95 duration in production before adding a cache. If it is routinely slow, cache the last successful facts and show their age.
- Add a route budget for `/teams`: the list and controls must be interactive within a fixed time, and the card area must never stay in a loading state past its deadline.
- Capture a performance profile from Zen if the warning returns. The server and Playwright evidence do not explain a CPU warning on their own.
