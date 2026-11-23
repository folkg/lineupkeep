# Scheduled checks stopped after the host redirect

## What happened

The hourly lineup tick is a Cloud Scheduler job. It calls the worker at
`/api/internal/lineup-worker` with a signed Google identity. On 23 November the job started returning
`INVALID_ARGUMENT`, and no scheduled runs were created between 00:55 and 14:55, or at 15:55. The person
noticed the missing checks in team activity.

## Cause

The old-address redirect shipped earlier that day treated every `*.run.app` host as a browser address.
That included the worker's own host. The scheduler request reached the worker, received a `308` to the
web origin, and Cloud Scheduler did not follow it. The scheduler recorded `URL_ERROR-ERROR_OTHER.
Original HTTP response code number = 400`; the worker log showed the `308` against the internal endpoint.

The redirect was correct for public pages and auth, but internal worker traffic must stay on the worker's
own address.

## Fix

`canonicalHostRedirect` now leaves `/api/internal/*` alone, alongside `/healthz`. A regression test covers
the worker path. The fix deployed as web revision `00243-vsj` and worker revision `00244-*`.

## Verification

A manual scheduler run at 19:57 UTC created the five expected runs for the 19:00 period; the scheduler
then reported no error. The next hourly ticks should continue to create runs.

## What the tests missed

The redirect test covered public paths and the health check but not the internal worker endpoint. The
scheduler and worker are separate services; a unit test on the web redirect could not observe the
scheduler's response. The manual scheduler run is the end-to-end check for this failure mode.

## Follow-up

Watch the next two hourly ticks and confirm activity shows them. If the scheduler reports an error again,
inspect its `AttemptFinished` log before changing application code.
