import type * as HttpClientError from "effect/http/HttpClientError";
import * as Schema from "effect/Schema";

export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()("Unauthorized", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
  structured: Schema.Boolean,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden, { readonly brand: unique symbol }>()(
  "Forbidden",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
    structured: Schema.Boolean,
  },
) {}

export class BadRequest extends Schema.TaggedError<BadRequest, { readonly brand: unique symbol }>()(
  "BadRequest",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export class NotFound extends Schema.TaggedError<NotFound, { readonly brand: unique symbol }>()(
  "NotFound",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export class Conflict extends Schema.TaggedError<Conflict, { readonly brand: unique symbol }>()(
  "Conflict",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export class UnprocessableEntity extends Schema.TaggedError<
  UnprocessableEntity,
  { readonly brand: unique symbol }
>()("UnprocessableEntity", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class Locked extends Schema.TaggedError<Locked, { readonly brand: unique symbol }>()(
  "Locked",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export class TooManyRequests extends Schema.TaggedError<
  TooManyRequests,
  { readonly brand: unique symbol }
>()("TooManyRequests", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class InternalServerError extends Schema.TaggedError<
  InternalServerError,
  { readonly brand: unique symbol }
>()("InternalServerError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class BadGateway extends Schema.TaggedError<BadGateway, { readonly brand: unique symbol }>()(
  "BadGateway",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

export class ServiceUnavailable extends Schema.TaggedError<
  ServiceUnavailable,
  { readonly brand: unique symbol }
>()("ServiceUnavailable", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class GatewayTimeout extends Schema.TaggedError<
  GatewayTimeout,
  { readonly brand: unique symbol }
>()("GatewayTimeout", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export class ConfigError extends Schema.TaggedError<
  ConfigError,
  { readonly brand: unique symbol }
>()("ConfigError", {
  message: Schema.String,
}) {}

export class YahooPremiumRequired extends Schema.TaggedError<
  YahooPremiumRequired,
  { readonly brand: unique symbol }
>()("YahooPremiumRequired", { message: Schema.String, status: Schema.optional(Schema.Number) }) {}

export class YahooHttpError extends Schema.TaggedError<
  YahooHttpError,
  { readonly brand: unique symbol }
>()("YahooHttpError", {
  status: Schema.Number,
  statusText: Schema.String,
  message: Schema.String,
  body: Schema.optional(Schema.String),
}) {}

export class YahooParseError extends Schema.TaggedError<
  YahooParseError,
  { readonly brand: unique symbol }
>()("YahooParseError", {
  operation: Schema.String,
  field: Schema.optional(Schema.String),
  body: Schema.optional(Schema.Unknown),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class YahooRequestInvalid extends Schema.TaggedError<
  YahooRequestInvalid,
  { readonly brand: unique symbol }
>()("YahooRequestInvalid", {
  operation: Schema.String,
  field: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
}) {}

export class YahooCoverageMismatch extends Schema.TaggedError<
  YahooCoverageMismatch,
  { readonly brand: unique symbol }
>()("YahooCoverageMismatch", {
  operation: Schema.String,
  requested: Schema.optional(Schema.Unknown),
  covered: Schema.optional(Schema.Unknown),
}) {}

export class YahooNotSent extends Schema.TaggedError<
  YahooNotSent,
  { readonly brand: unique symbol }
>()("YahooNotSent", {
  operation: Schema.String,
  reason: Schema.Literals(["session_incomplete", "request_failed"]),
  status: Schema.optional(Schema.Number),
  message: Schema.String,
}) {}

export class YahooWriteUnknown extends Schema.TaggedError<
  YahooWriteUnknown,
  { readonly brand: unique symbol }
>()("YahooWriteUnknown", {
  operation: Schema.String,
  status: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
}) {}

export type ClientErrors = YahooHttpError | YahooParseError;

export type StatusErrors =
  | Unauthorized
  | Forbidden
  | BadRequest
  | NotFound
  | Conflict
  | UnprocessableEntity
  | Locked
  | TooManyRequests
  | InternalServerError
  | BadGateway
  | ServiceUnavailable
  | GatewayTimeout;

export type DefaultErrors =
  | StatusErrors
  | ClientErrors
  | YahooRequestInvalid
  | YahooCoverageMismatch
  | ConfigError
  | HttpClientError.HttpClientError;

export type YahooReadError = DefaultErrors | YahooWriteUnknown;

export type YahooWriteError =
  | DefaultErrors
  | YahooPremiumRequired
  | YahooNotSent
  | YahooWriteUnknown;

export type YahooError = YahooReadError | YahooWriteError;
