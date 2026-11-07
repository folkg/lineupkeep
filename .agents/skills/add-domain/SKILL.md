---
name: add-domain
description: Add a domain from public backend behavior through optional browser and MCP surfaces.
---

# Add a domain

Start with one useful behavior and follow it from storage to the surface people need. Skip browser or MCP work when the product does not need it.
Use [testing](../testing/SKILL.md) for one failing behavior at a time and [web-interactions](../web-interactions/SKILL.md) before browser work.

## Where things go

Replace `<domain>`, `<Entity>`, and `<Service>` with the product's own names. This is a placement guide, not a list of required files; keep related small pieces together.

```text
packages/backend/src/contexts/<domain>/
  <Entity>.ts                       public values, IDs, inputs, and expected errors
  <Service>.ts                      public operations
  <Service>.test.ts                 tests through those operations
  internal/
    <Domain>Tables.ts               owned tables
    <Domain>Database.ts             database service, local relations, production Layer
    <Domain>DatabaseTest.ts         migrated storage for tests only
    <Entity>Repository.ts           database reads and writes
    <Service>Live.ts                operation implementation
apps/web/src/
  contracts/<domain>/               browser-safe input and result types
  server-functions/<domain>/        validated calls to public backend operations
  server/<domain>/                  result and expected-error presentation, if needed
  browser/<domain>/                 remote, queries, mutations, controllers, views
  routes/                          route entry points
```

## Backend

1. Define public values and validation with Schema, including branded IDs and expected errors. Define the public Effect service next. Name an explicit service shape `<TagName>Shape`; do not add a type alias when inference or a small inline type is clear enough.
2. Make services and repositories batch-first: gather commands or IDs and call once; a single-item caller passes `[input]`. Mutations are atomic by default. Decide what a retried create means; make its request ID once at entry and preserve it on retry. Use Effect's `Crypto.randomULID` for entity IDs, not request identity.
3. Add owned tables, local relations, database construction, repository, and service implementation. Construct IO when building the Layer, never on import. Reusable `<Capability>Test.ts` Layers belong in the owner's `internal/`, separate from production construction.
4. For existing-row mutations, use `mutateRows(tx, table, { where, ids, codec, plan })` in [dbUtilities](../../../packages/backend/src/database/dbUtilities.ts). It derives the single-column primary key, locks owned rows in ID order, decodes them through the two-way row codec, and writes only changed rows through one set-based update. The pure plan returns a next value for every locked row or a typed failure.
   Model an entity's lifecycle as states that own their data; events carry facts, unhandled events are rejected, and `planBatch` plans batches. Keep one row ⇄ state Schema codec beside the machine and use `snapshotOf` to resume a top-level state. Soft deletion preserves data in the database: the deleted state owns the content it retains. Store an explicit lifecycle column, exclude deleted entities from public reads and mutations, and index actual owner/filter/order access paths without duplicating machine rules in CHECK constraints. Restoring a deleted entity later is just another machine transition. Sort create rows explicitly by their conflict key, then use `chunked(rows, maxInsertRows(table), (chunk) => tx.insert(table).values([...chunk]).returning())` for sequential inserts below PostgreSQL's parameter limit.

5. Use [dbUtilities](../../../packages/backend/src/database/dbUtilities.ts), not handwritten SQL; add constraints and indexes for actual access paths and keep relations local to their owner.
6. Run `bun run db:generate`; review the migration SQL and snapshot. Apply only through authorized tooling. Never rewrite applied history. [Drizzle's table glob](../../../packages/backend/drizzle.config.ts) discovers Table/Tables modules without a context list.
7. Wire the service's repository, database, and implementation Layers in [ApplicationLayer.ts](../../../packages/backend/src/runtime/ApplicationLayer.ts), and include the public service in `BackendServices`.
8. Declare a cross-context import only when one domain genuinely needs another's public contract. **Changing `permittedContextImports` widens the architecture and always needs careful review.** Grant the smallest permission and add acceptance and rejection fixtures grouped by tool. Package wildcard exports and role-based lint already cover new contexts; do not add per-domain export or lint lists.
9. Test public validation, ownership, batch atomicity, replay, paging, lifecycle, and persisted results where relevant, using real committed migrations. Test business rules through the public service rather than repository call history.

## Optional MCP surface

Define domain-owned scopes and consent promises. Compose them through `AuthorizationScopes` in `ApplicationLayer.ts`; Auth owns `offline_access`.
Add Schema-derived tools with scope annotations, hints, actionable expected rejections, and handlers that call public batch services.
Wire the toolkit and handler Layers in [mcpServer.ts](../../../apps/web/src/server/mcp/mcpServer.ts). Test scope enforcement, ownership, serialization, and actual protocol calls; a direct handler test is not protocol proof.

## Browser surface

Add validated server functions that use `runUseCase`, request context, and public backend operations. Return serializable outcomes and map only safe expected errors. Derive transport input types from public schemas with type-only imports; keep output presentation explicit. Do not add a feature backend facade or an operation registry.

Add an injected remote for the server-call protocol, queries and mutations, then controllers, views, and route/navigation. Add a pure local workflow only when drafts or recovery rules need it. Share query options between the route loader and controller. Keep Effect out of browser runtime code; server-function Schema values must stay in compiler-erased validators or handlers. Follow existing placement rules rather than adding exceptions.

Test pure rules in Node; test keyboard, focus, and races under injected failures in browser mode. Use E2E for built-app authentication, hydration, and persistence. Do not repeat E2E happy paths exactly in browser tests.

## Finish

Add resolved product terms to [GLOSSARY](../../../GLOSSARY.md), not architecture permissions. Run the [required checks](../../../README.md#commands-and-required-checks) serially and inspect the diff for unnecessary domain lists.
