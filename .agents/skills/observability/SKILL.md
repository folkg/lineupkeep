---
name: observability
description: Instrument, extend, or review Effect-based observability, including HTTP, external APIs, SQL, background work, trace propagation, metrics, privacy, and development output. Use when adding IO, retries, queues, scheduled jobs, caches, integrations, or telemetry.
---

# Observability

Use Effect spans as the single operational record: exactly one wide, rich, queryable event per application operation, with children explaining dependencies. Development rendering and production export consume that same model. Verify APIs against pinned Effect source.

## Core rules

Instrument the transport once at middleware and the application operation once at the shared use-case seam, independently of browser or MCP transport. Enrich that one operation with bounded input/result/changed counts, final outcome, rejection code, and replay facts where meaningful; never content or search text. Named `Effect.fn`, HTTP, and SQL integrations supply children only for real dependency work. Do not trace pure conversions or pass-through helpers, duplicate final outcomes across wrappers, or add a parallel completion log. Add stable business context with `Effect.annotateCurrentSpan`; use `Effect.annotateSpans` only for facts that genuinely belong on every affected span, not to distribute the operation record across children.

Keep names stable and low-cardinality. Record transport status separately from business outcome. Validation, unauthorized, and not-found are expected outcomes, not unexpected server failures; preserve defects and interruption. Use `Effect.log*` sparingly for point events with `Logger.tracerLogger` attaching them to the span.

## Execution lifetime

Never hold IO objects or request state in module scope or read bindings at module load. Compose scoped resources once for the platform lifetime: processes can batch export, while isolates must hand response-independent work to `BackgroundWork` and respect response/resource lifetimes. Neither supplies durable execution after instance loss.

## External APIs

Trusted calls go to a destination fixed by us in configuration, such as Resend's provider base URL; use Effect `HttpClient` for cancellation, propagation, and automatic client spans. Untrusted calls use a URL from users or external data, such as an OAuth client metadata URL, and must use `PublicInternet`: ordinary HTTP instrumentation is **not** SSRF protection.

`PublicInternet` already supplies the safe dependency span with method, host, and status. Do not repeat those annotations or add full URLs, query strings, headers, or payloads. It does not propagate tracing headers to arbitrary destinations. Redirect rejection, size limits, cancellation, and DNS/trust policy belong to the capability; keep platform-specific connection-time enforcement intact.

The caller owns why it fetched, safe provider/purpose facts, Schema decoding, bounded final business outcome, retry policy, and provider-supported replay identity. There is no generic automatic retry for arbitrary PublicInternet writes. Consume or cancel the body inside the caller's Effect scope. The transport span ends at response acquisition, not after complete download or decoding; body consumption remains within the business operation span. Do not add hand-timed start/end annotations or another network-annotation abstraction.

This read-only example permits transient retries; a write needs provider-supported replay identity before automatic retry is safe:

```ts
const client = (yield * HttpClient.HttpClient).pipe(
  HttpClient.mapRequest(HttpClientRequest.prependUrl("https://inventory.example")),
  HttpClient.filterStatusOk,
  HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }),
);

const availability = Effect.fn("inventory.availability")(function* () {
  return yield* HttpClientRequest.get("/availability").pipe(
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(AvailabilityResponse)),
    Effect.mapError(classifyInventoryFailure),
  );
});
```

Decode provider responses with Schema and map failures to stable application codes. The business span explains why; its HTTP child owns wire timing/status. Review the pinned client's automatic URL/query and exception capture, plus its opt-in header capture, before export; safe outer error mapping cannot sanitize an already-ended HTTP child. Annotate only safe provider identifiers and bounded facts such as attempt count or rate-limit state.

## Concurrency and policies

Effect fiber context preserves child parentage across concurrent dependencies; do not serialize work for prettier traces. Keep one business span around retry/timeout/fallback policy, with attempts beneath it. Record final outcome and bounded decisions; a fallback is not automatically business success.

For caches/circuits, record bounded hit/miss/open/closed decisions rather than every lookup. If adding queues/jobs, create a root span when no inbound span exists, propagate metadata, and use links when multiple messages combine. For streams, name the measured lifetime precisely and record cancellation as interruption. These are instrumentation choices, not claims that those facilities already exist.

## Metrics and duration

Derive request counts, errors, and durations from spans. Use metrics for state without a completed span, such as queue depth or pool saturation. Collector sampling affects aggregate accuracy. Metric dimensions must remain low-cardinality; entity/request/trace IDs belong neither there nor in span names. No application Metric exporter is currently composed, and a numeric span attribute or named event is not evidence of Metric support.

## Privacy and cardinality

Never export credentials, cookies, authorization headers, tokens, secrets, SQL bind values, private payloads, arbitrary causes, or unreviewed provider errors. Email recipients, codes, and bodies may appear only in the development console delivery Layer, never exported telemetry; tests must never send real email. Structured attributes are not automatically safe. Safe high-cardinality identifiers may help locate spans but are unsuitable metric dimensions.

Compose tracers only in `runtime/Observability.ts`, behind `safeTracerLayer`. Both OTLP and development receive stable `operation.failed` / `operation.defect` diagnostics instead of raw failures, nested causes, or cause annotations; interruption remains interruption. Toolkit parameters, exception text, captured HTTP headers, full URLs/queries, and client URL paths are suppressed. Original causes remain available to program control, not export. Producers still own approving attributes and stable event names: this boundary cannot infer whether arbitrary business text is private. Client reports export classifications, validated trace IDs, and numeric/enum facts, never caller-supplied exception text, paths, targets, blocker labels, or function identifiers.

## Tests and completion

Collect actual tracer/export output through public behavior. Check parentage, operation name, outcome, status, safe context, duration, interruption, and development rendering of slow/failed children. Inspect real serialized OTLP payloads from the pinned exporter, including failed SQL and HTTP children, library-injected Toolkit parameters, and untrusted client reports. Assert private values are absent everywhere, including exception events and status messages—not just intended annotations or successful dependency spans. Verify the same safe failure representation in development, including the generic console renderer's sampling, interleaved identities, rejection/failure/interruption distinctions, and bounded structured details. Renderer snapshots do not replace real exporter-payload privacy tests. For trusted HttpClient, test automatic URL/header capture as well as nested provider causes; safe outer error mapping alone does not protect ended children. Follow repository required checks before delivery.
