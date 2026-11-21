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
  if (EffectArray.isArray(value)) {
    return normalizeFragments(value, key);
  }
  return isRecord(value) ? normalizeRecord(value) : value;
}

function normalizeRecord(record: Record<string, unknown>): unknown {
  const keys = Object.keys(record);
  const numericKeys = EffectArray.filter(keys, isNumericKey);
  const metadataKeys = EffectArray.filter(keys, (key) => !isNumericKey(key) && key !== "count");
  if (numericKeys.length === 0 && metadataKeys.length === 0) {
    return Object.hasOwn(record, "count") ? [] : {};
  }
  if (numericKeys.length === 0) {
    return Object.fromEntries(
      EffectArray.map(keys, (key) => [key, normalizeValue(record[key], key)]),
    );
  }
  const entries = EffectArray.map(
    sortWithComparator(numericKeys, (left, right) => Number(left) - Number(right)),
    (key) => normalizeCollectionItem(record[key]),
  );
  const metadata = Object.fromEntries(
    EffectArray.map(metadataKeys, (key) => [key, normalizeValue(record[key], key)]),
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
  const attributeFragments = EffectArray.filter(
    EffectArray.flatMap(fragments, (fragment) =>
      EffectArray.isArray(fragment) ? fragment : [fragment],
    ),
    (fragment) => !(EffectArray.isArray(fragment) && fragment.length === 0),
  );
  if (
    (key.endsWith("s") && !attributeFragmentKeys.has(key)) ||
    !EffectArray.every(attributeFragments, isRecord) ||
    !hasOnlyDistinctFields(attributeFragments)
  ) {
    return EffectArray.map(attributeFragments, (fragment) => normalizeValue(fragment, ""));
  }
  return Object.assign(
    {},
    ...EffectArray.map(attributeFragments, (fragment) => normalizeValue(fragment, "")),
  );
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
  return typeof value === "object" && value !== null && !EffectArray.isArray(value);
}

function isNumericKey(key: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(key);
}

export function findPendingTradeKey(value: unknown): string | undefined {
  if (EffectArray.isArray(value)) {
    for (const entry of value) {
      const found = findPendingTradeKey(entry);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const key = value["transaction_key"];
  if (value["type"] === "pending_trade" && typeof key === "string") {
    return key;
  }
  for (const entry of Object.values(value)) {
    const found = findPendingTradeKey(entry);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
