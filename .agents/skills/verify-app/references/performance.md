# Performance evidence

Use `measure` to ask whether an interaction meets a predeclared requirement; use `profile` to explain slow work or diagnose a regression. Ordinary behavior verification needs no timing assertions. Measure without video.

## Measure

Time the action through its visible, asserted result:

```ts
await test.step("Result: save within budget", async () => {
  await measure(
    "save until title appears",
    async () => {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Final title" })).toBeVisible();
    },
    { budgetMs: 1000 },
  );
});
```

The budget above is illustrative, not a product requirement. Choose it before observing results. Exceeding the inclusive maximum soft-fails so later samples can run. Repeat comparable actions with the same name/budget and inspect median, range, and every sample; local noise near a threshold needs more samples. Failed actions retain available evidence and original errors.

## Profile

`profile("filter a collection", async () => { ... })` captures browser CPU via CDP and plain Node server CPU via the run-owned loopback inspector. Workerd/container targets have no server CPU profile. Raw `.cpuprofile` artifacts open in DevTools.

Profiling adds overhead; its durations cannot be compared with measurement budgets. Browser CPU includes Playwright injection and assertion waiting: attribute application functions, not every recorded sample, to the product.

## Attribution and conditions

- **Server:** fresh W3C trace context matches spans to requests, not a time window. Missing spans make activity partial/unavailable, including cancelled requests that reached the server. Duplicate exports count once.
- **Database:** `pg_stat_statements` and `auto_explain` observe database-wide work during a statistics/log window, including unrelated/background work. Use traced SQL to locate the interaction's own requests.
- **Cache:** request-tagging interception disables HTTP cache. These are uncached-request samples, not warm-cache performance.
- **Instrumentation:** EXPLAIN ANALYZE without per-node timing still adds cost. Inspect recorded conditions.
- **Workerd:** missing export is not empty/zero work. Inspect retained spans and capture availability. Service-fixture client spans originate in Node and alone do not establish workerd execution. A local collector does not prove production export.

## MCP and headless services

Use the same fixtures around authenticated MCP or service calls, including their result assertions:

```ts
await measure(
  "list via MCP",
  async () => {
    const result = await client.callTool("list_notes", {});
    expect(result.isError).not.toBe(true);
  },
  { budgetMs: 1000 },
);
await profile("read via services", async () => {
  const result = await services.inspect(actor, "read persisted notes", "readNotes");
  expect(result).toBeDefined();
});
```

Choose an actual tool/program from the selected scenario; these names and budgets are illustrative. Service-only measurement/profile fixtures require no Page. MCP authorization may use a Page; calls themselves use Node fetch. Browser CPU is unavailable without a participating Page; server CPU is captured only on plain Node, unavailable on workerd/container.

The shared observer records each call's trace and parent-span IDs before send, completion/failure, and client-observed duration through response consumption and call-evidence attachment (including that harness overhead). Window duration includes assertions and is not identical to individual call latency. Failed/cancelled calls retain linkage and available evidence without replacing the original error. Missing export is not zero work. Full backend spans (including SQL children and log events), database statements, and auto-explain ANALYZE/BUFFERS plans are retained alongside summaries.

Run windows serially: nested/concurrent `measure`/`profile` rejects before resetting statistics or starting CPU capture. MCP/service calls inside a window are serialized; calls outside it are not samples. Each window resets `pg_stat_statements`, records the log offset before action, then reads statistics and settled log bytes afterward. This bounds database evidence to the window, **not uniquely to a call**: background work may still contribute. Only traced SQL establishes call attribution; plans/statistics cannot honestly be assigned per call. CPU is also process-wide. Await every call; do not start unrelated work during a sample.

## Read and cite

Use the review report and attachments for durations, operations, SQL/plans, logs/errors, and CPU; shapes belong to [performance code](../../../../e2e/verify/performance.ts). Run-wide telemetry is not automatically attributable to one test.

Cite the step containing timing assertions in `claims.json`. State dataset size, environment, cache/instrumentation conditions, and missing evidence. For regressions compare repeated like-for-like scenarios on base and candidate revisions. Local PostgreSQL and a production build without real traffic do not establish deployed performance. Follow [harness reporting](harness.md#criteria-and-claims).
