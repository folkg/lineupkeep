import { EffectString } from "@lineupkeep/collections";
import { dual } from "effect/Function";

export const canonicalHostRedirect: {
  (request: Request, canonicalUrl: string): Response | undefined;
  (canonicalUrl: string): (request: Request) => Response | undefined;
} = dual(2, (request: Request, canonicalUrl: string): Response | undefined => {
  const url = new URL(request.url);
  const canonical = new URL(canonicalUrl);
  if (url.origin === canonical.origin) {
    return undefined;
  }
  if (!EffectString.endsWith(url.hostname, ".run.app") || url.pathname === "/healthz") {
    return undefined;
  }
  return Response.redirect(new URL(`${url.pathname}${url.search}`, canonical), 308);
});
