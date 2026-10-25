---
name: web-interactions
description: Add or change pages, server-backed forms, reads/writes, authentication recovery, or navigation with unfinished work.
---

# Web interactions

Read [data flow](references/data-flow.md) before wiring requests. Use [DESIGN](../../../DESIGN.md) for visual intent and [testing](../testing/SKILL.md) for regression layers.
Add seams only for real behavioral variation. Add HTTP APIs only for a concrete second client; adapters call public use cases directly, not application loopback.

## Review each action

- Acknowledge immediately with an action-specific pending label and accessible announcement; disable conflicting actions, not unrelated work.
- Submit writes through forms for native Enter behavior. Validate beside fields instead of disabling invalid submission.
- Confirm with the server before “Saved” or “Deleted”. Predicted changes need explicit pending/recovery presentation.
- Keep failed values, selections, and requested changes, with explanation/recovery beside the affected item.
- Capture submitted values; an older response may clear/close only when it cannot discard newer edits.
- Distinguish rejection from uncertainty: a timeout means “We couldn't confirm…”, not “Nothing changed”. Retry duplicating effects only with server-supported replay identity; otherwise offer a current-state check.
- A later failed read does not undo a confirmed write. Offer Refresh, not resubmission.
- Announce without unexpected focus movement; if removal contained focus, move to a useful remaining control or collection heading.

Shared controls own busy accessibility and labelled recovery. Features choose conflicts, copy, and safe recovery; not every failure means Retry.
Return recovery promises so controls stay pending. Never display arbitrary exception text.
Wait on Query, router state, or event-handler `onSettled`, not timers. Named cancellable timing helpers own necessary debounce/countdown/loading mechanics; workflows receive events.

## Authentication and navigation

Explain ended sessions beside the action, retain input, and offer **Sign in again** through the unsaved-work guard; never automatically resubmit.
After sign-in, reload account data and clear the identity-scoped query cache.
Register meaningful unfinished-work predicates in page-owned `UnsavedChangesScope`. Confirm only navigation that discards work, not harmless searches.
Cancellation preserves input/focus; confirmation permits discard. Hard reload/tab closure uses the native warning. Navigation does not cancel sent requests.
Carry raw signed `oauth_query` through sign-in/consent; Router JSON search reconstruction loses repeated signed parameters. Verify consent identity and scope descriptions on the server.
Keep Google's unaltered G only inside its sign-in button, following provider branding.

## Verify

Exercise delayed requests, rejection, unconfirmed outcomes, newer input during submission, independent concurrent actions, and failed recovery/refresh after success.
Assert visible outcomes and public requests, not fabricated callback sequences.
Server actions need connectivity; unfinished work across reloads, requests after closure, and offline synchronization are not promised. Safe replay is not an offline queue.
For reactivity debugging, use `/__solid/diagnostics` and the pinned `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md` and `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`.
