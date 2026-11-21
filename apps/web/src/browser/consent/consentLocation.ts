import { EffectString } from "@lineupkeep/collections";
export function consentQuery(): string {
  return EffectString.slice(window.location.search, 1);
}

export function returnToClient(url: string): void {
  window.location.assign(url);
}
