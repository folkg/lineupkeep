import { Effect, Layer } from "effect";

import { SignInSessions } from "#contexts/auth/SignInSessions.ts";
import type { SignInSessionId, SignInSessionSummary } from "#contexts/auth/SignInSessions.ts";
import type { UserId } from "#contexts/auth/User.ts";

import { deviceHint } from "./DeviceHint.ts";
import { SignInSessionRepository } from "./SignInSessionRepository.ts";
import type { SignInSessionRecord } from "./SignInSessionRepository.ts";

export const SignInSessionsLive = Layer.effect(
  SignInSessions,
  Effect.gen(function* () {
    const repository = yield* SignInSessionRepository;

    const list = Effect.fn("SignInSessions.list")(function* (userId: UserId) {
      const records = yield* repository.list(userId);
      yield* Effect.annotateCurrentSpan({ "session.listed": records.length });
      return records.map(toSummary);
    });

    const end = Effect.fn("SignInSessions.end")(function* (
      userId: UserId,
      sessionIds: ReadonlyArray<SignInSessionId>,
    ) {
      const ended = yield* repository.end(userId, sessionIds);
      yield* Effect.annotateCurrentSpan({ "session.ended": ended.length });
      return ended;
    });

    const endOthers = Effect.fn("SignInSessions.endOthers")(function* (
      userId: UserId,
      keptSessionId: SignInSessionId,
    ) {
      const ended = yield* repository.endOthers(userId, keptSessionId);
      yield* Effect.annotateCurrentSpan({ "session.ended_others": ended.length });
      return ended;
    });

    return SignInSessions.of({ list, end, endOthers });
  }),
);

function toSummary(record: SignInSessionRecord): SignInSessionSummary {
  return {
    id: record.id,
    device: deviceHint(record.userAgent),
    startedAt: record.startedAt,
    lastUsedAt: record.lastUsedAt,
  };
}
