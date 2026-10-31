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

import type { UserId } from "#contexts/auth/User.ts";
import {
  CounterpartyRef,
  PlayerRef,
  QueryCursorInvalid,
  QueryReferenceInvalid,
  StatRef,
  queryCursorTtlMillis,
} from "#contexts/connections/QueryValues.ts";
import type { QueryCursorInvalidReason } from "#contexts/connections/QueryValues.ts";

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

  readonly openCounterpartyRef: (input: {
    readonly userId: UserId;
    readonly leagueKey: string;
    readonly ref: CounterpartyRef;
  }) => Effect.Effect<string, QueryReferenceInvalid>;

  readonly statRef: (input: {
    readonly leagueKey: string;
    readonly statId: number;
  }) => Effect.Effect<StatRef>;
};

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
  );

  static readonly fromSecret = (secret: string): Layer.Layer<QueryTokens> =>
    Layer.effect(QueryTokens, makeQueryTokens(secret).pipe(Effect.orDie));
}

function makeQueryTokens(secret: string): Effect.Effect<QueryTokensShape> {
  return Effect.promise(() =>
    deriveKeys(secret).then((keys) => ({
      sealCursor: ({ userId, fingerprint, offset, now }) =>
        Effect.promise(() =>
          sealCursor(keys.hmac, {
            userId,
            fingerprint,
            offset,
            expiresAt: DateTime.toEpochMillis(now) + queryCursorTtlMillis,
          }),
        ),
      openCursor: ({ userId, fingerprint, cursor, now }) =>
        Effect.promise(() =>
          openCursor(keys.hmac, {
            userId,
            fingerprint,
            cursor,
            nowMillis: DateTime.toEpochMillis(now),
          }),
        ).pipe(
          Effect.flatMap((result) =>
            typeof result === "number"
              ? Effect.succeed(result)
              : QueryCursorInvalid.make({ reason: result }),
          ),
        ),
      sealPlayerRef: ({ userId, leagueKey, playerKey }) =>
        Effect.promise(() => sealReference(keys.aes, "player", userId, leagueKey, playerKey)).pipe(
          Effect.map((value) => Schema.decodeSync(PlayerRef)(value)),
        ),
      sealPlayerRefs: ({ userId, leagueKey, playerKeys }) =>
        Effect.promise(() =>
          Promise.all(
            playerKeys.map((playerKey) =>
              sealReference(keys.aes, "player", userId, leagueKey, playerKey),
            ),
          ),
        ).pipe(Effect.map((values) => values.map((value) => Schema.decodeSync(PlayerRef)(value)))),
      openPlayerRef: ({ userId, leagueKey, ref }) =>
        Effect.tryPromise({
          try: () => openReference(keys.aes, "player", userId, leagueKey, ref),
          catch: () => QueryReferenceInvalid.make({ reason: "invalid" }),
        }),
      openPlayerRefs: ({ userId, leagueKey, refs }) =>
        Effect.promise(() =>
          Promise.all(
            refs.map((ref) =>
              openReference(keys.aes, "player", userId, leagueKey, ref).catch(() => undefined),
            ),
          ),
        ),
      openPlayerRefGroups: ({ userId, groups }) =>
        Effect.promise(() =>
          Promise.all(
            groups.map((group) =>
              Promise.all(
                group.refs.map((ref) =>
                  openReference(keys.aes, "player", userId, group.leagueKey, ref).catch(
                    () => undefined,
                  ),
                ),
              ),
            ),
          ),
        ),
      sealCounterpartyRef: ({ userId, leagueKey, teamKey }) =>
        Effect.promise(() =>
          sealReference(keys.aes, "counterparty", userId, leagueKey, teamKey),
        ).pipe(Effect.map((value) => Schema.decodeSync(CounterpartyRef)(value))),
      sealCounterpartyRefs: ({ userId, leagueKey, teamKeys }) =>
        Effect.promise(() =>
          Promise.all(
            teamKeys.map((teamKey) =>
              sealReference(keys.aes, "counterparty", userId, leagueKey, teamKey),
            ),
          ),
        ).pipe(
          Effect.map((values) => values.map((value) => Schema.decodeSync(CounterpartyRef)(value))),
        ),
      openCounterpartyRef: ({ userId, leagueKey, ref }) =>
        Effect.tryPromise({
          try: () => openReference(keys.aes, "counterparty", userId, leagueKey, ref),
          catch: () => QueryReferenceInvalid.make({ reason: "invalid" }),
        }),
      statRef: ({ leagueKey, statId }) =>
        Effect.promise(() => statRef(keys.hmac, leagueKey, statId)),
    })),
  );
}

type Keys = {
  readonly hmac: CryptoKey;
  readonly aes: CryptoKey;
};

function deriveKeys(secret: string): Promise<Keys> {
  const encoder = new TextEncoder();
  return crypto.subtle
    .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
    .then((base) =>
      Promise.all([
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: buffer(new Uint8Array()),
            info: buffer(encoder.encode("lineupkeep.query-cursor.v1")),
          },
          base,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"],
        ),
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: buffer(new Uint8Array()),
            info: buffer(encoder.encode("lineupkeep.query-reference.v1")),
          },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      ]),
    )
    .then(([hmac, aes]) => ({ hmac, aes }));
}

function sealCursor(
  key: CryptoKey,
  input: {
    readonly userId: string;
    readonly fingerprint: string;
    readonly offset: number;
    readonly expiresAt: number;
  },
): Promise<string> {
  const payload = JSON.stringify({
    v: 1,
    o: input.offset,
    e: input.expiresAt,
    f: input.fingerprint,
  });
  return crypto.subtle
    .sign("HMAC", key, buffer(new TextEncoder().encode(`${input.userId}\u0000${payload}`)))
    .then(
      (signature) =>
        `c1.${base64Url(new TextEncoder().encode(payload))}.${base64Url(new Uint8Array(signature))}`,
    );
}

function openCursor(
  key: CryptoKey,
  input: {
    readonly userId: string;
    readonly fingerprint: string;
    readonly cursor: string;
    readonly nowMillis: number;
  },
): Promise<number | QueryCursorInvalidReason> {
  const [version, payloadPart, signaturePart] = input.cursor.split(".");
  if (version !== "c1" || payloadPart === undefined || signaturePart === undefined) {
    return Promise.resolve("invalid" as const);
  }
  const payloadBytes = fromBase64Url(payloadPart);
  const signature = fromBase64Url(signaturePart);
  if (payloadBytes === undefined || signature === undefined) {
    return Promise.resolve("invalid" as const);
  }
  const payload = new TextDecoder().decode(payloadBytes);
  return crypto.subtle
    .verify(
      "HMAC",
      key,
      buffer(signature),
      buffer(new TextEncoder().encode(`${input.userId}\u0000${payload}`)),
    )
    .then((valid) => {
      if (!valid) {
        return "invalid" as const;
      }
      const decoded = decodePayload(payload);
      if (decoded === undefined || !Number.isSafeInteger(decoded.o) || decoded.o < 0) {
        return "invalid" as const;
      }
      if (decoded.f !== input.fingerprint) {
        return "mismatch" as const;
      }
      if (decoded.e <= input.nowMillis) {
        return "expired" as const;
      }
      return decoded.o;
    });
}

function sealReference(
  key: CryptoKey,
  purpose: "player" | "counterparty",
  userId: string,
  leagueKey: string,
  value: string,
): Promise<string> {
  const nonce = buffer(crypto.getRandomValues(new Uint8Array(12)));
  const plaintext = buffer(new TextEncoder().encode(JSON.stringify({ v: 1, k: value })));
  return crypto.subtle
    .encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: buffer(referenceAad(purpose, userId, leagueKey)),
      },
      key,
      plaintext,
    )
    .then((ciphertext) => `r1.${base64Url(nonce)}.${base64Url(new Uint8Array(ciphertext))}`);
}

function openReference(
  key: CryptoKey,
  purpose: "player" | "counterparty",
  userId: string,
  leagueKey: string,
  ref: string,
): Promise<string> {
  const [version, noncePart, ciphertextPart] = ref.split(".");
  if (version !== "r1" || noncePart === undefined || ciphertextPart === undefined) {
    return Promise.reject(new Error("invalid reference"));
  }
  const nonce = fromBase64Url(noncePart);
  const ciphertext = fromBase64Url(ciphertextPart);
  if (nonce === undefined || ciphertext === undefined || nonce.length !== 12) {
    return Promise.reject(new Error("invalid reference"));
  }
  return crypto.subtle
    .decrypt(
      {
        name: "AES-GCM",
        iv: buffer(nonce),
        additionalData: buffer(referenceAad(purpose, userId, leagueKey)),
      },
      key,
      buffer(ciphertext),
    )
    .then(
      (plaintext) =>
        decodeReference(new TextDecoder().decode(plaintext)) ?? yieldInvalidReference(),
      () => yieldInvalidReference(),
    );
}

function statRef(key: CryptoKey, leagueKey: string, statId: number): Promise<StatRef> {
  return crypto.subtle
    .sign(
      "HMAC",
      key,
      buffer(new TextEncoder().encode(`stat\u0000${leagueKey}\u0000${String(statId)}`)),
    )
    .then((signature) =>
      Schema.decodeSync(StatRef)(`s1.${base64Url(new Uint8Array(signature).slice(0, 16))}`),
    );
}

function referenceAad(
  purpose: "player" | "counterparty",
  userId: string,
  leagueKey: string,
): Uint8Array {
  return new TextEncoder().encode(
    `lineupkeep.query-reference\u0000${purpose}\u0000${userId}\u0000${leagueKey}`,
  );
}

function yieldInvalidReference(): never {
  throw QueryReferenceInvalid.make({ reason: "invalid" });
}

function buffer(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
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
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return undefined;
  }
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
