import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import { HttpClient } from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { Credentials } from "./credentials.ts";
import {
  BadGateway,
  BadRequest,
  ConfigError,
  Conflict,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  YahooCoverageMismatch,
  YahooHttpError,
  YahooNotSent,
  YahooParseError,
  YahooPremiumRequired,
  YahooWriteUnknown,
} from "./errors.ts";
import type { StatusErrors, YahooReadError, YahooWriteError } from "./errors.ts";
import { normalizeYahooJson } from "./json.ts";

export type YahooHost =
  | "read"
  | "service"
  | "write"
  | "mobile"
  | "statcloud"
  | "dfyql"
  | "wallet"
  | "fandom"
  | "graphite";

export interface RequestSpec {
  readonly host: YahooHost;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly format?: "json" | "json_f" | "none";
}

interface DecodeArgs<I, O> {
  readonly operation: string;
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly input: I;
  readonly decode: (
    payload: unknown,
    input: I,
  ) => Effect.Effect<O, YahooParseError | YahooCoverageMismatch | Unauthorized | YahooWriteUnknown>;
}

export interface ProtocolShape {
  readonly encode: {
    (args: {
      readonly request: RequestSpec;
      readonly write: false;
    }): Effect.Effect<
      HttpClientRequest.HttpClientRequest,
      ConfigError | YahooParseError,
      Credentials | HttpClient
    >;
    (args: {
      readonly request: RequestSpec;
      readonly write: true;
    }): Effect.Effect<
      HttpClientRequest.HttpClientRequest,
      ConfigError | Unauthorized | Forbidden | YahooNotSent | YahooParseError,
      Credentials | HttpClient
    >;
  };
  readonly decode: {
    <I, O>(args: DecodeArgs<I, O> & { readonly write: false }): Effect.Effect<O, YahooReadError>;
    <I, O>(args: DecodeArgs<I, O> & { readonly write: true }): Effect.Effect<O, YahooWriteError>;
  };
}

export class Protocol extends Context.Service<Protocol, ProtocolShape>()("YahooProtocol") {}

export const YahooProtocol = Layer.succeed(Protocol)({
  encode,
  decode,
});

const hosts: Readonly<Record<YahooHost, string>> = {
  read: "https://pub-api-ro.fantasysports.yahoo.com",
  service: "https://pub-api.fantasysports.yahoo.com",
  write: "https://pub-api-rw.fantasysports.yahoo.com",
  mobile: "https://api-fantasy-mobile.sports.yahoo.com",
  statcloud: "https://api-statcloud.sports.yahoo.com",
  dfyql: "https://dfyql-ro.sports.yahoo.com",
  wallet: "https://wyql-ro.sports.yahoo.com",
  fandom: "https://sports-fandom-api.sports.yahoo.com",
  graphite: "https://graphite.sports.yahoo.com",
};

const readDeadline = Duration.seconds(30);
const readLimitBytes = 4 * 1024 * 1024;
const writeDeadline = Duration.seconds(30);
const writeLimitBytes = 256 * 1024;

function encode(args: {
  readonly request: RequestSpec;
  readonly write: false;
}): Effect.Effect<HttpClientRequest.HttpClientRequest, ConfigError, Credentials | HttpClient>;
function encode(args: {
  readonly request: RequestSpec;
  readonly write: true;
}): Effect.Effect<
  HttpClientRequest.HttpClientRequest,
  ConfigError | Unauthorized | Forbidden | YahooNotSent | YahooParseError,
  Credentials | HttpClient
>;
function encode(args: {
  readonly request: RequestSpec;
  readonly write: boolean;
}): Effect.Effect<
  HttpClientRequest.HttpClientRequest,
  ConfigError | Unauthorized | Forbidden | YahooNotSent | YahooParseError,
  Credentials | HttpClient
> {
  return Effect.gen(function* () {
    const credentials = yield* Credentials;
    const session = yield* credentials;
    const crumb = args.write ? yield* readCrumb(session.cookie) : "";
    const url = yield* requestUrl(args.request, crumb);
    const headers: Record<string, string> = {
      accept: "application/json",
      cookie: Redacted.value(session.cookie),
    };
    const body =
      args.request.body === undefined
        ? undefined
        : HttpBody.text(args.request.body, "application/xml");
    if (body !== undefined) {
      headers["content-type"] = "application/xml";
    }
    return HttpClientRequest.make(args.request.method)(url, { headers, body });
  });
}

function readCrumb(
  cookie: Redacted.Redacted<string>,
): Effect.Effect<string, Unauthorized | Forbidden | YahooNotSent | YahooParseError, HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient;
    const request = HttpClientRequest.get(
      yield* requestUrl(
        {
          host: "service",
          method: "GET",
          path: "/fantasy/v3/getCrumb",
          format: "json_f",
        },
        "",
      ),
      {
        headers: { accept: "application/json", cookie: Redacted.value(cookie) },
      },
    );
    const response = yield* Effect.timeoutOrElse(client.execute(request), {
      duration: readDeadline,
      orElse: () =>
        Effect.fail(
          new YahooNotSent({
            operation: "read_crumb",
            reason: "request_failed",
            message: "Yahoo did not answer the crumb request within 30 seconds.",
          }),
        ),
    }).pipe(
      Effect.mapError((error) =>
        error instanceof YahooNotSent
          ? error
          : new YahooNotSent({
              operation: "read_crumb",
              reason: "request_failed",
              message: error.message,
            }),
      ),
    );
    const text = yield* response.text.pipe(
      Effect.mapError(
        (error) =>
          new YahooNotSent({
            operation: "read_crumb",
            reason: "request_failed",
            status: response.status,
            message: error.message,
          }),
      ),
    );
    if (response.status === 401) {
      return yield* Effect.fail(
        new Unauthorized({
          message: providerMessage(text) ?? "Yahoo rejected the session.",
        }),
      );
    }
    if (response.status === 403) {
      return yield* Effect.fail(
        new Forbidden({
          message: providerMessage(text) ?? "Yahoo refused access to the crumb.",
        }),
      );
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new YahooNotSent({
          operation: "read_crumb",
          reason: "request_failed",
          status: response.status,
          ...(providerMessage(text) === undefined ? {} : { message: providerMessage(text) }),
        }),
      );
    }
    const crumb = crumbOf(text);
    if (crumb === undefined) {
      return yield* Effect.fail(
        new YahooNotSent({
          operation: "read_crumb",
          reason: "session_incomplete",
          message:
            "Yahoo did not return a crumb for this session. Sign in again through the hosted browser.",
        }),
      );
    }
    return crumb;
  });
}

function decode(
  args: DecodeArgs<unknown, unknown> & { readonly write: false },
): Effect.Effect<unknown, YahooReadError>;
function decode(
  args: DecodeArgs<unknown, unknown> & { readonly write: true },
): Effect.Effect<unknown, YahooWriteError>;
function decode(
  args: DecodeArgs<unknown, unknown> & { readonly write: boolean },
): Effect.Effect<unknown, YahooWriteError> {
  return Effect.gen(function* () {
    const text = yield* readBody(args.response, args.operation, args.write);
    if (args.response.status >= 200 && args.response.status < 300) {
      const payload = text.trim() === "" ? undefined : parseJson(text);
      if (text.trim() !== "" && payload === undefined) {
        return yield* Effect.fail(
          new YahooParseError({
            operation: args.operation,
            field: "body",
            body: text,
          }),
        );
      }
      const normalized =
        isRecord(payload) && Object.hasOwn(payload, "fantasy_content")
          ? normalizeYahooJson(payload)
          : payload;
      return yield* args.decode(normalized, args.input);
    }
    const message = providerMessage(text);
    if (args.response.status === 401) {
      return yield* Effect.fail(
        new Unauthorized({ message: message ?? "Yahoo rejected the session." }),
      );
    }
    if (args.response.status === 403) {
      return yield* Effect.fail(
        new Forbidden({ message: message ?? "Yahoo refused this request." }),
      );
    }
    if (message !== undefined && /premium/iu.test(message)) {
      return yield* Effect.fail(new YahooPremiumRequired({ message }));
    }
    if (args.write) {
      if (args.response.status === 408 || args.response.status === 429) {
        return yield* Effect.fail(
          new YahooNotSent({
            operation: args.operation,
            reason: "request_failed",
            status: args.response.status,
            ...(message === undefined ? {} : { message }),
          }),
        );
      }
      if (args.response.status >= 500) {
        return yield* Effect.fail(
          new YahooWriteUnknown({
            operation: args.operation,
            status: args.response.status,
            ...(message === undefined ? {} : { message }),
          }),
        );
      }
    }
    const failure = statusFailure(args.response.status, message);
    if (failure !== undefined) {
      return yield* Effect.fail(failure);
    }
    return yield* Effect.fail(
      new YahooHttpError({
        status: args.response.status,
        statusText: "",
        message: message ?? `Yahoo answered with HTTP ${String(args.response.status)}.`,
        ...(text === "" ? {} : { body: text }),
      }),
    );
  });
}

function readBody(
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
  write: boolean,
): Effect.Effect<string, YahooWriteError> {
  const limit = write ? writeLimitBytes : readLimitBytes;
  const deadline = write ? writeDeadline : readDeadline;
  return effectBody(response, deadline).pipe(
    Effect.mapError((error) =>
      write
        ? new YahooWriteUnknown({
            operation,
            status: response.status,
            message: error.message,
          })
        : new YahooHttpError({
            status: response.status,
            statusText: "",
            message: error.message,
          }),
    ),
    Effect.flatMap((text) =>
      new TextEncoder().encode(text).byteLength > limit
        ? Effect.fail(
            write
              ? new YahooWriteUnknown({
                  operation,
                  status: response.status,
                  message: `Yahoo's response exceeded ${String(limit)} bytes.`,
                })
              : new YahooHttpError({
                  status: response.status,
                  statusText: "",
                  message: `Yahoo's response exceeded ${String(limit)} bytes.`,
                }),
          )
        : Effect.succeed(text),
    ),
  );
}

function effectBody(
  response: HttpClientResponse.HttpClientResponse,
  deadline: Duration.Duration,
): Effect.Effect<string, { readonly message: string }> {
  return Effect.timeoutOrElse(response.text, {
    duration: deadline,
    orElse: () =>
      Effect.fail({
        message: "Yahoo's response body could not be read in time.",
      }),
  }).pipe(
    Effect.mapError(() => ({
      message: "Yahoo's response body could not be read.",
    })),
  );
}

function requestUrl(request: RequestSpec, crumb: string): Effect.Effect<string, YahooParseError> {
  return Effect.gen(function* () {
    if (!request.path.startsWith("/") || request.path.includes("?") || request.path.includes("#")) {
      return yield* Effect.fail(new YahooParseError({ operation: "request", field: "path" }));
    }
    const origin = new URL(hosts[request.host]);
    const url = new URL(request.path, origin);
    if (url.origin !== origin.origin || url.pathname !== request.path) {
      return yield* Effect.fail(new YahooParseError({ operation: "request", field: "path" }));
    }
    if (request.host === "write") {
      url.searchParams.set("format", "json_f");
      url.searchParams.set("crumb", crumb);
    } else if (request.format !== "none") {
      url.searchParams.set("format", request.format ?? "json");
    }
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  });
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function crumbOf(text: string): string | undefined {
  const payload = parseJson(text);
  if (!isRecord(payload) || !isRecord(payload["service"])) {
    return undefined;
  }
  const crumb = payload["service"]["crumb"];
  return typeof crumb === "string" && crumb.trim() !== "" ? crumb.trim() : undefined;
}

function statusFailure(status: number, message: string | undefined): StatusErrors | undefined {
  switch (status) {
    case 400:
      return new BadRequest({
        message: message ?? "Yahoo rejected the request.",
      });
    case 404:
      return new NotFound({
        message: message ?? "Yahoo could not find the requested resource.",
      });
    case 408:
      return new GatewayTimeout({
        message: message ?? "Yahoo did not answer in time.",
      });
    case 409:
      return new Conflict({
        message: message ?? "Yahoo reported a conflicting change.",
      });
    case 422:
      return new UnprocessableEntity({
        message: message ?? "Yahoo could not process the request.",
      });
    case 423:
      return new Locked({
        message: message ?? "Yahoo locked the requested resource.",
      });
    case 429:
      return new TooManyRequests({
        message: message ?? "Yahoo rate-limited the request.",
      });
    case 500:
      return new InternalServerError({
        message: message ?? "Yahoo failed to answer the request.",
      });
    case 502:
      return new BadGateway({
        message: message ?? "Yahoo returned an invalid upstream response.",
      });
    case 503:
      return new ServiceUnavailable({
        message: message ?? "Yahoo is temporarily unavailable.",
      });
    case 504:
      return new GatewayTimeout({
        message: message ?? "Yahoo did not answer in time.",
      });
    default:
      return undefined;
  }
}

function providerMessage(text: string): string | undefined {
  const payload = parseJson(text);
  const fromJson = jsonMessage(payload);
  if (fromJson !== undefined) {
    return withoutProviderSecrets(fromJson);
  }
  const xml =
    /<(?:description|message)>([\s\S]*?)<\/(?:description|message)>/iu.exec(text)?.[1] ??
    /<error>([\s\S]*?)<\/error>/iu.exec(text)?.[1];
  if (xml !== undefined) {
    const statement = statementText(xml);
    if (statement !== undefined) {
      return withoutProviderSecrets(statement);
    }
  }
  const statement = statementText(text);
  return statement === undefined ? undefined : withoutProviderSecrets(statement);
}

function jsonMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const error = payload["error"];
  if (typeof error === "string" && error.trim() !== "") {
    return error.trim();
  }
  if (isRecord(error)) {
    for (const key of ["description", "message", "detail"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
  }
  for (const key of ["description", "message", "detail"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function statementText(value: string): string | undefined {
  const cleaned = value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function withoutProviderSecrets(text: string): string {
  return text
    .replace(/\bcrumb=[^&"'\s<]*/giu, "crumb=<redacted>")
    .replace(/("crumb"\s*:\s*")[^"]*(")/giu, "$1<redacted>$2")
    .replace(/<crumb>[\s\S]*?<\/crumb>/giu, "<crumb><redacted></crumb>");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
