import { Effect, Layer } from "effect";
import { Array as EffectArray } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { AccountErasure } from "#contexts/privacy/AccountErasure.ts";

import { AccountDataRepository } from "./AccountDataRepository.ts";

export const AccountErasureLive = Layer.effect(
  AccountErasure,
  Effect.gen(function* () {
    const repository = yield* AccountDataRepository;

    const erase = Effect.fn("AccountErasure.erase")(function* (userId: UserId) {
      const summary = yield* repository.erase(userId);
      yield* Effect.annotateCurrentSpan({
        "account_erasure.classes": summary.removed.length,
        "account_erasure.rows": EffectArray.reduce(
          summary.removed,
          0,
          (total, entry) => total + entry.count,
        ),
      });
      return summary;
    });

    return AccountErasure.of({ erase });
  }),
);
