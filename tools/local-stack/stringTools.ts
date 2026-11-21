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
