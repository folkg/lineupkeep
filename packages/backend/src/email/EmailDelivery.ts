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
  "@sourdough/backend/email/EmailDelivery",
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
          const idempotencyKey = yield* crypto
            .randomUUIDv4()
            .pipe(Effect.mapError(() => EmailDeliveryFailed.make({ reason: "unavailable" })));
          const response = yield* HttpClientRequest.post("/emails").pipe(
            HttpClientRequest.setHeader("idempotency-key", idempotencyKey),
            HttpClientRequest.bodyJsonUnsafe({
              from: config.from,
              to: [message.to],
              subject: message.subject,
              text: message.text,
            }),
            client.execute,
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ResendEmailResponse)),
            Effect.mapError(classifyResendFailure),
          );
          yield* Effect.annotateCurrentSpan("email.provider_message_id", response.id);
        });

        return { send };
      }),
    );

  static readonly console: Layer.Layer<EmailDelivery> = Layer.succeed(EmailDelivery)({
    send: Effect.fn("email.send")(function* (message: EmailMessage) {
      yield* Effect.annotateCurrentSpan({
        "email.provider": "console",
        "email.purpose": message.purpose,
      });
      yield* Console.log(
        [`✉ To: ${message.to}`, `  Subject: ${message.subject}`, "", message.text].join("\n"),
      );
    }),
  });
}

export class EmailDeliveryFailed extends Schema.TaggedError<
  EmailDeliveryFailed,
  { readonly brand: unique symbol }
>()("EmailDeliveryFailed", {
  reason: Schema.Literals(["rejected", "unavailable"]),
}) {}

function classifyResendFailure(
  error: HttpClientError.HttpClientError | Schema.SchemaError,
): EmailDeliveryFailed {
  const status = error._tag === "HttpClientError" ? error.response?.status : undefined;
  const rejected = status !== undefined && status >= 400 && status < 500 && status !== 429;
  return EmailDeliveryFailed.make({ reason: rejected ? "rejected" : "unavailable" });
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
};

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;

  readonly purpose: string;
};
