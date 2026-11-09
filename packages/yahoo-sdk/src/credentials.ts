import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { ConfigError } from "./errors.ts";

export interface YahooSession {
  readonly cookie: Redacted.Redacted<string>;
}

const SessionCookie = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value: string) => value.trim().length > 0)),
  Schema.check(Schema.makeFilter((value: string) => !/[\r\n]/.test(value))),
);

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<YahooSession, ConfigError>
>()("YahooCredentials") {}

export const CredentialsFromSession = (session: YahooSession): Layer.Layer<Credentials> =>
  Layer.succeed(Credentials)(Effect.succeed(session));

export const CredentialsFromCookie = (cookie: string): Layer.Layer<Credentials> =>
  Layer.succeed(Credentials)(makeSession(cookie));

export const makeSession = (cookie: string): Effect.Effect<YahooSession, ConfigError> =>
  Effect.map(Schema.decodeUnknownEffect(SessionCookie)(cookie), (value) => ({
    cookie: Redacted.make(value),
  })).pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "The Yahoo session cookie is missing. Sign in through the hosted browser and supply the session cookie.",
        }),
    ),
  );
