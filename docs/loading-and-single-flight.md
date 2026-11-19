# Loading and single-flight writes

## Loading a page

Router chooses what a page needs. Query fetches and caches that data. Solid shows the page and handles loading and error states.

Wait for sign-in checks on the server, then start the page's primary query in the loader. On the server the loader waits, so the first response contains useful content. On client navigation the loader starts the query and returns immediately; the destination renders with a shape-matched skeleton while the query fills, rather than leaving the old page in place. A route skeleton reserves the card and page dimensions so the switch does not move the layout.

Less important sections can load separately, with their own loading indicators. Keep usable controls visible if a refresh fails.

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

The loader awaits the primary query while a mutation is pending, so the response still carries fresh data. With no mutation pending it only starts the query, and the destination's skeleton covers the wait. Preloaded data stays fresh for thirty seconds.

## Framework updates

Keep serialization and cache transfer in framework integrations, not application code. See [release readiness](release-readiness.md) for dated upstream statuses and adoption gates.

- Replace the current Query integration only when both initial page loading and one-request writes work through its replacement. Query's `dehydrateSettled()` can wait for reads outside the loaders; [Router #8192](https://github.com/TanStack/router/pull/8192) describes that connection.
- Before enabling separately streamed server-rendered sections, install and verify a fix for the [post-body streaming defect, Router #8026](https://github.com/TanStack/router/pull/8026), the [alternative transport in #8214](https://github.com/TanStack/router/pull/8214), or an equivalent. Either verified route is sufficient; a merged PR alone is not enough.

After either change, test content before browser scripts, interactivity afterward, one-request writes, sign-in, redirects, navigation, and delayed content. Awaiting primary data can remain a useful choice even when the framework no longer requires it.
