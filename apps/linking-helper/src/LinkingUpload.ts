import type { ProviderKey } from "@lineupkeep/backend/connections/Connection";
import {
  linkingHelperUploadPath,
  LinkingHelperUploadFailure,
  LinkingHelperUploadRequestJson,
  LinkingHelperUploadSuccess,
} from "@lineupkeep/backend/connections/LinkingHelperUpload";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";

import { AppTransport } from "./AppTransport.ts";

export class LinkingUpload extends Context.Service<LinkingUpload, LinkingUploadShape>()(
  "@lineupkeep/linking-helper/LinkingUpload",
) {}

export type LinkingUploadInput = {
  readonly appUrl: URL;
  readonly token: Redacted.Redacted<string>;
  readonly userCode: string;
  readonly provider: ProviderKey;
  readonly session: Redacted.Redacted<string>;
};

export type LinkingUploadShape = {
  readonly upload: (input: LinkingUploadInput) => Effect.Effect<void, LinkingUploadFailure>;
};

export const LinkingUploadLive = Layer.effect(
  LinkingUpload,
  Effect.gen(function* () {
    const transport = yield* AppTransport;

    const upload = Effect.fn("LinkingUpload.upload")(function* (input: LinkingUploadInput) {
      const body = yield* Schema.encodeEffect(LinkingHelperUploadRequestJson)({
        userCode: input.userCode,
        provider: input.provider,
        session: input.session,
      }).pipe(Effect.mapError(() => LinkingUploadInvalidResponse.make({})));
      const response = yield* transport
        .send(
          new Request(new URL(linkingHelperUploadPath, input.appUrl), {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${Redacted.value(input.token)}`,
              "content-type": "application/json",
              origin: input.appUrl.origin,
            },
            body,
            redirect: "error",
          }),
        )
        .pipe(Effect.mapError(() => LinkingUploadUnreachable.make({})));

      if (response.status === 200) {
        yield* Schema.decodeEffect(Schema.fromJsonString(LinkingHelperUploadSuccess))(
          response.body,
        ).pipe(Effect.mapError(() => LinkingUploadInvalidResponse.make({})));
        return;
      }

      const failure = Schema.decodeUnknownOption(Schema.fromJsonString(LinkingHelperUploadFailure))(
        response.body,
      );
      if (Option.isNone(failure)) {
        return yield* LinkingUploadInvalidResponse.make({});
      }
      return yield* uploadFailure(failure.value.error);
    });

    return LinkingUpload.of({ upload });
  }),
);

function uploadFailure(error: string): Effect.Effect<never, LinkingUploadFailure> {
  switch (error) {
    case "unauthorized":
    case "insufficient_scope":
      return Effect.fail(LinkingUploadUnauthorized.make({}));
    case "connection_not_found":
      return Effect.fail(LinkingUploadPairingNotFound.make({}));
    case "link_expired":
      return Effect.fail(LinkingUploadExpired.make({}));
    case "link_cancelled":
    case "link_rejected":
      return Effect.fail(LinkingUploadRejected.make({}));
    case "provider_session_rejected":
      return Effect.fail(LinkingUploadProviderRejected.make({}));
    case "provider_unavailable":
      return Effect.fail(LinkingUploadProviderUnavailable.make({}));
    case "temporarily_unavailable":
      return Effect.fail(LinkingUploadUnavailable.make({}));
    case "invalid_request":
    case "request_too_large":
      return Effect.fail(LinkingUploadInvalidResponse.make({}));
    default:
      return Effect.fail(LinkingUploadInvalidResponse.make({}));
  }
}

class LinkingUploadUnauthorized extends Schema.TaggedError<
  LinkingUploadUnauthorized,
  { readonly brand: unique symbol }
>()("linking_helper.upload_unauthorized", {}) {}

class LinkingUploadPairingNotFound extends Schema.TaggedError<
  LinkingUploadPairingNotFound,
  { readonly brand: unique symbol }
>()("linking_helper.upload_pairing_not_found", {}) {}

class LinkingUploadExpired extends Schema.TaggedError<
  LinkingUploadExpired,
  { readonly brand: unique symbol }
>()("linking_helper.upload_expired", {}) {}

export class LinkingUploadRejected extends Schema.TaggedError<
  LinkingUploadRejected,
  { readonly brand: unique symbol }
>()("linking_helper.upload_rejected", {}) {}

class LinkingUploadProviderRejected extends Schema.TaggedError<
  LinkingUploadProviderRejected,
  { readonly brand: unique symbol }
>()("linking_helper.upload_provider_rejected", {}) {}

class LinkingUploadProviderUnavailable extends Schema.TaggedError<
  LinkingUploadProviderUnavailable,
  { readonly brand: unique symbol }
>()("linking_helper.upload_provider_unavailable", {}) {}

class LinkingUploadUnavailable extends Schema.TaggedError<
  LinkingUploadUnavailable,
  { readonly brand: unique symbol }
>()("linking_helper.upload_unavailable", {}) {}

class LinkingUploadUnreachable extends Schema.TaggedError<
  LinkingUploadUnreachable,
  { readonly brand: unique symbol }
>()("linking_helper.upload_unreachable", {}) {}

class LinkingUploadInvalidResponse extends Schema.TaggedError<
  LinkingUploadInvalidResponse,
  { readonly brand: unique symbol }
>()("linking_helper.upload_invalid_response", {}) {}

export type LinkingUploadFailure =
  | LinkingUploadUnauthorized
  | LinkingUploadPairingNotFound
  | LinkingUploadExpired
  | LinkingUploadRejected
  | LinkingUploadProviderRejected
  | LinkingUploadProviderUnavailable
  | LinkingUploadUnavailable
  | LinkingUploadUnreachable
  | LinkingUploadInvalidResponse;
