import type { Page } from "@playwright/test";

export function namePage(page: Page, name: string): void {
  names.set(page, name);
}

export function pagePersona(page: Page): string {
  return names.get(page) ?? "primary";
}

const names = new WeakMap<Page, string>();
