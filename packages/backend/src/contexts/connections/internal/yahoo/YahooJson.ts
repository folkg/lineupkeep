const attributeFragmentKeys = new Set([
  "user",
  "game",
  "team",
  "league",
  "player",
  "transaction",
  "roster",
  "settings",
  "selected_position",
  "scoreboard",
  "matchup",
]);

export function normalizeYahooJson(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }
  const content = payload["fantasy_content"];
  return isRecord(content) ? normalizeRecord(content) : undefined;
}

function normalizeValue(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    return normalizeFragments(value, key);
  }
  return isRecord(value) ? normalizeRecord(value) : value;
}

function normalizeRecord(record: Record<string, unknown>): unknown {
  const keys = Object.keys(record);
  const numericKeys = keys.filter(isNumericKey);
  const metadataKeys = keys.filter((key) => !isNumericKey(key) && key !== "count");
  if (numericKeys.length === 0 && metadataKeys.length === 0) {
    return Object.hasOwn(record, "count") ? [] : {};
  }
  if (numericKeys.length === 0) {
    return Object.fromEntries(keys.map((key) => [key, normalizeValue(record[key], key)]));
  }
  const entries = numericKeys
    .toSorted((left, right) => Number(left) - Number(right))
    .map((key) => normalizeCollectionItem(record[key]));
  const metadata = Object.fromEntries(
    metadataKeys.map((key) => [key, normalizeValue(record[key], key)]),
  );
  return Object.keys(metadata).length === 0 ? entries : { ...metadata, entries };
}

function normalizeCollectionItem(value: unknown): unknown {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const onlyKey = keys[0];
    if (keys.length === 1 && onlyKey !== undefined && attributeFragmentKeys.has(onlyKey)) {
      return normalizeValue(value[onlyKey], onlyKey);
    }
  }
  return normalizeValue(value, "");
}

function normalizeFragments(fragments: ReadonlyArray<unknown>, key: string): unknown {
  const attributeFragments = fragments
    .flatMap((fragment): ReadonlyArray<unknown> =>
      Array.isArray(fragment) ? fragment : [fragment],
    )
    .filter((fragment) => !(Array.isArray(fragment) && fragment.length === 0));
  if (
    (key.endsWith("s") && !attributeFragmentKeys.has(key)) ||
    !attributeFragments.every(isRecord) ||
    !hasOnlyDistinctFields(attributeFragments)
  ) {
    return attributeFragments.map((fragment) => normalizeValue(fragment, ""));
  }
  return Object.assign({}, ...attributeFragments.map((fragment) => normalizeValue(fragment, "")));
}

function hasOnlyDistinctFields(records: ReadonlyArray<Record<string, unknown>>): boolean {
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericKey(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(key);
}
