# TransactionMove two-caller lead disposition

- Claim exclusivity: cleared for concurrent fresh claims by `TransactionPlanRepository.ts:593-621` null-claim CAS.
- Expired ownership / stale completion: checker `StaleSettlement` after `releaseStaleRuns` (`:837-850`) and `settleMoves` (`:720-810`); `lockPlan` (`:1396-1407`) checks row existence only. Source path in `REPORT.md`; no app replay.
- Lost update / event order: checker `LostUpdate`; `TransactionPlanService.ts:1425-1451,2038-2136` plans against snapshot; `settleMoves` deletes/replaces steps and updates move by ID without token (`TransactionPlanRepository.ts:763-810`). Exact outcome of external provider writes remains untested.
- Liveness: checker `EventuallySettles`; owner release or expiration and reclaims need not lead to settlement; no scheduler-success fairness.
- Stored-state failure and exit parity: per-call DB transactions for claim and settlement, but external write and settlement are separated (`TransactionPlanService.ts:1425-1451`); what happens on crash/provider partial completion is an unresolved question, not modeled.
