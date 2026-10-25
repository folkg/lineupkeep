# Client data flow

Router decides page needs; Query owns server state; Solid boundaries present waiting/failure. Router caching stays off.
These are pinned TanStack Solid Start/Router/Query mechanics; inspect installed source and [patch](../../../../patches/@tanstack%2Fsolid-start@2.0.0-rc.8.patch) before changing them.

## Ownership

Views render models/intents and move focus. Controllers connect Query, navigation, and pure local workflows.
Workflows hold drafts, validation, submitted values, and outcomes—not server-list copies or IO. Replay transitions with time/randomness/identity supplied as event data.
Controllers use `useWorkflow`; submitting-state entry starts a mutation and returns its outcome as an event. A trivial feature with no local policy needs no workflow.
A state machine provides neither durable execution nor offline synchronization.
Injected `*Remote.ts` alone invokes server functions and normalizes serialized failures; query/mutation factories depend on remotes. Guardrails own imports.

## Reads

A route's `context` builds query options once from search dependencies; loader and components share that object.
Await `prefetchQuery` for primary data: navigation retains the old page until settlement and single-flight returns settled data.
`prefetchQuery` does not reject; failure belongs in the page error boundary beside usable controls. Start secondary data without awaiting, under its own loading boundary.
Controllers read via `useQuery`; views consume inside `<Loading>`/`<Errored>`. First reads suspend/throw; rendered content remains during refresh.
`setupRouterSsrQueryIntegration` supplies the provider and dehydration/hydration hooks consumed by the pinned Start single-flight collector. Native provider-only wiring does not replace mutation snapshot collection; migrate that path together rather than adding a custom serializer. Rendering mode is route-owned; test hydration/navigation in the built app rather than assuming component fixtures prove them.
Server-rendered routes await primary data. Before introducing non-blocking SSR prefetch, install and verify the [Solid streaming transport fix](https://github.com/TanStack/router/pull/8214) or an equivalent release. A PR merge alone is insufficient. This does not prohibit client-only secondary reads. See [loading and single-flight](../../../../docs/loading-and-single-flight.md) for the loading policy and framework upgrade checks.

## Writes and transactions

1. Controllers use `useMutation` with shared `*Mutations.ts` options factories, composing call-site options.
2. The server writes and reruns current-route `beforeLoad`/loaders; keep reloads cheap. Named `X-Revalidate` keys identify external caches: **any nonempty declaration still invalidates all route data**, not selected routes.
3. Hydration completes before `mutate` resolves; only then show success.
4. Mark other affected queries stale with `refetchType: "none"`; refetch when next shown.
5. Return the outcome to the workflow for draft preservation/clearing and feedback.

Each `mutate` is a Solid transaction: query updates and workflow changes become visible together when the server answers.
Show in-flight progress with mutation `isPending`/`variables` or an optimistic overlay, not a workflow state entered alongside the pending mutation.
Workflow state decides whether work starts, submitted values, and outcome meaning.
Do not add follow-up refetches, manual reconciliation, or settlement timers. Routes own remaining cache operations and identity-change clearing; cache scope is not authorization.
API routes serve non-page protocols, not application writes needing reload.

## Optimistic presentation

Default to server confirmation. For reversible actions, predict from pending mutation variables, keep visible pending feedback, restore in place on failure, and offer Undo after success.
Use `createOptimistic` from `onMutate` only when variables cannot express the prediction. Never invent persisted identity.
[Interaction recovery](../SKILL.md) owns uncertainty, newer input, sign-in, and failed reads after confirmed writes.
