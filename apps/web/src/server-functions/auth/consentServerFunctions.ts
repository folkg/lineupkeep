import { AuthService } from "@sourdough/backend/auth/Auth";
import { createIsomorphicFn, createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import { consentQuery } from "#browser/consent/consentLocation.ts";
import { ConsentRequestInput, ConsentDecisionInput } from "#server/auth/authServer.ts";
import { runBackend } from "#server/backendEntry.ts";
export const currentConsentQuery = createIsomorphicFn()
  .server(() => new URL(getRequest().url).search.slice(1))
  .client(consentQuery);

export const consentRequestServerFn = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ConsentRequestInput))
  .handler(({ data }) => {
    const request = getRequest();
    return runBackend(
      request,
      "auth.consent_request",
      AuthService.use((auth) => auth.getConsentRequest(request.headers, data.query)).pipe(
        Effect.tap((result) =>
          result.status === "invalid"
            ? Effect.annotateCurrentSpan("app.outcome", "rejected")
            : Effect.void,
        ),
      ),
    );
  });

export const decideConsentServerFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ConsentDecisionInput))
  .handler(({ data }) => {
    const request = getRequest();
    return runBackend(
      request,
      "auth.consent",
      AuthService.use((auth) => auth.consent(request.headers, data.query, data.accept)),
    );
  });
