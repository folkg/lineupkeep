# Loading and single-flight writes

## Loading a page

Router chooses what a page needs. Query fetches and caches that data. Solid shows the page and handles loading and error states.

Wait for sign-in checks on the server, then start the page's primary query in the loader. On the server the loader waits, so the first response contains the teams and their season facts. On client navigation the loader starts the query and returns immediately; the destination renders with a shape-matched skeleton while the query fills, rather than leaving the old page in place.

A signed-in home page starts the teams list and card queries in the background. The first visit to Teams therefore reuses work already in progress instead of starting cold.

Sign-in and the primary server read are the waits. They decide the redirect and the content of the first response. Everything secondary loads on its own and never blocks navigation.

Less important sections can load separately, with their own loading indicators. Keep usable controls visible if a refresh fails.

Team reads share one key per collection, so the list and team detail reuse the same list, card, and overview data instead of fetching it twice. The browser keeps settled team reads in local storage for a day. A later client navigation restores that cache before the network answers. Only a value that is still missing gets a skeleton in the shape it will occupy. A failed card read stays a value-level message; it never replaces the team controls.

Skeletons follow the type they stand in for. `TextSkeleton` takes a named text type and draws its bar inside that type's line box; a pixel height is not a substitute. Tables reserve their header, column widths, and row count, so the frame does not resize when rows arrive.

The session query is kept for the life of the tab, and team list and card queries for a day, so returning to Teams or opening one team does not start a cold auth or list read. A team card link preloads its route when it enters the viewport; a tap does not wait for a route chunk.

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

While a mutation is pending, the loader waits for the affected query so the response carries fresh data. With no mutation pending it only starts the query, and the destination's skeleton covers the wait. Preloaded data stays fresh for thirty seconds.

## Framework updates

Keep serialization and cache transfer in framework integrations, not application code. See [release readiness](release-readiness.md) for dated upstream statuses and adoption gates.

- Replace the current Query integration only when both initial page loading and one-request writes work through its replacement. Query's `dehydrateSettled()` can wait for reads outside the loaders; [Router #8192](https://github.com/TanStack/router/pull/8192) describes that connection.
- When adding separately streamed server-rendered sections, test content before browser scripts, interactivity afterward, one-request writes, sign-in, redirects, navigation, delayed content, and late HTML larger than 64 KiB. Awaiting primary data can remain a useful choice even when the framework no longer requires it.
