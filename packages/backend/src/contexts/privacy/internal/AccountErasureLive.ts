import { Effect, Layer } from "effect";

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
        "account_erasure.rows": summary.removed.reduce((total, entry) => total + entry.count, 0),
      });
      return summary;
    });

    return AccountErasure.of({ erase });
  }),
);
