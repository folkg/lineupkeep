import { Config, Effect, Option } from "effect";
import type { Redacted } from "effect";

const settings: Readonly<Record<string, ApplicationSetting>> = {
  BETTER_AUTH_URL: {
    config: Config.String("BETTER_AUTH_URL"),
    production: "required",
    development: false,
  },
  BETTER_AUTH_SECRET: {
    config: Config.Redacted("BETTER_AUTH_SECRET"),
    production: "required",
    development: true,
  },
  EMAIL_FROM: { config: Config.String("EMAIL_FROM"), production: "required", development: true },
  RESEND_API_KEY: {
    config: Config.Redacted("RESEND_API_KEY"),
    production: "required",
    development: true,
  },
  AUTH_CLIENT_IP_HEADERS: {
    config: Config.String("AUTH_CLIENT_IP_HEADERS"),
    production: "required",
    development: false,
  },
  RESEND_API_BASE_URL: {
    config: Config.String("RESEND_API_BASE_URL"),
    production: "optional",
    development: true,
  },
  GOOGLE_CLIENT_ID: {
    config: Config.String("GOOGLE_CLIENT_ID"),
    production: "optional",
    development: true,
  },
  GOOGLE_CLIENT_SECRET: {
    config: Config.Redacted("GOOGLE_CLIENT_SECRET"),
    production: "optional",
    development: true,
  },
  AUTH_TRUSTED_PROXIES: {
    config: Config.String("AUTH_TRUSTED_PROXIES"),
    production: "optional",
    development: false,
  },
  OTEL_TRACES_EXPORTER: {
    config: Config.String("OTEL_TRACES_EXPORTER"),
    production: "optional",
    development: true,
  },
  OTEL_EXPORTER_OTLP_ENDPOINT: {
    config: Config.String("OTEL_EXPORTER_OTLP_ENDPOINT"),
    production: "optional",
    development: true,
  },
  OTEL_EXPORTER_OTLP_HEADERS: {
    config: Config.Redacted("OTEL_EXPORTER_OTLP_HEADERS"),
    production: "optional",
    development: true,
  },
  OTEL_SERVICE_NAME: {
    config: Config.String("OTEL_SERVICE_NAME"),
    production: "optional",
    development: true,
  },
  SERVICE_VERSION: {
    config: Config.String("SERVICE_VERSION"),
    production: "optional",
    development: true,
  },
  DEV_SLOW_SPAN_THRESHOLD: {
    config: Config.String("DEV_SLOW_SPAN_THRESHOLD"),
    production: false,
    development: true,
  },
};

export const applicationConfig = readSettings("production").pipe(
  Effect.map((values): Readonly<Record<string, ConfigurationValue>> => ({
    ...values,
    APP_ENV: "production",
  })),
);

export const developmentApplicationConfig = readSettings("development");

export function developmentEnvironmentNames(): ReadonlyArray<string> {
  return selectedSettings("development").map(([name]) => name);
}

function readSettings(selection: ConfigurationSelection): Effect.Effect<
  {
    [k: string]: ConfigurationValue;
  },
  Config.ConfigError,
  never
> {
  return Config.all(
    Object.fromEntries(
      selectedSettings(selection).map(([name, setting]) => [
        name,
        selection === "production" && setting.production === "required"
          ? setting.config.pipe(Config.map(Option.some))
          : Config.option(setting.config),
      ]),
    ),
  ).pipe(Effect.map(definedOptions));
}

function selectedSettings(selection: ConfigurationSelection): [string, ApplicationSetting][] {
  return Object.entries(settings).filter(([, setting]) =>
    selection === "production" ? setting.production !== false : setting.development,
  );
}

function definedOptions(values: Readonly<Record<string, Option.Option<ConfigurationValue>>>): {
  [k: string]: ConfigurationValue;
} {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      Option.isSome(value) ? [[key, value.value]] : [],
    ),
  );
}

type ConfigurationSelection = "production" | "development";

type ApplicationSetting = {
  readonly config: Config.Config<ConfigurationValue>;
  readonly production: "required" | "optional" | false;
  readonly development: boolean;
};

type ConfigurationValue = string | Redacted.Redacted<string>;
