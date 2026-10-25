import { PublicInternet } from "#runtime/PublicInternet.ts";

export const publicInternetIsolate = PublicInternet.fromTransport((request, init) =>
  globalThis.fetch(request, init),
);
