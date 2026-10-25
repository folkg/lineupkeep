import { and, eq, lt } from "drizzle-orm";
import { Context, Crypto, DateTime, Duration, Effect, Layer } from "effect";
import { Hex } from "effect/encoding";

import { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { signInCodeQuota } from "./AuthTables.ts";

export class SignInCodeQuotaRepository extends Context.Service<SignInCodeQuotaRepository>()(
  "@lineupkeep/backend/contexts/auth/internal/SignInCodeQuotaRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const crypto = yield* Crypto.Crypto;

      const query = <A>(
        run: () => Promise<A>,
      ): Effect.Effect<A, AuthenticationUnavailable, never> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        });

      const keyFor = Effect.fn("SignInCodeQuotaRepository.keyFor")(function* (email: string) {
        const digest = yield* crypto
          .digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()))
          .pipe(Effect.mapError((cause) => AuthenticationUnavailable.make({ cause })));
        return `email:${Hex.encode(digest)}`;
      });

      const attempt = Effect.fn("SignInCodeQuotaRepository.attempt")(function* (
        key: string,
        limit: SignInCodeLimit,
      ) {
        const instant = yield* DateTime.now;
        const now = DateTime.toDateUtc(instant);
        const windowsStartedBefore = DateTime.toDateUtc(
          DateTime.subtractDuration(instant, limit.window),
        );
        const window = Duration.toMillis(limit.window);
        const [current] = yield* query(() =>
          database.select().from(signInCodeQuota).where(eq(signInCodeQuota.key, key)).limit(1),
        );

        if (current === undefined) {
          yield* query(() =>
            database
              .delete(signInCodeQuota)
              .where(lt(signInCodeQuota.windowStartedAt, windowsStartedBefore)),
          );
          const inserted = yield* query(() =>
            database
              .insert(signInCodeQuota)
              .values({ key, windowStartedAt: now, count: 1 })
              .onConflictDoNothing()
              .returning({ key: signInCodeQuota.key }),
          );
          return inserted.length > 0 ? allowed : undefined;
        }

        const windowEnds = current.windowStartedAt.getTime() + window;
        const unchanged = and(
          eq(signInCodeQuota.key, key),
          eq(signInCodeQuota.windowStartedAt, current.windowStartedAt),
          eq(signInCodeQuota.count, current.count),
        );
        if (now.getTime() < windowEnds && current.count >= limit.max) {
          const refused: SignInCodeDecision = {
            allowed: false,
            retryAfter: Duration.millis(windowEnds - now.getTime()),
          };
          return refused;
        }

        const next =
          now.getTime() >= windowEnds
            ? { windowStartedAt: now, count: 1 }
            : { count: current.count + 1 };
        const updated = yield* query(() =>
          database
            .update(signInCodeQuota)
            .set(next)
            .where(unchanged)
            .returning({ key: signInCodeQuota.key }),
        );
        return updated.length > 0 ? allowed : undefined;
      });

      const consume = Effect.fn("SignInCodeQuotaRepository.consume")(function* (
        email: string,
        limit: SignInCodeLimit,
      ) {
        const key = yield* keyFor(email);
        for (let tries = 0; tries < maxContendedTries; tries++) {
          const decision = yield* attempt(key, limit);
          if (decision !== undefined) {
            return decision;
          }
        }
        return yield* AuthenticationUnavailable.make({
          cause: new Error("Sign-in code quota stayed contended"),
        });
      });

      return { consume } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

const allowed: SignInCodeDecision = { allowed: true };

const maxContendedTries = 5;

type SignInCodeLimit = {
  readonly window: Duration.Duration;
  readonly max: number;
};

type SignInCodeDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfter: Duration.Duration };
