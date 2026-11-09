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
import nodemailer from "nodemailer";

import { appEnvironmentConfig } from "#config/AppEnvironment.ts";

export class EmailDelivery extends Context.Service<EmailDelivery, EmailDeliveryShape>()(
  "@lineupkeep/backend/email/EmailDelivery",
) {
  static readonly fromConfig: Layer.Layer<EmailDelivery, Config.ConfigError, EmailTransport> =
    Layer.unwrap(
      Effect.gen(function* () {
        const environment = yield* appEnvironmentConfig;
        const smtpHost = yield* configuredText("EMAIL_SMTP_HOST");
        if (Option.isSome(smtpHost)) {
          return EmailDelivery.smtp;
        }
        const apiKey = yield* configuredSecret("RESEND_API_KEY");
        if (Option.isSome(apiKey)) {
          return EmailDelivery.resend;
        }
        if (environment === "production") {
          return yield* Effect.fail(
            configError(
              "EMAIL_SMTP_HOST or RESEND_API_KEY is required in production to deliver email",
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
            (yield* crypto.randomULID.pipe(
              Effect.mapError(() => EmailDeliveryFailed.make({ reason: "unavailable" })),
            ));
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

        return { send, sendMany: sendManyOf(send) };
      }),
    );

  static readonly smtp: Layer.Layer<EmailDelivery, Config.ConfigError> = Layer.effect(
    EmailDelivery,
    Effect.gen(function* () {
      const config = yield* smtpSettings;
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.tls === "implicit",
        requireTLS: config.tls === "starttls",
        ignoreTLS: config.tls === "none",
        ...(Option.isSome(config.auth)
          ? {
              auth: {
                user: config.auth.value.user,
                pass: Redacted.value(config.auth.value.password),
              },
            }
          : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });

      const send = Effect.fn("email.send")(function* (message: EmailMessage) {
        yield* Effect.annotateCurrentSpan({
          "email.provider": "smtp",
          "email.purpose": message.purpose,
        });
        const sent = yield* Effect.tryPromise({
          try: () =>
            transport.sendMail({
              from: config.from,
              to: message.to,
              subject: message.subject,
              text: message.text,
              ...(message.idempotencyKey === undefined
                ? {}
                : { messageId: smtpMessageId(message.idempotencyKey, config.from) }),
            }),
          catch: smtpFailure,
        });
        yield* Effect.annotateCurrentSpan("email.provider_message_id", sent.messageId);
      });

      return { send, sendMany: sendManyOf(send) };
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
      return { send, sendMany: sendManyOf(send) };
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

function sendManyOf(
  send: (message: EmailMessage) => Effect.Effect<void, EmailDeliveryFailed>,
): (messages: ReadonlyArray<EmailMessage>) => Effect.Effect<ReadonlyArray<EmailDeliveryResult>> {
  return (messages) =>
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
}

const SmtpError = Schema.Struct({
  code: Schema.optional(Schema.String),
  responseCode: Schema.optional(Schema.Finite),
  response: Schema.optional(Schema.String),
});

function smtpFailure(error: unknown): EmailDeliveryFailed {
  const reply = Schema.decodeUnknownOption(SmtpError)(error);
  if (Option.isNone(reply)) {
    return EmailDeliveryFailed.make({ reason: "unavailable" });
  }
  const { code, response, responseCode } = reply.value;
  const rejected =
    (code === "EENVELOPE" || code === "EMESSAGE") &&
    responseCode !== undefined &&
    responseCode >= 500 &&
    responseCode < 600;
  const detail = providerDetail(response);
  return EmailDeliveryFailed.make({
    reason: rejected ? "rejected" : "unavailable",
    ...(detail === undefined ? {} : { detail }),
  });
}

function smtpMessageId(idempotencyKey: string, from: string): string {
  const sender = /<([^<>]+)>/u.exec(from)?.[1] ?? from;
  const domain = sender.slice(sender.lastIndexOf("@") + 1);
  return `<${idempotencyKey}@${domain}>`;
}

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

const smtpSettings: Effect.Effect<SmtpSettings, Config.ConfigError> = Effect.gen(function* () {
  const host = yield* Config.String("EMAIL_SMTP_HOST");
  const port = yield* Config.Int("EMAIL_SMTP_PORT").pipe(Config.withDefault(587));
  const tls = yield* Config.Literals(["starttls", "implicit", "none"], "EMAIL_SMTP_TLS").pipe(
    Config.withDefault("starttls"),
  );
  const user = yield* configuredText("EMAIL_SMTP_USER");
  const password = yield* configuredSecret("EMAIL_SMTP_PASSWORD");
  const from = yield* Config.String("EMAIL_FROM");
  if (Option.isSome(user) !== Option.isSome(password)) {
    return yield* Effect.fail(
      configError("EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be set together"),
    );
  }
  return {
    host,
    port,
    tls,
    from,
    auth:
      Option.isSome(user) && Option.isSome(password)
        ? Option.some({ user: user.value, password: password.value })
        : Option.none(),
  };
});

function configuredText(name: string): Config.Config<Option.Option<string>> {
  return Config.option(Config.String(name)).pipe(
    Config.map(Option.filter((value) => value !== "")),
  );
}

function configuredSecret(name: string): Config.Config<Option.Option<Redacted.Redacted<string>>> {
  return Config.option(Config.Redacted(name)).pipe(
    Config.map(Option.filter((value) => Redacted.value(value) !== "")),
  );
}

function configError(message: string): Config.ConfigError {
  return new Config.ConfigError(new ConfigProvider.SourceError({ message }));
}

const ResendEmailResponse = Schema.Struct({ id: Schema.String });

export type EmailTransport = HttpClient.HttpClient | Crypto.Crypto;

type SmtpSettings = {
  readonly host: string;
  readonly port: number;
  readonly tls: "starttls" | "implicit" | "none";
  readonly auth: Option.Option<{
    readonly user: string;
    readonly password: Redacted.Redacted<string>;
  }>;
  readonly from: string;
};

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
