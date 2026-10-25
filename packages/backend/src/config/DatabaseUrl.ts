import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const DatabaseUrl = Schema.URLFromString.pipe(
  Schema.check(
    Schema.makeFilter(
      (url: URL) =>
        url.protocol === "postgres:" ||
        url.protocol === "postgresql:" ||
        "DATABASE_URL must use PostgreSQL",
    ),
  ),
  Schema.brand("DatabaseUrl"),
);

export const databaseUrlConfig = Config.Redacted("DATABASE_URL").pipe(
  Config.mapEffect((value) => decodeDatabaseUrl(Redacted.value(value))),
);

export function decodeDatabaseUrl(
  value: string,
): Effect.Effect<Redacted.Redacted<string>, Config.ConfigError> {
  return Schema.decodeEffect(DatabaseUrl)(value).pipe(
    Effect.map((url) => Redacted.make(url.href)),
    Effect.mapError((error) => new Config.ConfigError(error)),
  );
}
