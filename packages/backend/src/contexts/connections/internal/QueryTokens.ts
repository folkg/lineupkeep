import { EffectString } from "@lineupkeep/collections";
import {
  Config,
  ConfigProvider,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Array as EffectArray } from "effect";
import { Aead, Kdf, Mac, SecureRandom } from "effect/crypto";

import type { UserId } from "#contexts/auth/User.ts";
import {
  CounterpartyRef,
  PlayerRef,
  QueryCursorInvalid,
  QueryReferenceInvalid,
  StatRef,
  TradeOfferRef,
  queryCursorTtlMillis,
} from "#contexts/connections/QueryValues.ts";
import jsonTools from "#runtime/JsonText.ts";

export type QueryTokensShape = {
  readonly sealCursor: (input: {
    readonly userId: UserId;
    readonly fingerprint: string;
    readonly offset: number;
    readonly now: DateTime.Utc;
  }) => Effect.Effect<string>;

  readonly openCursor: (input: {
    readonly userId: UserId;
    readonly fingerprint: string;
    readonly cursor: string;
    readonly now: DateTime.Utc;
  }) => Effect.Effect<number, QueryCursorInvalid>;

  readonly sealPlayerRef: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly playerKey: string;
  }) => Effect.Effect<PlayerRef>;

  readonly sealPlayerRefs: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly playerKeys: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<PlayerRef>>;

  readonly sealPlayerRefGroups: (input: {
    readonly userId: UserId;
    readonly groups: ReadonlyArray<{
      readonly leagueKey: string;
      readonly playerKeys: ReadonlyArray<string>;
    }>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<PlayerRef>>>;

  readonly openPlayerRef: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly ref: PlayerRef;
  }) => Effect.Effect<string, QueryReferenceInvalid>;

  readonly openPlayerRefs: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly refs: ReadonlyArray<PlayerRef>;
  }) => Effect.Effect<ReadonlyArray<string | undefined>>;

  readonly openPlayerRefGroups: (input: {
    readonly userId: UserId;
    readonly groups: ReadonlyArray<{
      readonly leagueKey: string;
      readonly refs: ReadonlyArray<PlayerRef>;
    }>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<string | undefined>>>;

  readonly sealCounterpartyRef: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly teamKey: string;
  }) => Effect.Effect<CounterpartyRef>;

  readonly sealCounterpartyRefs: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly teamKeys: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<CounterpartyRef>>;

  readonly sealCounterpartyRefGroups: (input: {
    readonly userId: UserId;
    readonly groups: ReadonlyArray<{
      readonly leagueKey: string;
      readonly teamKeys: ReadonlyArray<string>;
    }>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<CounterpartyRef>>>;

  readonly openCounterpartyRef: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly ref: CounterpartyRef;
  }) => Effect.Effect<string, QueryReferenceInvalid>;

  readonly openCounterpartyRefGroups: (input: {
    readonly userId: UserId;
    readonly groups: ReadonlyArray<{
      readonly leagueKey: string;
      readonly refs: ReadonlyArray<CounterpartyRef>;
    }>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<string | undefined>>>;

  readonly sealTradeOfferRefGroups: (input: {
    readonly userId: UserId;
    readonly groups: ReadonlyArray<{
      readonly leagueKey: string;
      readonly transactionKeys: ReadonlyArray<string>;
    }>;
  }) => Effect.Effect<ReadonlyArray<ReadonlyArray<TradeOfferRef>>>;

  readonly statRef: (input: {
    readonly leagueKey: string;
    readonly statId: number;
  }) => Effect.Effect<StatRef>;
};

const QueryTokenCrypto = Layer.mergeAll(
  Kdf.layerWebCrypto,
  Mac.layerWebCrypto,
  Aead.layerWebCrypto,
).pipe(Layer.provideMerge(SecureRandom.layerWebCrypto));

export class QueryTokens extends Context.Service<QueryTokens, QueryTokensShape>()(
  "@lineupkeep/backend/contexts/connections/internal/QueryTokens",
) {
  static readonly layer: Layer.Layer<QueryTokens, Config.ConfigError> = Layer.effect(
    QueryTokens,
    Effect.gen(function* () {
      const configured = yield* Config.Redacted("BETTER_AUTH_SECRET");
      const secret = Redacted.value(configured);
      if (secret.length < 32) {
        return yield* Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: "BETTER_AUTH_SECRET must contain at least 32 characters for query tokens",
            }),
          ),
        );
      }
      return yield* makeQueryTokens(secret);
    }),
  ).pipe(Layer.provide(QueryTokenCrypto));

  static readonly fromSecret = (secret: string): Layer.Layer<QueryTokens> =>
    Layer.effect(QueryTokens, makeQueryTokens(secret).pipe(Effect.orDie)).pipe(
      Layer.provide(QueryTokenCrypto),
    );
}

function traverseEffectUnbounded<A, B>(
  items: ReadonlyArray<A>,
  f: (item: A) => Effect.Effect<B>,
): Effect.Effect<ReadonlyArray<B>> {
  return Effect.all(EffectArray.map(items, f), { concurrency: "unbounded" });
}

function makeQueryTokens(
  secret: string,
): Effect.Effect<
  QueryTokensShape,
  never,
  Kdf.Kdf | Mac.Mac | Aead.Aead | SecureRandom.SecureRandom
> {
  return Effect.gen(function* () {
    const kdf = yield* Kdf.Kdf;
    const mac = yield* Mac.Mac;
    const aead = yield* Aead.Aead;
    const random = yield* SecureRandom.SecureRandom;
    const encoder = new TextEncoder();

    const hmac = yield* kdf
      .derive(Kdf.hkdfSha256, encoder.encode(secret), {
        salt: new Uint8Array(),
        info: encoder.encode("lineupkeep.query-cursor.v1"),
        length: 32,
      })
      .pipe(
        Effect.flatMap((bytes) => Mac.key(Mac.hmacSha256, bytes)),
        Effect.orDie,
      );
    const aes = yield* kdf
      .derive(Kdf.hkdfSha256, encoder.encode(secret), {
        salt: new Uint8Array(),
        info: encoder.encode("lineupkeep.query-reference.v1"),
        length: 32,
      })
      .pipe(
        Effect.flatMap((bytes) => Aead.key(Aead.aes256Gcm, bytes)),
        Effect.orDie,
      );

    const sign = (data: string): Effect.Effect<Uint8Array> =>
      mac.sign(hmac, encoder.encode(data)).pipe(Effect.orDie);

    const sealCursor = (input: {
      readonly userId: UserId;
      readonly fingerprint: string;
      readonly offset: number;
      readonly expiresAt: number;
    }): Effect.Effect<string> => {
      const payload = jsonTools.jsonString({
        v: 1,
        o: input.offset,
        e: input.expiresAt,
        f: input.fingerprint,
      });
      return sign(`${input.userId}\u0000${payload}`).pipe(
        Effect.map(
          (signature) => `c1.${base64Url(encoder.encode(payload))}.${base64Url(signature)}`,
        ),
      );
    };

    const openCursor = (input: {
      readonly userId: string;
      readonly fingerprint: string;
      readonly cursor: string;
      readonly nowMillis: number;
    }): Effect.Effect<number, QueryCursorInvalid> =>
      Effect.gen(function* () {
        const [version, payloadPart, signaturePart] = EffectString.split(input.cursor, ".");
        if (version !== "c1" || payloadPart === undefined || signaturePart === undefined) {
          return yield* QueryCursorInvalid.make({ reason: "invalid" });
        }
        const payloadBytes = fromBase64Url(payloadPart);
        const signature = fromBase64Url(signaturePart);
        if (payloadBytes === undefined || signature === undefined) {
          return yield* QueryCursorInvalid.make({ reason: "invalid" });
        }
        const payload = new TextDecoder().decode(payloadBytes);
        const valid = yield* mac
          .verify(hmac, signature, encoder.encode(`${input.userId}\u0000${payload}`))
          .pipe(Effect.orDie);
        if (!valid) {
          return yield* QueryCursorInvalid.make({ reason: "invalid" });
        }
        const decoded = decodePayload(payload);
        if (decoded === undefined || !Number.isSafeInteger(decoded.o) || decoded.o < 0) {
          return yield* QueryCursorInvalid.make({ reason: "invalid" });
        }
        if (decoded.f !== input.fingerprint) {
          return yield* QueryCursorInvalid.make({ reason: "mismatch" });
        }
        if (decoded.e <= input.nowMillis) {
          return yield* QueryCursorInvalid.make({ reason: "expired" });
        }
        return decoded.o;
      });

    const sealReference = (
      purpose: ReferencePurpose,
      userId: string,
      leagueKey: string,
      value: string,
    ): Effect.Effect<string> =>
      Effect.gen(function* () {
        const nonce = yield* random.randomBytes(referenceNonceBytes);
        const ciphertext = yield* aead
          .encrypt(aes, encoder.encode(jsonTools.jsonString({ v: 1, k: value })), {
            nonce,
            aad: referenceAad(encoder, purpose, userId, leagueKey),
          })
          .pipe(Effect.orDie);
        return `r1.${base64Url(nonce)}.${base64Url(ciphertext)}`;
      });

    const openReference = (
      purpose: ReferencePurpose,
      userId: string,
      leagueKey: string,
      ref: string,
    ): Effect.Effect<string, QueryReferenceInvalid> =>
      Effect.gen(function* () {
        const [version, noncePart, ciphertextPart] = EffectString.split(ref, ".");
        if (version !== "r1" || noncePart === undefined || ciphertextPart === undefined) {
          return yield* QueryReferenceInvalid.make({ reason: "invalid" });
        }
        const nonce = fromBase64Url(noncePart);
        const ciphertext = fromBase64Url(ciphertextPart);
        if (
          nonce === undefined ||
          ciphertext === undefined ||
          nonce.length !== referenceNonceBytes
        ) {
          return yield* QueryReferenceInvalid.make({ reason: "invalid" });
        }
        const plaintext = yield* aead
          .decrypt(aes, ciphertext, {
            nonce,
            aad: referenceAad(encoder, purpose, userId, leagueKey),
          })
          .pipe(Effect.catch(() => QueryReferenceInvalid.make({ reason: "invalid" })));
        const decoded = decodeReference(new TextDecoder().decode(plaintext));
        return decoded ?? (yield* QueryReferenceInvalid.make({ reason: "invalid" }));
      });

    const statRef = (leagueKey: string, statId: number): Effect.Effect<StatRef> =>
      sign(`stat\u0000${leagueKey}\u0000${String(statId)}`).pipe(
        Effect.flatMap((signature) =>
          Schema.decodeEffect(StatRef)(
            `s1.${base64Url(signature.slice(0, statisticReferenceBytes))}`,
          ).pipe(Effect.orDie),
        ),
      );

    const sealPlayerReference = (
      userId: UserId,
      leagueKey: string,
      playerKey: string,
    ): Effect.Effect<PlayerRef> =>
      sealReference("player", userId, leagueKey, playerKey).pipe(
        Effect.flatMap((value) => Schema.decodeEffect(PlayerRef)(value).pipe(Effect.orDie)),
      );

    const sealCounterpartyReference = (
      userId: UserId,
      leagueKey: string,
      teamKey: string,
    ): Effect.Effect<CounterpartyRef> =>
      sealReference("counterparty", userId, leagueKey, teamKey).pipe(
        Effect.flatMap((value) => Schema.decodeEffect(CounterpartyRef)(value).pipe(Effect.orDie)),
      );

    return {
      sealCursor: ({ userId, fingerprint, offset, now }) =>
        sealCursor({
          userId,
          fingerprint,
          offset,
          expiresAt: DateTime.toEpochMillis(now) + queryCursorTtlMillis,
        }),
      openCursor: ({ userId, fingerprint, cursor, now }) =>
        openCursor({
          userId,
          fingerprint,
          cursor,
          nowMillis: DateTime.toEpochMillis(now),
        }),
      sealPlayerRef: ({ userId, leagueKey, playerKey }) =>
        sealPlayerReference(userId, leagueKey, playerKey),
      sealPlayerRefs: ({ userId, leagueKey, playerKeys }) =>
        traverseEffectUnbounded(playerKeys, (playerKey) =>
          sealPlayerReference(userId, leagueKey, playerKey),
        ),
      sealPlayerRefGroups: ({ userId, groups }) =>
        traverseEffectUnbounded(groups, (group) =>
          traverseEffectUnbounded(group.playerKeys, (playerKey) =>
            sealPlayerReference(userId, group.leagueKey, playerKey),
          ),
        ),
      openPlayerRef: ({ userId, leagueKey, ref }) =>
        openReference("player", userId, leagueKey, ref),
      openPlayerRefs: ({ userId, leagueKey, refs }) =>
        traverseEffectUnbounded(refs, (ref) =>
          openReference("player", userId, leagueKey, ref).pipe(
            Effect.catchTag("query.reference_invalid", () => Effect.undefined),
          ),
        ),
      openPlayerRefGroups: ({ userId, groups }) =>
        traverseEffectUnbounded(groups, (group) =>
          traverseEffectUnbounded(group.refs, (ref) =>
            openReference("player", userId, group.leagueKey, ref).pipe(
              Effect.catchTag("query.reference_invalid", () => Effect.undefined),
            ),
          ),
        ),
      sealCounterpartyRef: ({ userId, leagueKey, teamKey }) =>
        sealCounterpartyReference(userId, leagueKey, teamKey),
      sealCounterpartyRefs: ({ userId, leagueKey, teamKeys }) =>
        traverseEffectUnbounded(teamKeys, (teamKey) =>
          sealCounterpartyReference(userId, leagueKey, teamKey),
        ),
      sealCounterpartyRefGroups: ({ userId, groups }) =>
        traverseEffectUnbounded(groups, (group) =>
          traverseEffectUnbounded(group.teamKeys, (teamKey) =>
            sealCounterpartyReference(userId, group.leagueKey, teamKey),
          ),
        ),
      openCounterpartyRef: ({ userId, leagueKey, ref }) =>
        openReference("counterparty", userId, leagueKey, ref),
      openCounterpartyRefGroups: ({ userId, groups }) =>
        traverseEffectUnbounded(groups, (group) =>
          traverseEffectUnbounded(group.refs, (ref) =>
            openReference("counterparty", userId, group.leagueKey, ref).pipe(
              Effect.catchTag("query.reference_invalid", () => Effect.undefined),
            ),
          ),
        ),
      sealTradeOfferRefGroups: ({ userId, groups }) =>
        traverseEffectUnbounded(groups, (group) =>
          traverseEffectUnbounded(group.transactionKeys, (transactionKey) =>
            sealReference("trade_offer", userId, group.leagueKey, transactionKey).pipe(
              Effect.flatMap((value) =>
                Schema.decodeEffect(TradeOfferRef)(value).pipe(Effect.orDie),
              ),
            ),
          ),
        ),
      statRef: ({ leagueKey, statId }) => statRef(leagueKey, statId),
    };
  });
}

type ReferencePurpose = "player" | "counterparty" | "trade_offer";

const referenceNonceBytes = 12;
const statisticReferenceBytes = 16;

function referenceAad(
  encoder: TextEncoder,
  purpose: ReferencePurpose,
  userId: string,
  leagueKey: string,
): Uint8Array {
  return encoder.encode(
    `lineupkeep.query-reference\u0000${purpose}\u0000${userId}\u0000${leagueKey}`,
  );
}

const CursorPayload = Schema.Struct({
  v: Schema.Literal(1),
  o: Schema.Int,
  e: Schema.Finite,
  f: Schema.String,
});

function decodePayload(value: string): typeof CursorPayload.Type | undefined {
  const option = Schema.decodeOption(Schema.fromJsonString(CursorPayload))(value);
  return Option.isSome(option) ? option.value : undefined;
}

const ReferencePayload = Schema.Struct({
  v: Schema.Literal(1),
  k: Schema.NonEmptyString,
});

function decodeReference(value: string): string | undefined {
  const decoded = Schema.decodeOption(Schema.fromJsonString(ReferencePayload))(value);
  return Option.isSome(decoded) ? decoded.value.k : undefined;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return EffectString.replaceAll(
    EffectString.replaceAll(EffectString.replaceAll(btoa(binary), "+", "-"), "/", "_"),
    "=",
    "",
  );
}

function fromBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return undefined;
  }
  const padding = value.length % 4 === 0 ? "" : EffectString.repeat("=", 4 - (value.length % 4));
  try {
    const binary = atob(
      EffectString.replaceAll(EffectString.replaceAll(value, "-", "+"), "_", "/") + padding,
    );
    return Uint8Array.from(binary, (character) => EffectString.charCodeAt(character, 0));
  } catch {
    return undefined;
  }
}
