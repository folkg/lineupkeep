import { DateTime, Effect, Layer } from "effect";

import {
  AccountRetention,
  AccountRetentionPersistenceFailed,
} from "#contexts/auth/AccountRetention.ts";
import { retentionPolicy } from "#retention/RetentionPolicy.ts";

import { AccountRetentionRepository } from "./AccountRetentionRepository.ts";
import { OAuthClientRepository } from "./OAuthClientRepository.ts";

export const AccountRetentionLive = Layer.effect(
  AccountRetention,
  Effect.gen(function* () {
    const repository = yield* AccountRetentionRepository;
    const registrations = yield* OAuthClientRepository;

    const run = Effect.fn("AccountRetention.run")(function* (limit: number, at: DateTime.Utc) {
      const removedRegistrations = yield* registrations
        .expireUnapproved(at, limit)
        .pipe(Effect.mapError((cause) => AccountRetentionPersistenceFailed.make({ cause })));
      const expired = yield* repository.expired({
        at,
        consentsBefore: DateTime.subtractDuration(at, retentionPolicy.oauthConsent.millis),
        limit,
      });
      const summary = { ...expired, registrations: removedRegistrations };
      yield* Effect.annotateCurrentSpan({
        "account_retention.sessions": summary.sessions,
        "account_retention.verifications": summary.verifications,
        "account_retention.consents": summary.consents,
        "account_retention.registrations": summary.registrations,
      });
      return summary;
    });

    return AccountRetention.of({ run });
  }),
);
