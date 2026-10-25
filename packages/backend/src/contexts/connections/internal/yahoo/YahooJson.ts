const singularResourceKeys = new Set([
  "user",
  "game",
  "team",
  "league",
  "player",
  "transaction",
  "roster",
]);

export function normalizeYahooJson(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }
  const content = payload["fantasy_content"];
  return isRecord(content) ? normalizeRecord(content) : undefined;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return normalizeFragments(value);
  }
  return isRecord(value) ? normalizeRecord(value) : value;
}

function normalizeRecord(record: Record<string, unknown>): unknown {
  if (isCollection(record)) {
    return normalizeCollection(record);
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function normalizeCollection(record: Record<string, unknown>): ReadonlyArray<unknown> {
  return Object.keys(record)
    .filter(isNumericKey)
    .toSorted((left, right) => Number(left) - Number(right))
    .map((key) => normalizeCollectionItem(record[key]));
}

function normalizeCollectionItem(value: unknown): unknown {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const onlyKey = keys[0];
    if (keys.length === 1 && onlyKey !== undefined && singularResourceKeys.has(onlyKey)) {
      return normalizeValue(value[onlyKey]);
    }
  }
  return normalizeValue(value);
}

function normalizeFragments(fragments: ReadonlyArray<unknown>): unknown {
  if (!fragments.every(isRecord)) {
    return fragments.map(normalizeValue);
  }
  return Object.assign({}, ...fragments.map((fragment) => normalizeCollectionItem(fragment)));
}

function isCollection(record: Record<string, unknown>): boolean {
  if (!Object.hasOwn(record, "count")) {
    return false;
  }
  return Object.keys(record).every((key) => key === "count" || isNumericKey(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericKey(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(key);
}
