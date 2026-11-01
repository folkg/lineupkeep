import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { ToolCallQuotaDatabaseTest } from "./internal/ToolCallQuotaDatabaseTest.ts";
import { ToolCallQuotaLive } from "./internal/ToolCallQuotaLive.ts";
import { ToolCallQuotaRepository } from "./internal/ToolCallQuotaRepository.ts";
import { ToolCallQuota, ToolCallQuotaUnavailable, toolCallLimits } from "./ToolCallQuota.ts";
import type { ToolCall, ToolCallClass, ToolCallDecision } from "./ToolCallQuota.ts";

it.effect("allows a read loop up to its client allowance and refuses with the retry", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;
    const limit = toolCallLimits.read;

    for (let call = 0; call < limit.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(read("client-a")), { allowed: true });
    }

    const refused = refusal(yield* quota.consume(read("client-a")));
    assert.strictEqual(refused.bucket, "client");
    assert.strictEqual(refused.callClass, "read");
    assert.strictEqual(refused.limit.clientMax, limit.clientMax);
    assert.strictEqual(Duration.toSeconds(refused.retryAfter), Duration.toSeconds(limit.window));

    yield* TestClock.adjust(limit.window);
    assert.deepStrictEqual(yield* quota.consume(read("client-a")), { allowed: true });
  }).pipe(Effect.provide(ToolCallQuotaTest)),
);

it.effect("gives a write a smaller allowance than a read, and keeps the buckets apart", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;
    assert.isBelow(toolCallLimits.write.clientMax, toolCallLimits.read.clientMax);
    assert.isBelow(toolCallLimits.destructive.clientMax, toolCallLimits.write.clientMax);

    for (let call = 0; call < toolCallLimits.write.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(write("client-a")), { allowed: true });
    }
    const refused = refusal(yield* quota.consume(write("client-a")));
    assert.strictEqual(refused.callClass, "write");
    assert.strictEqual(refused.bucket, "client");

    for (let call = 0; call < toolCallLimits.destructive.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(destructive("client-a")), { allowed: true });
    }
    assert.isFalse((yield* quota.consume(destructive("client-a"))).allowed);

    assert.deepStrictEqual(yield* quota.consume(read("client-a")), { allowed: true });
    assert.deepStrictEqual(yield* quota.consume(destructive("client-b")), { allowed: true });
  }).pipe(Effect.provide(ToolCallQuotaTest)),
);

it.effect("leaves a second client's allowance intact when one client spends its own", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;
    const limit = toolCallLimits.read;

    for (let call = 0; call < limit.clientMax; call++) {
      yield* quota.consume(read("client-a"));
    }
    assert.strictEqual(refusal(yield* quota.consume(read("client-a"))).bucket, "client");

    for (let call = 0; call < limit.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(read("client-b")), { allowed: true });
    }

    for (let call = 0; call < limit.clientMax - 1; call++) {
      assert.deepStrictEqual(yield* quota.consume(read("client-c")), { allowed: true });
    }
    const shared = refusal(yield* quota.consume(read("client-c")));
    assert.strictEqual(shared.bucket, "owner");
    assert.strictEqual(shared.limit.ownerMax, limit.ownerMax);
    assert.deepStrictEqual(yield* quota.consume(write("client-c")), { allowed: true });
  }).pipe(Effect.provide(ToolCallQuotaTest)),
);

it.effect("charges a refused call, so hammering spends the owner's allowance too", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;
    const limit = toolCallLimits.destructive;

    for (let call = 0; call < limit.clientMax; call++) {
      yield* quota.consume(destructive("client-a"));
    }
    for (let call = 0; call < limit.clientMax; call++) {
      assert.isFalse((yield* quota.consume(destructive("client-a"))).allowed);
    }

    for (let call = 0; call < limit.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(destructive("client-b")), { allowed: true });
    }
    assert.strictEqual(refusal(yield* quota.consume(destructive("client-c"))).bucket, "owner");
  }).pipe(Effect.provide(ToolCallQuotaTest)),
);

it.effect("keeps the count across a fresh process over the same durable store", () =>
  Effect.gen(function* () {
    const limit = toolCallLimits.destructive;
    const first = yield* Effect.provide(
      ToolCallQuota,
      ToolCallQuotaLive.pipe(Layer.provide(ToolCallQuotaRepository.layer)),
    );
    for (let call = 0; call < limit.clientMax - 1; call++) {
      yield* first.consume(destructive("client-a"));
    }

    const second = yield* Effect.provide(
      ToolCallQuota,
      ToolCallQuotaLive.pipe(Layer.provide(ToolCallQuotaRepository.layer)),
    );
    assert.deepStrictEqual(yield* second.consume(destructive("client-a")), { allowed: true });
    assert.isFalse((yield* second.consume(destructive("client-a"))).allowed);
  }).pipe(Effect.provide(ToolCallQuotaDatabaseTest)),
);

it.effect("charges only the owner bucket when the token names no client", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;

    for (let call = 0; call < toolCallLimits.write.clientMax; call++) {
      assert.deepStrictEqual(yield* quota.consume(write(undefined)), { allowed: true });
    }
    assert.deepStrictEqual(yield* quota.consume(write(undefined)), { allowed: true });
  }).pipe(Effect.provide(ToolCallQuotaTest)),
);

it.effect("reports the durable store's failure instead of allowing the call", () =>
  Effect.gen(function* () {
    const quota = yield* ToolCallQuota;
    const failure = yield* Effect.flip(quota.consume(read("client-a")));
    assert.instanceOf(failure, ToolCallQuotaUnavailable);
  }).pipe(
    Effect.provide(
      ToolCallQuotaLive.pipe(
        Layer.provide(
          Layer.succeed(ToolCallQuotaRepository)({
            count: () => Effect.fail(ToolCallQuotaUnavailable.make({ cause: "database offline" })),
          }),
        ),
      ),
    ),
  ),
);

function read(clientId: string | undefined): ToolCall {
  return call("read", clientId);
}

function write(clientId: string | undefined): ToolCall {
  return call("write", clientId);
}

function destructive(clientId: string | undefined): ToolCall {
  return call("destructive", clientId);
}

function call(callClass: ToolCallClass, clientId: string | undefined): ToolCall {
  return { userId: decodeUserId("owner"), clientId, callClass };
}

function refusal(
  decision: ToolCallDecision,
): Extract<ToolCallDecision, { readonly allowed: false }> {
  if (decision.allowed) {
    throw new Error("Expected the tool-call quota to refuse");
  }
  return decision;
}

const ToolCallQuotaTest = ToolCallQuotaLive.pipe(
  Layer.provide(ToolCallQuotaRepository.layer),
  Layer.provideMerge(ToolCallQuotaDatabaseTest),
  Layer.orDie,
);
