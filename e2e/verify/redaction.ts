import { EffectString } from "@lineupkeep/collections";
import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";

function sortWithComparator<A>(
  self: ReadonlyArray<A>,
  compare: (left: A, right: A) => number,
): ReadonlyArray<A> {
  return EffectArray.sort(
    self,
    EffectOrder.make<A>((left, right) => {
      const result = compare(left, right);
      return result < 0 ? -1 : result > 0 ? 1 : 0;
    }),
  );
}

export function redactEvidence(
  exchange: unknown,
  knownCredentials: ReadonlyArray<string> = [],
): unknown {
  const credentials = new Set<string>(knownCredentials);
  collectCredentials(exchange, credentials);
  const longestFirst = sortWithComparator(
    EffectArray.filter([...credentials], Boolean),
    (left, right) => right.length - left.length,
  );
  return scrubEvidence(exchange, longestFirst);
}

function collectCredentials(value: unknown, credentials: Set<string>, key = ""): void {
  if (typeof value === "string") {
    collectStringCredentials(value, key, credentials);
  } else if (EffectArray.isArray(value)) {
    EffectArray.forEach(value, (entry: unknown) => collectCredentials(entry, credentials));
  } else if (typeof value === "object" && value !== null) {
    EffectArray.forEach(Object.entries(value), ([name, entry]) =>
      collectCredentials(entry, credentials, name),
    );
  }
}

function collectStringCredentials(value: string, key: string, credentials: Set<string>): void {
  if (sensitive.test(key)) {
    credentials.add(value);
    if (/^(cookie|set-cookie)$/iu.test(key)) {
      const cookies =
        EffectString.toLowerCase(key) === "cookie"
          ? EffectString.split(value, ";")
          : EffectString.split(value, ";").slice(0, 1);
      for (const cookie of cookies) {
        const secret = EffectString.trim(
          EffectString.slice(cookie, EffectString.indexOf(cookie, "=") + 1),
        );
        if (secret !== "") {
          credentials.add(secret);
        }
      }
    } else if (/^(authorization|proxy-authorization)$/iu.test(key)) {
      const secret = EffectString.slice(value, EffectString.indexOf(value, " ") + 1);
      if (secret !== "") {
        credentials.add(secret);
      }
    }
  }
  for (const match of EffectString.matchAll(
    value,
    /(?:[?&]|^)(?:code|code_verifier|access_token|refresh_token|id_token|client_secret)=([^&\s]+)/giu,
  )) {
    const encoded = match[1];
    if (encoded !== undefined) {
      credentials.add(encoded);
      credentials.add(decodeURIComponent(encoded));
    }
  }
}

function scrubEvidence(value: unknown, credentials: ReadonlyArray<string>, key = ""): unknown {
  if (typeof value === "string") {
    return sensitive.test(key)
      ? "[REDACTED]"
      : EffectArray.reduce(credentials, value, (text, secret) =>
          EffectString.replaceAll(text, secret, "[REDACTED]"),
        );
  }
  if (EffectArray.isArray(value)) {
    return EffectArray.map(value, (entry: unknown) => scrubEvidence(entry, credentials));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      EffectArray.map(Object.entries(value), ([name, entry]) => [
        name,
        scrubEvidence(entry, credentials, name),
      ]),
    );
  }
  return value;
}

const sensitive =
  /^(authorization|proxy-authorization|cookie|set-cookie|code|code_verifier|access_token|refresh_token|id_token|oauth_query|client_secret|dpop)$/iu;
