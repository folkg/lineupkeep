# Loading and single-flight writes

## Loading a page

Router chooses what a page needs. Query fetches and caches that data. Solid shows the page and handles loading and error states.

Page loaders never wait on page data. They start the query and return. On a direct visit the server sends the page shell first, then streams each query as it settles through the router's query integration. On client navigation the destination renders immediately with a shape-matched skeleton while the query fills, rather than leaving the old page in place.

A query-driven surface mounts after hydration. The server renders its shell and a shape-matched fallback, but the first client render waits for the same hydration boundary. That keeps the server HTML and the first client render identical. Hydrated query data is already in the cache when the surface mounts, so it paints without waiting for a second read.

Sign-in is the exception. The session check waits on the server because a redirect decision cannot stream after the response has started.

Less important sections can load separately, with their own loading indicators. Keep usable controls visible if a refresh fails.

Team reads share one key per collection, so the list and team detail reuse the same list, card, and overview data instead of fetching it twice. The browser keeps settled team reads in local storage for a day. A repeat visit restores that cache after hydration, so the first client render still matches the server shell, then the cached values paint before the network answers. Only a value that is still missing gets a skeleton in the shape it will occupy. A failed card read stays a value-level message; it never replaces the team controls.

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
