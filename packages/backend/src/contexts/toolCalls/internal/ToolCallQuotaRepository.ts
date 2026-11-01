import { Array, Context, DateTime, Effect, Layer } from "effect";

import { ToolCallQuotaUnavailable } from "#contexts/toolCalls/ToolCallQuota.ts";
import { incrementedWindowCounter } from "#database/dbUtilities.ts";

import { ToolCallQuotaDatabase } from "./ToolCallQuotaDatabase.ts";
import { toolCallQuota } from "./ToolCallQuotaTables.ts";

export class ToolCallQuotaRepository extends Context.Service<ToolCallQuotaRepository>()(
  "@lineupkeep/backend/contexts/toolCalls/internal/ToolCallQuotaRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ToolCallQuotaDatabase;

      const count = Effect.fn("ToolCallQuotaRepository.count")(function* (
        keys: Array.NonEmptyReadonlyArray<string>,
        windowStartedAt: DateTime.Utc,
      ) {
        const window = DateTime.toDateUtc(windowStartedAt);
        return yield* database
          .insert(toolCallQuota)
          .values(keys.map((key) => ({ key, windowStartedAt: window, count: 1 })))
          .onConflictDoUpdate({
            target: toolCallQuota.key,
            set: incrementedWindowCounter(toolCallQuota),
          })
          .returning({ key: toolCallQuota.key, count: toolCallQuota.count })
          .pipe(Effect.mapError((cause) => ToolCallQuotaUnavailable.make({ cause })));
      });

      return { count } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
