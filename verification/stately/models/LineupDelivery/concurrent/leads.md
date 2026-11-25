# LineupDelivery two-caller lead disposition

- Claim serialization: cleared for concurrent fresh claims by `LineupRunRepository.ts:1099-1157` row locks; stale `dispatching` rows can be reclaimed by another worker after age predicate.
- Event order / duplicate dispatch: checker `DoubleExternalSend` denotes duplicate queue enqueue (`LineupDispatcherLive.ts:27-78,125-139`), **not duplicate lineup provider writes**; downstream queue deduplication remains an unresolved question.
- Stale completion and lost update: checker `StaleCompletion` and `LostNewClaim` via `finishDeliveries` ID-only write (`LineupRunRepository.ts:1164-1216`), after B's reclaim. Retry loop without progress: checker `EventuallySettles`.
- Crash boundary and downstream repair: enqueue before status write (`LineupDispatcherLive.ts:56-78`); repair re-enqueues stale requests (`:87-104`). Downstream idempotence and actual duplicate visibility are untested; no app replay.
