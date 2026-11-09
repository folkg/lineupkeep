import { createServer } from "node:net";
import type { Server, Socket } from "node:net";

import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  Array,
  Clock,
  Config,
  ConfigProvider,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Schema,
} from "effect";
import type { Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock, TestConsole } from "effect/testing";
import { http, HttpResponse } from "msw/http";
import { setupServer } from "msw/node";

import { makeTelemetryTest } from "#runtime/internal/TelemetryTest.ts";

import { EmailDelivery, EmailDeliveryFailed } from "./EmailDelivery.ts";
import type { EmailMessage } from "./EmailDelivery.ts";

it.effect(
  "delivers through production Fetch with the configured authorization, sender, and replay key",
  () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
        Effect.sync(() => server[Symbol.dispose]()),
      );
      const requests: Array<RecordedRequest> = [];
      server.use(
        http.post(endpoint, async ({ request }) => {
          const body: unknown = await request.json();
          requests.push({ headers: request.headers, body });
          return HttpResponse.json({ id: "email-1" });
        }),
      );

      yield* send(signInMessage).pipe(Effect.provide(resendLayer));

      assert.strictEqual(requests.length, 1);
      assert.strictEqual(
        Array.getUnsafe(requests, 0).headers.get("authorization"),
        "Bearer re_test_key",
      );
      assert.match(
        Array.getUnsafe(requests, 0).headers.get("idempotency-key") ?? "",
        /^[0-9A-HJKMNP-TV-Z]{26}$/u,
      );
      assert.deepStrictEqual(Array.getUnsafe(requests, 0).body, {
        from: "Lineupgrade <sign-in@example.test>",
        to: ["reader@example.test"],
        subject: "Your Lineupgrade sign-in code",
        text: "Your code is 123456.",
      });
    }),
);

it.effect("reports provider rejection without retrying", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    let attempts = 0;
    server.use(
      http.post(endpoint, () => {
        attempts += 1;
        return HttpResponse.json({ message: "private-provider-error" }, { status: 422 });
      }),
    );

    const exit = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(resendLayer)));

    assert.strictEqual(failureReason(exit), "rejected");
    assert.strictEqual(attempts, 1);
  }),
);

it.effect("keeps the sender's own words when it refuses a recipient it may not reach", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            name: "validation_error",
            message:
              "You can only send testing emails to your own email address (owner@example.test). To send emails to other recipients, please verify a domain.",
          },
          { status: 403 },
        ),
      ),
    );

    const exit = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(resendLayer)));

    assert.strictEqual(failureReason(exit), "rejected");
    const failure = failureOf(exit);
    assert.isTrue(failure.recipientPolicy);
    assert.include(failure.detail ?? "", "only send testing emails to your own email address");
    assert.notInclude(failure.detail ?? "", "owner@example.test");
  }),
);

it.effect("keeps a rejection that is not about the recipient unmarked", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json({ message: "The recipient address is malformed." }, { status: 422 }),
      ),
    );

    const exit = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(resendLayer)));

    const failure = failureOf(exit);
    assert.strictEqual(failureReason(exit), "rejected");
    assert.isUndefined(failure.recipientPolicy);
    assert.strictEqual(failure.detail, "The recipient address is malformed.");
  }),
);

it.effect("retries transient failures with one stable key and succeeds", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    const keys: Array<string | null> = [];
    server.use(
      http.post(endpoint, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return keys.length === 1
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({ id: "email-retried" });
      }),
    );
    const retry = yield* retryClock;
    const delivery = yield* Effect.forkChild(
      send(signInMessage).pipe(Effect.provide(Layer.merge(resendLayer, retry.layer))),
    );

    yield* retry.advance;
    yield* Fiber.join(delivery);

    assert.strictEqual(keys.length, 2);
    assert.strictEqual(new Set(keys).size, 1);
    assert.match(keys[0] ?? "", /^[0-9A-HJKMNP-TV-Z]{26}$/u);
  }),
);

it.effect("exhausts retries and scrubs failed HTTP child exports", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    const keys: Array<string | null> = [];
    server.use(
      http.post(endpoint, ({ request }) => {
        keys.push(request.headers.get("idempotency-key"));
        return HttpResponse.json({ message: "private-provider-error" }, { status: 503 });
      }),
    );
    const telemetry = makeTelemetryTest();
    const retry = yield* retryClock;
    const delivery = yield* Effect.forkChild(
      send(signInMessage).pipe(
        Effect.provide(Layer.mergeAll(resendLayer, telemetry.layer, retry.layer)),
        Effect.exit,
      ),
    );

    yield* retry.advance;
    yield* retry.advance;
    const exit = yield* Fiber.join(delivery);
    const { payloads, spans } = telemetry.read();

    assert.strictEqual(failureReason(exit), "unavailable");
    assert.strictEqual(keys.length, 3);
    assert.strictEqual(new Set(keys).size, 1);
    assert.isTrue(spans.some((span) => span.parentSpanId !== undefined && span.status.code === 2));
    for (const privateValue of [
      "reader@example.test",
      "123456",
      "re_test_key",
      "private-provider-error",
    ]) {
      assert.notInclude(payloads.join(""), privateValue);
    }
  }),
);

it.effect("rejects malformed provider JSON and response shapes", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    server.use(
      http.post(
        endpoint,
        () => new HttpResponse("not-json", { headers: { "content-type": "application/json" } }),
      ),
    );
    const malformed = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(resendLayer)));
    server.use(http.post(endpoint, () => HttpResponse.json({ unexpected: true })));

    const wrongShape = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(resendLayer)));

    assert.strictEqual(failureReason(malformed), "unavailable");
    assert.strictEqual(failureReason(wrongShape), "unavailable");
  }),
);

it.effect("cancels a pending provider request with its delivery fiber", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    server.use(
      http.post(endpoint, ({ request }) => {
        request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        started.resolve();
        return aborted.promise.then(() => HttpResponse.error());
      }),
    );
    const delivery = yield* Effect.forkChild(send(signInMessage).pipe(Effect.provide(resendLayer)));
    yield* Effect.promise(() => started.promise);

    yield* Fiber.interrupt(delivery);
    yield* Effect.promise(() => aborted.promise);

    assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(delivery)));
  }),
);

it.effect("records delivery facts without the recipient, content, or key", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    server.use(http.post(endpoint, () => HttpResponse.json({ id: "email-1" })));
    const telemetry = makeTelemetryTest();

    yield* send(signInMessage).pipe(Effect.provide(Layer.merge(resendLayer, telemetry.layer)));
    const { payloads, spans } = telemetry.read();

    assert.isTrue(spans.some((span) => span.name === "email.send"));
    assert.include(payloads.join(""), "email.provider_message_id");
    for (const privateValue of ["reader@example.test", "123456", "re_test_key"]) {
      assert.notInclude(payloads.join(""), privateValue);
    }
  }),
);

it.effect("writes messages to the development console without a configured transport", () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    const layer = EmailDelivery.fromConfig.pipe(
      Layer.provide(configLayer({ APP_ENV: "development", EMAIL_SMTP_HOST: "" })),
      Layer.provide(transport),
    );

    yield* send(signInMessage).pipe(Effect.provide(layer));

    const lines = yield* TestConsole.logLines;
    assert.include(String(lines.at(-1)), "reader@example.test");
    assert.include(String(lines.at(-1)), "Your code is 123456.");
  }).pipe(Effect.provide(TestConsole.layer)),
);

it.effect("refuses production startup without any mail transport", () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    const layer = EmailDelivery.fromConfig.pipe(
      Layer.provide(configLayer({ APP_ENV: "production" })),
      Layer.provide(transport),
    );

    const exit = yield* Effect.exit(Effect.provide(EmailDelivery, layer));

    assert.isTrue(Exit.isFailure(exit));
    const cause = String(Exit.isFailure(exit) ? exit.cause : "");
    assert.include(cause, "EMAIL_SMTP_HOST");
    assert.include(cause, "RESEND_API_KEY");
  }),
);

it.effect("refuses a half-configured SMTP login", () =>
  Effect.gen(function* () {
    const layer = EmailDelivery.smtp.pipe(
      Layer.provide(
        configLayer({
          APP_ENV: "production",
          EMAIL_FROM: "Lineupgrade <sign-in@example.test>",
          EMAIL_SMTP_HOST: "smtp.example.test",
          EMAIL_SMTP_USER: "relay-user",
        }),
      ),
    );

    const exit = yield* Effect.exit(Effect.provide(EmailDelivery, layer));

    assert.isTrue(Exit.isFailure(exit));
    assert.include(
      String(Exit.isFailure(exit) ? exit.cause : ""),
      "EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD must be set together",
    );
  }),
);

it.effect(
  "delivers through an SMTP relay with the configured envelope, sender, subject and body",
  () =>
    Effect.gen(function* () {
      const sink = yield* startSmtpSink();

      yield* send({ ...signInMessage, idempotencyKey: "01K5SMTPSINK000000000000000" }).pipe(
        Effect.provide(smtpDelivery(sink.port)),
      );

      assert.strictEqual(sink.messages.length, 1);
      const message = Array.getUnsafe(sink.messages, 0);
      assert.strictEqual(message.from, "sign-in@example.test");
      assert.deepStrictEqual(message.recipients, ["reader@example.test"]);
      assert.include(message.data, "From: Lineupgrade <sign-in@example.test>");
      assert.include(message.data, "To: reader@example.test");
      assert.include(message.data, "Subject: Your Lineupgrade sign-in code");
      assert.include(message.data, "Your code is 123456.");
      assert.include(message.data, "Message-ID: <01K5SMTPSINK000000000000000@example.test>");
    }),
);

it.effect("reports an unreachable SMTP relay as unavailable", () =>
  Effect.gen(function* () {
    const sink = yield* startSmtpSink();
    const port = sink.port;
    yield* sink.close;

    const exit = yield* Effect.exit(send(signInMessage).pipe(Effect.provide(smtpDelivery(port))));

    assert.strictEqual(failureReason(exit), "unavailable");
  }),
);

it.effect("keeps the relay's own words when it refuses a recipient", () =>
  Effect.gen(function* () {
    const sink = yield* startSmtpSink({ refuseRecipients: ["refused@example.test"] });

    const exit = yield* Effect.exit(
      send({ ...signInMessage, to: "refused@example.test" }).pipe(
        Effect.provide(smtpDelivery(sink.port)),
      ),
    );

    assert.strictEqual(failureReason(exit), "rejected");
    const failure = failureOf(exit);
    assert.include(failure.detail ?? "", "550 5.1.1");
    assert.include(failure.detail ?? "", "recipient address rejected by the sink policy");
    assert.notInclude(failure.detail ?? "", "refused@example.test");
    assert.isUndefined(failure.recipientPolicy);
    assert.strictEqual(sink.messages.length, 0);
  }),
);

it.effect("requires STARTTLS by default", () =>
  Effect.gen(function* () {
    const sink = yield* startSmtpSink();

    const exit = yield* Effect.exit(
      send(signInMessage).pipe(
        Effect.provide(
          EmailDelivery.smtp.pipe(
            Layer.provide(
              configLayer({
                APP_ENV: "production",
                EMAIL_FROM: "Lineupgrade <sign-in@example.test>",
                EMAIL_SMTP_HOST: "127.0.0.1",
                EMAIL_SMTP_PORT: String(sink.port),
              }),
            ),
          ),
        ),
      ),
    );

    assert.strictEqual(failureReason(exit), "unavailable");
    assert.strictEqual(sink.messages.length, 0);
  }),
);

it.effect("prefers a configured SMTP relay over a Resend key", () =>
  Effect.gen(function* () {
    const sink = yield* startSmtpSink();
    const layer = EmailDelivery.fromConfig.pipe(
      Layer.provide(
        configLayer({
          APP_ENV: "production",
          EMAIL_FROM: "Lineupgrade <sign-in@example.test>",
          EMAIL_SMTP_HOST: "127.0.0.1",
          EMAIL_SMTP_PORT: String(sink.port),
          EMAIL_SMTP_TLS: "none",
          RESEND_API_KEY: "re_test_key",
          RESEND_API_BASE_URL: "http://127.0.0.1:1",
        }),
      ),
      Layer.provide(transport),
    );

    yield* send(signInMessage).pipe(Effect.provide(layer));

    assert.strictEqual(sink.messages.length, 1);
  }),
);

it.effect("selects Resend in production when a key is configured", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(Effect.sync(setupEmailTransport), (server) =>
      Effect.sync(() => server[Symbol.dispose]()),
    );
    let delivered = false;
    server.use(
      http.post(endpoint, () => {
        delivered = true;
        return HttpResponse.json({ id: "email-production" });
      }),
    );
    const layer = EmailDelivery.fromConfig.pipe(
      Layer.provide(configLayer({ ...resendConfig, APP_ENV: "production" })),
      Layer.provide(transport),
    );

    yield* send(signInMessage).pipe(Effect.provide(layer));

    assert.isTrue(delivered);
  }),
);

function startSmtpSink(options: SmtpSinkOptions = {}): Effect.Effect<SmtpSink, never, Scope.Scope> {
  return Effect.acquireRelease(listen(options), (sink) => sink.close);
}

function listen(options: SmtpSinkOptions): Effect.Effect<SmtpSink> {
  return Effect.callback<SmtpSink>((resume) => {
    const messages: SmtpSinkMessage[] = [];
    const sockets = new Set<Socket>();
    const refused = new Set((options.refuseRecipients ?? []).map(lowercase));
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      serve(socket, messages, refused);
    });
    server.once("error", (error) => resume(Effect.die(error)));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        resume(Effect.die(new Error("The SMTP sink did not bind a TCP address")));
        return;
      }
      resume(
        Effect.succeed({
          port: address.port,
          get messages() {
            return messages;
          },
          close: close(server, sockets),
        }),
      );
    });
    return Effect.sync(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
    });
  });
}

function serve(socket: Socket, messages: SmtpSinkMessage[], refused: ReadonlySet<string>): void {
  let buffered = "";
  let inData = false;
  let from = "";
  let recipients: string[] = [];
  let data: string[] = [];

  socket.setEncoding("utf8");
  socket.write("220 lineupkeep-smtp-sink ESMTP\r\n");
  socket.on("data", (chunk) => {
    buffered += chunk.toString();
    for (;;) {
      const end = buffered.indexOf("\r\n");
      if (end === -1) {
        return;
      }
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          messages.push({ from, recipients, data: data.join("\r\n") });
          from = "";
          recipients = [];
          data = [];
          socket.write("250 2.0.0 queued\r\n");
        } else {
          data.push(line.startsWith("..") ? line.slice(1) : line);
        }
        continue;
      }
      respond(line);
    }
  });

  function respond(line: string): void {
    switch (line.slice(0, 4).toUpperCase()) {
      case "EHLO":
      case "HELO":
        socket.write("250 lineupkeep-smtp-sink\r\n");
        return;
      case "MAIL":
        from = addressIn(line);
        socket.write("250 2.1.0 OK\r\n");
        return;
      case "RCPT": {
        const recipient = addressIn(line);
        if (refused.has(lowercase(recipient))) {
          socket.write(
            `550 5.1.1 <${recipient}>: recipient address rejected by the sink policy\r\n`,
          );
          return;
        }
        recipients.push(recipient);
        socket.write("250 2.1.5 OK\r\n");
        return;
      }
      case "DATA":
        if (from === "" || recipients.length === 0) {
          socket.write("503 5.5.1 Need MAIL and RCPT first\r\n");
          return;
        }
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        return;
      case "RSET":
        from = "";
        recipients = [];
        data = [];
        socket.write("250 2.0.0 OK\r\n");
        return;
      case "NOOP":
        socket.write("250 2.0.0 OK\r\n");
        return;
      case "QUIT":
        socket.end("221 2.0.0 Bye\r\n");
        return;
      default:
        socket.write("502 5.5.2 Command not recognized\r\n");
    }
  }
}

function close(server: Server, sockets: ReadonlySet<Socket>): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close(() => resume(Effect.void));
  });
}

function addressIn(line: string): string {
  return /<([^>]*)>/u.exec(line)?.[1] ?? "";
}

function lowercase(value: string): string {
  return value.toLowerCase();
}

function setupEmailTransport(): ReturnType<typeof setupServer> & Disposable {
  using resources = new DisposableStack();
  const server = setupServer();
  resources.defer(() => server.close());
  server.listen({ onUnhandledFrame: "error" });
  const ownership = resources.move();
  return Object.assign(server, { [Symbol.dispose]: () => ownership.dispose() });
}

function smtpDelivery(port: number): Layer.Layer<EmailDelivery, Config.ConfigError> {
  return EmailDelivery.smtp.pipe(
    Layer.provide(
      configLayer({
        APP_ENV: "production",
        EMAIL_FROM: "Lineupgrade <sign-in@example.test>",
        EMAIL_SMTP_HOST: "127.0.0.1",
        EMAIL_SMTP_PORT: String(port),
        EMAIL_SMTP_TLS: "none",
      }),
    ),
  );
}

function send(message: EmailMessage): Effect.Effect<void, EmailDeliveryFailed, EmailDelivery> {
  return EmailDelivery.use((delivery) => delivery.send(message));
}

function configLayer(config: Record<string, string>): Layer.Layer<never, never, never> {
  return ConfigProvider.layer(ConfigProvider.fromUnknown(config));
}

function failureReason(exit: Exit.Exit<unknown, unknown>): string | undefined {
  const failure = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined;
  return failure?._tag === "Fail" && Schema.is(EmailDeliveryFailed)(failure.error)
    ? failure.error.reason
    : undefined;
}

function failureOf(exit: Exit.Exit<unknown, unknown>): EmailDeliveryFailed {
  const failure = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined;
  if (failure?._tag !== "Fail" || !Schema.is(EmailDeliveryFailed)(failure.error)) {
    throw new Error("expected the email delivery to fail");
  }
  return failure.error;
}

const retryClock = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const waiting = yield* Queue.unbounded<void>();
  return {
    layer: Layer.succeed(Clock.Clock)({
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) =>
        Queue.offer(waiting, undefined).pipe(Effect.andThen(clock.sleep(duration))),
    }),
    advance: Queue.take(waiting).pipe(Effect.andThen(TestClock.adjust("1 second"))),
  };
});
const endpoint = "https://resend.test/emails";
const signInMessage = {
  to: "reader@example.test",
  subject: "Your Lineupgrade sign-in code",
  text: "Your code is 123456.",
  purpose: "auth.sign_in_code",
};
const resendConfig = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Lineupgrade <sign-in@example.test>",
  RESEND_API_BASE_URL: "https://resend.test",
};
const transport = Layer.merge(FetchHttpClient.layer, NodeCrypto.layer);
const resendLayer = EmailDelivery.resend.pipe(
  Layer.provide(configLayer({ ...resendConfig, APP_ENV: "test" })),
  Layer.provide(transport),
);

type RecordedRequest = { readonly headers: Headers; readonly body: unknown };

type SmtpSinkOptions = {
  readonly refuseRecipients?: ReadonlyArray<string>;
};

type SmtpSink = {
  readonly port: number;
  readonly messages: ReadonlyArray<SmtpSinkMessage>;
  readonly close: Effect.Effect<void>;
};

type SmtpSinkMessage = {
  readonly from: string;
  readonly recipients: ReadonlyArray<string>;
  readonly data: string;
};
