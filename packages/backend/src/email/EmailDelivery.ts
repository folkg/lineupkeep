import {
  Config,
  ConfigProvider,
  Console,
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { HttpClientError } from "effect/http";

import { appEnvironmentConfig } from "#config/AppEnvironment.ts";

export class EmailDelivery extends Context.Service<EmailDelivery, EmailDeliveryShape>()(
  "@lineupkeep/backend/email/EmailDelivery",
) {
  static readonly fromConfig: Layer.Layer<EmailDelivery, Config.ConfigError, EmailTransport> =
    Layer.unwrap(
      Effect.gen(function* () {
        const environment = yield* appEnvironmentConfig;
        const apiKey = yield* Config.option(Config.Redacted("RESEND_API_KEY"));
        if (Option.isSome(apiKey)) {
          return EmailDelivery.resend;
        }
        if (environment === "production") {
          return yield* Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: "RESEND_API_KEY is required in production to deliver email",
              }),
            ),
          );
        }
        return EmailDelivery.console;
      }),
    );

  static readonly resend: Layer.Layer<EmailDelivery, Config.ConfigError, EmailTransport> =
    Layer.effect(EmailDelivery)(
      Effect.gen(function* () {
        const config = yield* resendConfig;
        const crypto = yield* Crypto.Crypto;
        const client = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(HttpClientRequest.prependUrl(config.baseUrl.href)),
          HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(config.apiKey))),
          HttpClient.filterStatusOk,

          HttpClient.retryTransient({ schedule: Schedule.exponential("200 millis"), times: 2 }),
        );

        const send = Effect.fn("email.send")(function* (message: EmailMessage) {
          yield* Effect.annotateCurrentSpan({
            "email.provider": "resend",
            "email.purpose": message.purpose,
          });
          const idempotencyKey =
            message.idempotencyKey ??
            (yield* crypto
              .randomUUIDv4()
              .pipe(Effect.mapError(() => EmailDeliveryFailed.make({ reason: "unavailable" }))));
          const response = yield* HttpClientRequest.post("/emails").pipe(
            HttpClientRequest.setHeader("idempotency-key", idempotencyKey),
            HttpClientRequest.bodyJsonUnsafe({
              from: config.from,
              to: [message.to],
              subject: message.subject,
              text: message.text,
            }),
            client.execute,
            Effect.catchTag("HttpClientError", (error) =>
              Effect.flatMap(resendFailure(error), Effect.fail),
            ),
            Effect.flatMap((response) =>
              HttpClientResponse.schemaBodyJson(ResendEmailResponse)(response).pipe(
                Effect.mapError(() => EmailDeliveryFailed.make({ reason: "unavailable" })),
              ),
            ),
          );
          yield* Effect.annotateCurrentSpan("email.provider_message_id", response.id);
        });

        const sendMany = (
          messages: ReadonlyArray<EmailMessage>,
        ): Effect.Effect<ReadonlyArray<EmailDeliveryResult>> =>
          Effect.forEach(
            messages,
            (message) =>
              send(message).pipe(
                Effect.as({ _tag: "sent" as const }),
                Effect.catchTag("EmailDeliveryFailed", (failure) =>
                  Effect.succeed({ _tag: "failed" as const, reason: failure.reason }),
                ),
              ),
            { concurrency: 2 },
          );
        return { send, sendMany };
      }),
    );

  static readonly console: Layer.Layer<EmailDelivery> = Layer.succeed(
    EmailDelivery,
    (() => {
      const send = Effect.fn("email.send")(function* (message: EmailMessage) {
        yield* Effect.annotateCurrentSpan({
          "email.provider": "console",
          "email.purpose": message.purpose,
        });
        yield* Console.log(
          [`✉ To: ${message.to}`, `  Subject: ${message.subject}`, "", message.text].join("\n"),
        );
      });
      return {
        send,
        sendMany: (messages: ReadonlyArray<EmailMessage>) =>
          Effect.forEach(
            messages,
            (message) => send(message).pipe(Effect.as({ _tag: "sent" as const })),
            {
              concurrency: 2,
            },
          ),
      };
    })(),
  );
}

export class EmailDeliveryFailed extends Schema.TaggedError<
  EmailDeliveryFailed,
  { readonly brand: unique symbol }
>()("EmailDeliveryFailed", {
  reason: Schema.Literals(["rejected", "unavailable"]),
  detail: Schema.optional(Schema.String),
  recipientPolicy: Schema.optional(Schema.Boolean),
}) {}

const ResendErrorBody = Schema.Struct({
  message: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

function resendFailure(
  error: HttpClientError.HttpClientError | Schema.SchemaError,
): Effect.Effect<EmailDeliveryFailed> {
  if (error._tag !== "HttpClientError") {
    return Effect.succeed(EmailDeliveryFailed.make({ reason: "unavailable" }));
  }
  const status = error.response?.status;
  const rejected = status !== undefined && status >= 400 && status < 500 && status !== 429;
  const response = error.response;
  if (response === undefined) {
    return Effect.succeed(
      EmailDeliveryFailed.make({ reason: rejected ? "rejected" : "unavailable" }),
    );
  }
  return HttpClientResponse.schemaBodyJson(ResendErrorBody)(response).pipe(
    Effect.map((body) => providerDetail(body.message ?? body.name)),
    Effect.orElseSucceed(() => undefined),
    Effect.map((message) =>
      EmailDeliveryFailed.make({
        reason: rejected ? "rejected" : "unavailable",
        ...(message === undefined ? {} : { detail: message }),
        ...(message !== undefined && providerRefusesRecipient(message)
          ? { recipientPolicy: true }
          : {}),
      }),
    ),
  );
}

function providerDetail(message: string | undefined): string | undefined {
  if (message === undefined) {
    return undefined;
  }
  const withoutAddresses = message.replaceAll(/[^\s@]+@[^\s@]+/gu, "[address]");
  return withoutAddresses.length > 200 ? `${withoutAddresses.slice(0, 197)}...` : withoutAddresses;
}

function providerRefusesRecipient(message: string): boolean {
  return /only send testing emails to your own email address/iu.test(message);
}

const resendConfig = Config.all({
  apiKey: Config.Redacted("RESEND_API_KEY"),
  from: Config.String("EMAIL_FROM"),
  baseUrl: Config.URL("RESEND_API_BASE_URL").pipe(
    Config.withDefault(new URL("https://api.resend.com")),
  ),
});

const ResendEmailResponse = Schema.Struct({ id: Schema.String });

export type EmailTransport = HttpClient.HttpClient | Crypto.Crypto;

export type EmailDeliveryShape = {
  readonly send: (message: EmailMessage) => Effect.Effect<void, EmailDeliveryFailed>;
  readonly sendMany: (
    messages: ReadonlyArray<EmailMessage>,
  ) => Effect.Effect<ReadonlyArray<EmailDeliveryResult>>;
};

type EmailDeliveryResult =
  | { readonly _tag: "sent" }
  | { readonly _tag: "failed"; readonly reason: "rejected" | "unavailable" };

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly purpose: string;
  readonly idempotencyKey?: string;
};
