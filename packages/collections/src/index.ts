export const EffectArray = {
  map: <A, B>(self: ReadonlyArray<A>, f: (value: A, index: number) => B): B[] => {
    const out: B[] = [];
    let index = 0;
    for (const value of self) {
      out.push(f(value, index));
      index += 1;
    }
    return out;
  },
  filter,
  flatMap: <A, B>(
    self: ReadonlyArray<A>,
    f: (value: A, index: number) => ReadonlyArray<B>,
  ): B[] => {
    const out: B[] = [];
    let index = 0;
    for (const value of self) {
      for (const mapped of f(value, index)) {
        out.push(mapped);
      }
      index += 1;
    }
    return out;
  },
  forEach: <A>(self: ReadonlyArray<A>, f: (value: A, index: number) => void): void => {
    let index = 0;
    for (const value of self) {
      f(value, index);
      index += 1;
    }
  },
  some: <A>(self: ReadonlyArray<A>, predicate: (value: A, index: number) => boolean): boolean => {
    let index = 0;
    for (const value of self) {
      if (predicate(value, index)) {
        return true;
      }
      index += 1;
    }
    return false;
  },
  every: <A>(self: ReadonlyArray<A>, predicate: (value: A, index: number) => boolean): boolean => {
    let index = 0;
    for (const value of self) {
      if (!predicate(value, index)) {
        return false;
      }
      index += 1;
    }
    return true;
  },
  findFirst: <A>(
    self: ReadonlyArray<A>,
    predicate: (value: A, index: number) => boolean,
  ): Option<A> => {
    let index = 0;
    for (const value of self) {
      if (predicate(value, index)) {
        return { _tag: "Some", value };
      }
      index += 1;
    }
    return { _tag: "None" };
  },
  findFirstIndex: <A>(
    self: ReadonlyArray<A>,
    predicate: (value: A, index: number) => boolean,
  ): Option<number> => {
    let index = 0;
    for (const value of self) {
      if (predicate(value, index)) {
        return { _tag: "Some", value: index };
      }
      index += 1;
    }
    return { _tag: "None" };
  },
  findLast: <A>(
    self: ReadonlyArray<A>,
    predicate: (value: A, index: number) => boolean,
  ): Option<A> => {
    let found: Option<A> = { _tag: "None" };
    let index = 0;
    for (const value of self) {
      if (predicate(value, index)) {
        found = { _tag: "Some", value };
      }
      index += 1;
    }
    return found;
  },
  reduce: <A, B>(
    self: ReadonlyArray<A>,
    initial: B,
    f: (accumulator: B, value: A, index: number) => B,
  ): B => {
    let accumulator = initial;
    let index = 0;
    for (const value of self) {
      accumulator = f(accumulator, value, index);
      index += 1;
    }
    return accumulator;
  },
  join: (self: ReadonlyArray<unknown>, separator = ","): string => {
    let out = "";
    let index = 0;
    for (const value of self) {
      if (index > 0) {
        out += separator;
      }
      out += String(value);
      index += 1;
    }
    return out;
  },
  sort: <A>(self: ReadonlyArray<A>, order: Order<A>): A[] => {
    let out: A[] = [];
    for (const value of self) {
      let insertAt = 0;
      for (const existing of out) {
        if (order(existing, value) > 0) {
          break;
        }
        insertAt += 1;
      }
      const next: A[] = [];
      let index = 0;
      for (const existing of out) {
        if (index === insertAt) {
          next.push(value);
        }
        next.push(existing);
        index += 1;
      }
      if (index === insertAt) {
        next.push(value);
      }
      out = next;
    }
    return out;
  },
  reverse: <A>(self: ReadonlyArray<A>): A[] => {
    const out: A[] = [];
    for (let index = self.length - 1; index >= 0; index -= 1) {
      const value = self[index];
      if (value !== undefined) {
        out.push(value);
      }
    }
    return out;
  },
  isArray: (value: unknown): value is ReadonlyArray<unknown> => value instanceof Array,
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

export function recordKeys(self: object): string[] {
  return Object.keys(self);
}

export function recordEntries(self: object): Array<[string, unknown]> {
  return Object.entries(self);
}

export function recordHas(self: object, key: PropertyKey): boolean {
  return Object.hasOwn(self, key);
}

export const EffectString = {
  includes: (self: string, search: string, position?: number): boolean =>
    self.includes(search, position),
  replaceAll: (
    self: string,
    search: string | RegExp,
    replacement: string | ((substring: string, ...args: string[]) => string),
  ): string => self.replaceAll(search, replacement as string),
  slice: (self: string, start?: number, end?: number): string => self.slice(start, end),
  trim: (self: string): string => self.trim(),
  startsWith: (self: string, search: string, position?: number): boolean =>
    self.startsWith(search, position),
  split: (self: string, separator: string | RegExp, limit?: number): string[] =>
    self.split(separator, limit),
  localeCompare: (
    self: string,
    that: string,
    locales?: string | string[],
    options?: Intl.CollatorOptions,
  ): number => self.localeCompare(that, locales, options),
  replace: (
    self: string,
    search: string | RegExp,
    replacement: string | ((substring: string, ...args: string[]) => string),
  ): string => self.replace(search, replacement as string),
  endsWith: (self: string, search: string, position?: number): boolean =>
    self.endsWith(search, position),
  repeat: (self: string, count: number): string => self.repeat(count),
  lastIndexOf: (self: string, search: string, position?: number): number =>
    self.lastIndexOf(search, position),
  toLowerCase: (self: string): string => self.toLowerCase(),
  indexOf: (self: string, search: string, position?: number): number =>
    self.indexOf(search, position),
  padStart: (self: string, length: number, fill?: string): string => self.padStart(length, fill),
  toUpperCase: (self: string): string => self.toUpperCase(),
  toLocaleLowerCase: (self: string, locales?: string | string[]): string =>
    self.toLocaleLowerCase(locales),
  charCodeAt: (self: string, index: number): number => self.charCodeAt(index),
  trimEnd: (self: string): string => self.trimEnd(),
  matchAll: (self: string, regexp: RegExp): IterableIterator<IndexedMatch> =>
    self.matchAll(regexp) as IterableIterator<IndexedMatch>,
  match: (self: string, regexp: RegExp): RegExpMatchArray | null => self.match(regexp),
  codePointAt: (self: string, index: number): number | undefined => self.codePointAt(index),
  charAt: (self: string, index: number): string => self.charAt(index),
  normalize: (self: string, form?: string): string => self.normalize(form),
};

export const EffectOption = {
  getOrUndefined: <A>(option: Option<A>): A | undefined =>
    option._tag === "Some" ? option.value : undefined,
  getOrElse: <A>(option: Option<A>, onNone: () => A): A =>
    option._tag === "Some" ? option.value : onNone(),
};

export const EffectOrder = {
  make:
    <A>(compare: (self: A, that: A) => number): Order<A> =>
    (self, that) => {
      if (self === that) {
        return 0;
      }
      const result = compare(self, that);
      return result < 0 ? -1 : result > 0 ? 1 : 0;
    },
  String: ((self: string, that: string): Ordering =>
    self < that ? -1 : self > that ? 1 : 0) as Order<string>,
};

function filter<A, B extends A>(
  self: ReadonlyArray<A>,
  predicate: (value: A, index: number) => value is B,
): B[];
function filter<A>(self: ReadonlyArray<A>, predicate: (value: A, index: number) => boolean): A[];
function filter<A>(self: ReadonlyArray<A>, predicate: (value: A, index: number) => boolean): A[] {
  const out: A[] = [];
  let index = 0;
  for (const value of self) {
    if (predicate(value, index)) {
      out.push(value);
    }
    index += 1;
  }
  return out;
}

type IndexedMatch = RegExpMatchArray & { readonly index: number };
type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" };
type Ordering = -1 | 0 | 1;
type Order<A> = (self: A, that: A) => Ordering;
