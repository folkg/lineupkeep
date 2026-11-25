# Loading and single-flight writes

## Loading a page

Router chooses what a page needs. Query fetches and caches that data. Solid shows the page and handles loading and error states.

Wait for sign-in checks on the server, then start the page's primary query in the loader. On the server the loader waits for the team list, so the first response contains the known cards and their stored scoring format. Season facts fill in after hydration. On client navigation the loader starts the queries and returns immediately; the destination paints cached data, or one moving loading mark while the query fills, rather than leaving the old page in place.

A signed-in home page starts the teams list and card queries in the background. The first visit to Teams therefore reuses work already in progress instead of starting cold.

Sign-in and the primary server read are the waits. They decide the redirect and the content of the first response. Everything secondary loads on its own and never blocks navigation.

Less important sections can load separately, with their own loading indicators. Keep usable controls visible if a refresh fails.

Team reads share one key per collection, so the list and team detail reuse the same list, card, and overview data instead of fetching it twice. Queries live in the tab and are not restored from local storage. The team row stores only its scoring format at discovery; the UI owns one fixed card template per format. On a first load the server sends the known team row, the card paints its real frame, and only the missing value pieces carry typed skeletons. A card whose facts are already in the tab cache paints in full. Category cells keep their real table and use a typed value skeleton until the overview arrives. A failed card read stays a value-level message; it never replaces the team controls.

A skeleton follows the type it stands in for. `TextSkeleton` takes a named text type and draws its bar inside that type's line box; a pixel height is not a substitute. The only row skeleton is the already-run list on Transactions, where the real row count is known. The Transactions page itself uses one moving mark on first load, not placeholder cards.

The session query is kept for the life of the tab, and team list and card queries for a day. Returning to Teams or opening one team reuses the tab's settled reads instead of starting a cold auth or list read. A team card link preloads its route code and shared queries on intent, not every team’s data. Shared team queries make the destination paint from memory; a tap does not wait for a cold list or facts read.

## Saving a change

“Single-flight” means saving a change and receiving refreshed page data in one browser request:

```text
Browser sends change
  → Server saves it
  → Page loaders read updated data
  → Same response returns the result and fresh data
Browser updates the page, then confirms success
```

Start enables this automatically for browser writes through server functions. Loaders decide what to read; the framework does not infer it from the change. This saves a network trip, not database work, so keep loaders focused.

While a mutation is pending, the loader waits for the affected query so the response carries fresh data. With no mutation pending it only starts the query, and the destination’s cached data or loading mark covers the wait. Preloaded data stays fresh for thirty seconds.

## Framework updates

Keep serialization and cache transfer in framework integrations, not application code. See [release readiness](release-readiness.md) for dated upstream statuses and adoption gates.

- Replace the current Query integration only when both initial page loading and one-request writes work through its replacement. Query's `dehydrateSettled()` can wait for reads outside the loaders; [Router #8192](https://github.com/TanStack/router/pull/8192) describes that connection.
- When adding separately streamed server-rendered sections, test content before browser scripts, interactivity afterward, one-request writes, sign-in, redirects, navigation, delayed content, and late HTML larger than 64 KiB. Awaiting primary data can remain a useful choice even when the framework no longer requires it.
