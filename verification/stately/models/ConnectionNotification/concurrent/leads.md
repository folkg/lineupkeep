# ConnectionNotification two-caller lead disposition

- Claim serialization: cleared for fresh pending rows by `NotificationsRepository.ts:130-152` with `where status=pending` and `mutateRows` row locks (`packages/backend/src/database/dbUtilities.ts:205-229`). Expired sending is reclaimed at `NotificationsRepository.ts:76-91`.
- Duplicate email / stale completion / lost update: checker `DoubleExternalSend`, `StaleCompletion`, `LostNewClaim`; external `email.sendMany` (`NotificationsRepository.ts:176`) precedes `applyEvents(events)` (`:215`), whose finish uses only ID and persisted status (`:36-67`). No generation/token. Provider deduplication and live replay unverified.
- Snapshot/incident change during send: `NotificationsRepository.ts:95-174` reads connection/incident before the send; cancellation/status change while sending remains a question outside this model.
- Liveness and error exits: checker `EventuallySettles` exhibits unbounded reclaim/release cycle; delivery errors and backoff intentionally abstracted; no guarantee some send succeeds.
