import { DateTime, Duration, Effect, Layer } from "effect";

import { ToolCallQuota, toolCallLimits } from "#contexts/toolCalls/ToolCallQuota.ts";
import type {
  ToolCall,
  ToolCallDecision,
  ToolCallQuotaShape,
} from "#contexts/toolCalls/ToolCallQuota.ts";

import { ToolCallQuotaRepository } from "./ToolCallQuotaRepository.ts";

export const ToolCallQuotaLive = Layer.effect(
  ToolCallQuota,
  Effect.gen(function* () {
    const repository = yield* ToolCallQuotaRepository;

    const consume: ToolCallQuotaShape["consume"] = Effect.fn("ToolCallQuota.consume")(function* (
      call: ToolCall,
    ) {
      const limit = toolCallLimits[call.callClass];
      const now = yield* DateTime.now;
      const windowMillis = Duration.toMillis(limit.window);
      const windowStartedAt = DateTime.makeUnsafe(
        Math.floor(DateTime.toEpochMillis(now) / windowMillis) * windowMillis,
      );
      const ownerKey = ownerQuotaKey(call);
      const clientKey =
        call.clientId === undefined ? undefined : clientQuotaKey(call, call.clientId);
      const counted = yield* repository.count(
        clientKey === undefined ? [ownerKey] : [ownerKey, clientKey],
        windowStartedAt,
      );
      const ownerCount = countOf(counted, ownerKey);
      const clientCount = clientKey === undefined ? 0 : countOf(counted, clientKey);
      const bucket =
        ownerCount > limit.ownerMax
          ? ("owner" as const)
          : clientCount > limit.clientMax
            ? ("client" as const)
            : undefined;
      const retryAfter = Duration.millis(
        Math.max(
          1_000,
          DateTime.toEpochMillis(windowStartedAt) + windowMillis - DateTime.toEpochMillis(now),
        ),
      );
      yield* Effect.annotateCurrentSpan({
        "tool_call.class": call.callClass,
        "tool_call.outcome": bucket === undefined ? "allowed" : "quota_exhausted",
        ...(bucket === undefined
          ? {}
          : {
              "tool_call.bucket": bucket,
              "tool_call.retry_after_seconds": Math.ceil(Duration.toSeconds(retryAfter)),
            }),
      });
      const decision: ToolCallDecision =
        bucket === undefined
          ? { allowed: true }
          : { allowed: false, callClass: call.callClass, bucket, limit, retryAfter };
      return decision;
    });

    return ToolCallQuota.of({ consume });
  }),
);

function ownerQuotaKey(call: ToolCall): string {
  return `owner:${call.userId}:${call.callClass}`;
}

function clientQuotaKey(call: ToolCall, clientId: string): string {
  return `client:${call.userId}:${clientId}:${call.callClass}`;
}

function countOf(
  counted: ReadonlyArray<{ readonly key: string; readonly count: number }>,
  key: string,
): number {
  const row = counted.find((candidate) => candidate.key === key);
  if (row === undefined) {
    throw new Error("The tool-call quota counter was not returned");
  }
  return row.count;
}
