import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http/HttpClient";
import { NodeInspectSymbol } from "effect/Inspectable";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { Credentials } from "./credentials.ts";
import { invalidField } from "./decode.ts";
import {
  GatewayTimeout,
  Unauthorized,
  YahooCoverageMismatch,
  YahooParseError,
  YahooRequestInvalid,
  YahooWriteUnknown,
} from "./errors.ts";
import type { YahooReadError, YahooWriteError } from "./errors.ts";
import { Protocol } from "./protocol.ts";
import type { ProtocolShape, RequestSpec } from "./protocol.ts";
import { Retry, makeDefault } from "./retry.ts";

export type YahooOpContext = Credentials | HttpClient | Protocol;

export interface OperationConfig<I, O> {
  readonly name: string;
  readonly input: Schema.ConstraintCodec<I, unknown, never>;
  readonly output: Schema.Schema<unknown>;
  readonly request: (input: I) => RequestSpec;
  readonly decode: (
    payload: unknown,
    input: I,
  ) => Effect.Effect<O, YahooParseError | YahooCoverageMismatch | Unauthorized | YahooWriteUnknown>;
}

type OperationCall<I, O, E> = (input: I) => Effect.Effect<O, E, never>;

export type OperationMethod<I, O, E, R> = ((input: I) => Effect.Effect<O, E, R>) &
  Effect.Effect<OperationCall<I, O, E>, never, R>;

export function makeRead<I, O>(
  config: OperationConfig<I, O>,
): OperationMethod<I, O, YahooReadError, YahooOpContext> {
  return makeOperation<I, O, YahooReadError>(config, ({ input, spec, protocol }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient;
      const request = yield* protocol.encode({ request: spec, write: false });
      const response = yield* Effect.timeoutOrElse(client.execute(request), {
        duration: Duration.seconds(30),
        orElse: () =>
          Effect.fail(
            new GatewayTimeout({
              message: "Yahoo did not answer within 30 seconds.",
            }),
          ),
      });
      return yield* protocol.decode({
        operation: config.name,
        response,
        input,
        decode: config.decode,
        write: false,
      });
    }).pipe(withRetry),
  );
}

export function makeWrite<I, O>(
  config: OperationConfig<I, O>,
): OperationMethod<I, O, YahooWriteError, YahooOpContext> {
  return makeOperation<I, O, YahooWriteError>(config, ({ input, spec, protocol }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient;
      const request = yield* protocol.encode({ request: spec, write: true });
      const response = yield* Effect.timeoutOrElse(client.execute(request), {
        duration: Duration.seconds(30),
        orElse: () =>
          Effect.fail(
            new GatewayTimeout({
              message: "Yahoo did not answer within 30 seconds.",
            }),
          ),
      }).pipe(
        Effect.mapError(
          (error) =>
            new YahooWriteUnknown({
              operation: config.name,
              message: error.message,
            }),
        ),
      );
      return yield* protocol.decode({
        operation: config.name,
        response,
        input,
        decode: config.decode,
        write: true,
      });
    }),
  );
}

function makeOperation<I, O, E>(
  config: OperationConfig<I, O>,
  execute: (args: {
    readonly input: I;
    readonly spec: RequestSpec;
    readonly protocol: ProtocolShape;
  }) => Effect.Effect<O, E, YahooOpContext>,
): OperationMethod<I, O, E | YahooRequestInvalid, YahooOpContext> {
  const call = (raw: I): Effect.Effect<O, E | YahooRequestInvalid, YahooOpContext> =>
    Effect.gen(function* () {
      const input = yield* decodeInput(config.input, raw, config.name);
      const spec = config.request(input);
      const protocol = yield* Protocol;
      return yield* execute({ input, spec, protocol });
    });

  return makeOperationMethod(call);
}

export function makeCustom<I, O, E>(
  config: {
    readonly name: string;
    readonly input: Schema.ConstraintCodec<I, unknown, never>;
  },
  execute: (input: I) => Effect.Effect<O, E, YahooOpContext>,
): OperationMethod<I, O, E | YahooRequestInvalid, YahooOpContext> {
  return makeOperationMethod((raw: I) =>
    Effect.gen(function* () {
      const input = yield* decodeInput(config.input, raw, config.name);
      return yield* execute(input);
    }),
  );
}

function makeOperationMethod<I, O, E>(
  call: (input: I) => Effect.Effect<O, E, YahooOpContext>,
): OperationMethod<I, O, E, YahooOpContext> {
  const asEffect: Effect.Effect<OperationCall<I, O, E>, never, YahooOpContext> = Effect.map(
    Effect.context<YahooOpContext>(),
    (context) => {
      return (input: I) => Effect.provideContext(call(input), context);
    },
  );

  return Object.assign(call, {
    [Effect.TypeId]: asEffect[Effect.TypeId],
    [Symbol.iterator]: () => asEffect[Symbol.iterator](),
    pipe: asEffect.pipe.bind(asEffect),
    toString: () => asEffect.toString(),
    toJSON: () => asEffect.toJSON(),
    [NodeInspectSymbol]: () => asEffect[NodeInspectSymbol](),
  });
}

function decodeInput<I>(
  schema: Schema.ConstraintCodec<I, unknown, never>,
  input: I,
  operation: string,
): Effect.Effect<I, YahooRequestInvalid> {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.fail(
        new YahooRequestInvalid({
          operation,
          field: invalidField(error.issue),
        }),
      ),
    ),
  );
}

function withRetry<A>(
  effect: Effect.Effect<A, YahooReadError, YahooOpContext>,
): Effect.Effect<A, YahooReadError, YahooOpContext> {
  return Effect.gen(function* () {
    const option = yield* Effect.serviceOption(Retry);
    const policy = Option.isSome(option) ? option.value : makeDefault();
    const lastError = yield* Ref.make<unknown>(undefined);
    const options = typeof policy === "function" ? policy(lastError) : policy;
    if (options.while === undefined) {
      return yield* effect;
    }
    const decision = options.while;
    return yield* effect.pipe(
      Effect.tapError((error) => Ref.set(lastError, error)),
      Effect.retry({
        ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
        while: (error) => decision(error),
      }),
    );
  });
}
