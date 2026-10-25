import { AuthService } from "@lineupkeep/backend/auth/Auth";
import {
  linkingHelperClient,
  linkingHelperScope,
} from "@lineupkeep/backend/auth/AuthorizationScopes";
import type { ConnectionError } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type {
  LinkingHelperUploadErrorCode,
  LinkingHelperUploadRequest,
} from "@lineupkeep/backend/connections/LinkingHelperUpload";
import {
  LinkingHelperUploadRequestJson,
  LinkingHelperUploadSuccess,
} from "@lineupkeep/backend/connections/LinkingHelperUpload";
import { Effect, Option, Schema } from "effect";

import { mapAuthenticationFailure, runBackend } from "#server/backendEntry.ts";

const maximumUploadBytes = 16_384;

export function handleLinkingHelperUpload(request: Request): Promise<Response> {
  return runBackend(
    request,
    "connections.complete_linking_upload",
    completeLinkingHelperUpload(request),
  ).catch(mapAuthenticationFailure);
}

export const completeLinkingHelperUpload = Effect.fn("connections.completeLinkingUpload")(
  function* (request: Request) {
    const auth = yield* AuthService;
    const bearer = bearerToken(request.headers);
    if (bearer === undefined) {
      return yield* refusal("unauthorized", 401);
    }

    const identity = yield* auth.resolveAccessToken(
      bearer,
      [linkingHelperScope.name],
      linkingHelperClient.clientId,
    );
    if (identity.status === "invalid") {
      return yield* refusal("unauthorized", 401);
    }
    if (identity.status === "insufficient_scope") {
      return yield* refusal("insufficient_scope", 403);
    }
    yield* Effect.annotateCurrentSpan({
      "auth.state": "authenticated",
      "user.id": identity.userId,
    });

    const text = yield* Effect.tryPromise({
      try: () => request.text(),
      catch: () => "unreadable" as const,
    }).pipe(Effect.option);
    if (Option.isNone(text)) {
      return yield* refusal("invalid_request", 400);
    }
    if (text.value.length > maximumUploadBytes) {
      return yield* refusal("request_too_large", 413);
    }
    const body = yield* Schema.decodeEffect(LinkingHelperUploadRequestJson)(text.value).pipe(
      Effect.option,
    );
    if (Option.isNone(body)) {
      return yield* refusal("invalid_request", 400);
    }

    const connections = yield* Connections;
    const listed = yield* connections.list(identity.userId).pipe(Effect.result);
    if (listed._tag === "Failure") {
      return yield* connectionFailure(listed.failure);
    }
    const connection = listed.success.find(
      (candidate) =>
        candidate.pairingCode === body.value.userCode && candidate.status === "linking",
    );
    if (connection === undefined) {
      return yield* refusal("connection_not_found", 404);
    }

    const completed = yield* connections
      .completeLinking(identity.userId, [
        {
          id: connection.id,
          provider: body.value.provider,
          session: body.value.session,
        },
      ])
      .pipe(Effect.result);
    if (completed._tag === "Failure") {
      return yield* connectionFailure(completed.failure);
    }
    return yield* success(body.value.provider);
  },
);

function connectionFailure(error: ConnectionError): Effect.Effect<Response> {
  switch (error._tag) {
    case "connection.link_expired":
      return refusal("link_expired", 409);
    case "connection.link_rejected":
      return error.status === "disconnected"
        ? refusal("link_cancelled", 409)
        : refusal("link_rejected", 409);
    case "connection.provider_rejected":
      return refusal("provider_session_rejected", 422);
    case "connection.provider_unavailable":
      return refusal("provider_unavailable", 503);
    case "connection.not_found":
      return refusal("connection_not_found", 404);
    case "connection.credential_generation_stale":
      return refusal("link_rejected", 409);
    case "connection.create_failed":
    case "connection.persistence_failed":
      return refusal("temporarily_unavailable", 503);
  }
}

function success(provider: LinkingHelperUploadRequest["provider"]): Effect.Effect<Response> {
  return Effect.annotateCurrentSpan({
    "app.outcome": "success",
    "http.response.status_code": 200,
  }).pipe(
    Effect.as(
      Response.json(Schema.encodeSync(LinkingHelperUploadSuccess)({ status: "ready", provider }), {
        headers: responseHeaders(200),
      }),
    ),
  );
}

function refusal(
  error: LinkingHelperUploadErrorCode,
  status: number,
): Effect.Effect<Response, never, never> {
  return Effect.annotateCurrentSpan({
    "app.outcome": status >= 500 ? "failure" : "rejected",
    "error.type": error,
    "http.response.status_code": status,
  }).pipe(Effect.as(Response.json({ error }, { status, headers: responseHeaders(status) })));
}

function responseHeaders(status: number): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  if (status === 401) {
    headers.set("www-authenticate", "Bearer");
  }
  return headers;
}

function bearerToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  return authorization === null ? undefined : /^Bearer ([^\s]+)$/u.exec(authorization)?.[1];
}
