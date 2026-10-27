import { Schema } from "effect";

import { ProviderKey } from "./Connection.ts";

export const linkingHelperUploadPath = "/api/linking/complete";

const ProviderSessionValue = Schema.RedactedFromValue(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))),
);

export const LinkingHelperUploadRequest = Schema.Struct({
  userCode: Schema.Trim.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  provider: ProviderKey,
  session: ProviderSessionValue,
});
export type LinkingHelperUploadRequest = typeof LinkingHelperUploadRequest.Type;

export const LinkingHelperUploadRequestJson = Schema.fromJsonString(LinkingHelperUploadRequest);

export const LinkingHelperUploadSuccess = Schema.Struct({
  status: Schema.Literal("ready"),
  provider: ProviderKey,
});
export type LinkingHelperUploadSuccess = typeof LinkingHelperUploadSuccess.Type;

const linkingHelperUploadErrorCodes = [
  "unauthorized",
  "insufficient_scope",
  "invalid_request",
  "request_too_large",
  "connection_not_found",
  "link_expired",
  "link_cancelled",
  "link_rejected",
  "provider_session_rejected",
  "provider_unavailable",
  "temporarily_unavailable",
] as const;

export const LinkingHelperUploadErrorCode = Schema.Literals(linkingHelperUploadErrorCodes);
export type LinkingHelperUploadErrorCode = typeof LinkingHelperUploadErrorCode.Type;

export const LinkingHelperUploadFailure = Schema.Struct({ error: LinkingHelperUploadErrorCode });
export type LinkingHelperUploadFailure = typeof LinkingHelperUploadFailure.Type;
