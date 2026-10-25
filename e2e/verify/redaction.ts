export function redactEvidence(
  exchange: unknown,
  knownCredentials: ReadonlyArray<string> = [],
): unknown {
  const credentials = new Set<string>(knownCredentials);
  collectCredentials(exchange, credentials);
  const longestFirst = [...credentials]
    .filter(Boolean)
    .toSorted((left, right) => right.length - left.length);
  return scrubEvidence(exchange, longestFirst);
}

function collectCredentials(value: unknown, credentials: Set<string>, key = ""): void {
  if (typeof value === "string") {
    collectStringCredentials(value, key, credentials);
  } else if (Array.isArray(value)) {
    value.forEach((entry: unknown) => collectCredentials(entry, credentials));
  } else if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([name, entry]) => collectCredentials(entry, credentials, name));
  }
}

function collectStringCredentials(value: string, key: string, credentials: Set<string>): void {
  if (sensitive.test(key)) {
    credentials.add(value);
    if (/^(cookie|set-cookie)$/iu.test(key)) {
      const cookies =
        key.toLowerCase() === "cookie" ? value.split(";") : value.split(";").slice(0, 1);
      for (const cookie of cookies) {
        const secret = cookie.slice(cookie.indexOf("=") + 1).trim();
        if (secret !== "") {
          credentials.add(secret);
        }
      }
    } else if (/^(authorization|proxy-authorization)$/iu.test(key)) {
      const secret = value.slice(value.indexOf(" ") + 1);
      if (secret !== "") {
        credentials.add(secret);
      }
    }
  }
  for (const match of value.matchAll(
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
      : credentials.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => scrubEvidence(entry, credentials));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, scrubEvidence(entry, credentials, name)]),
    );
  }
  return value;
}

const sensitive =
  /^(authorization|proxy-authorization|cookie|set-cookie|code|code_verifier|access_token|refresh_token|id_token|oauth_query|client_secret|dpop)$/iu;
