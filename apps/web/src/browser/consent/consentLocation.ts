export function consentQuery(): string {
  return window.location.search.slice(1);
}

export function returnToClient(url: string): void {
  window.location.assign(url);
}
