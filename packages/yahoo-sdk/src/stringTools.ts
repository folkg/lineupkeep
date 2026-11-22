export const EffectString = {
  endsWith: (self: string, search: string, position?: number): boolean =>
    self.endsWith(search, position),
  includes: (self: string, search: string, position?: number): boolean =>
    self.includes(search, position),
  lastIndexOf: (self: string, search: string): number => self.lastIndexOf(search),
  repeat: (self: string, count: number): string => self.repeat(count),
  replace: (self: string, search: string | RegExp, replacement: string): string =>
    self.replace(search, replacement),
  replaceAll: (self: string, search: string | RegExp, replacement: string): string =>
    self.replaceAll(search, replacement),
  slice: (self: string, start?: number, end?: number): string => self.slice(start, end),
  split: (self: string, separator: string | RegExp, limit?: number): string[] =>
    self.split(separator, limit),
  startsWith: (self: string, search: string, position?: number): boolean =>
    self.startsWith(search, position),
  trim: (self: string): string => self.trim(),
};

export function optionalStringValue<A extends string, B>(value: A, f: (value: A) => B): B;
export function optionalStringValue<A extends string, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
export function optionalStringValue<A extends string, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

export function jsonValue<T = unknown>(text: string): T {
  return JSON.parse(text) as T;
}
