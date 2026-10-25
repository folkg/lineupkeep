import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Layer, Redacted, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";
import { expect } from "vitest";

import { applicationConfig, developmentApplicationConfig } from "./config.ts";
import { externalDatabase } from "./database/external.ts";
import { cloudRunContainer, partitionEnvironment } from "./hosts/cloudRun.ts";
import { containerRelayNetwork } from "./hosts/localContainer.ts";
import { DatabaseDeployment } from "./services/DatabaseDeployment.ts";
import { assertLocalStage, stageSpec } from "./stage.ts";

it("selects build/runtime semantics once per named stage", () => {
  expect(stageSpec("production")).toEqual({
    name: "production",
    host: "cloudflare",
    database: "neon",
  });
  expect(stageSpec("cloud-run").host).toBe("cloud-run");
  expect(stageSpec("local").database).toBe("local");
  expect(stageSpec("local-container")).toEqual({
    name: "local-container",
    host: "container",
    database: "local",
  });
  expect(() => assertLocalStage(stageSpec("local-container"), true)).not.toThrow();
  expect(stageSpec("local-external-db")).toEqual({
    name: "local-external-db",
    host: "local",
    database: "external",
  });
  expect(() => assertLocalStage(stageSpec("local-external-db"), true)).not.toThrow();
  expect(() => stageSpec("external")).toThrow("Unknown stage");
  expect(() => stageSpec("typo")).toThrow("Unknown stage");
  expect(() => assertLocalStage(stageSpec("production"), true)).toThrow("Local mode");
  expect(() => assertLocalStage(stageSpec("cloud-run"), true)).toThrow("Local mode");
  expect(() => assertLocalStage(stageSpec("local-cloudflare"), true)).not.toThrow();
});

it("binds macOS container relays only to loopback through Docker Desktop", () => {
  const network = containerRelayNetwork("darwin", ["10.89.0.1"], ["127.0.0.1"]);

  expect(network).toEqual({ bind: "127.0.0.1", host: "host-gateway" });
});

it("binds Linux container relays to the inspected bridge gateway on this host", () => {
  const network = containerRelayNetwork("linux", ["10.89.0.1"], ["127.0.0.1", "10.89.0.1"]);

  expect(network).toEqual({ bind: "10.89.0.1", host: "10.89.0.1" });
});

it.each([
  { gateways: [] },
  { gateways: ["0.0.0.0"] },
  { gateways: ["::"] },
  { gateways: ["not-an-address"] },
  { gateways: ["10.89.0.2"] },
])("rejects an unavailable or wildcard Linux bridge gateway: $gateways", ({ gateways }) => {
  expect(() => containerRelayNetwork("linux", gateways, ["0.0.0.0", "::", "10.89.0.1"])).toThrow(
    "safe Docker bridge relay address",
  );
});

it("keeps Cloud Run request-billed with CPU allocated only during requests", () => {
  const container = cloudRunContainer();

  expect(container.resources.cpuIdle).toBe(true);
});

it("routes plain configuration to environment entries and secrets to Secret Manager", () => {
  const environment = partitionEnvironment({
    BETTER_AUTH_URL: "https://app.example.com",
    BETTER_AUTH_SECRET: Redacted.make("private-auth-secret"),
  });

  expect(environment.plain).toEqual([["BETTER_AUTH_URL", "https://app.example.com"]]);
  expect(environment.secrets.map(([name]) => name)).toEqual(["BETTER_AUTH_SECRET"]);
  expect(Redacted.isRedacted(environment.secrets[0]?.[1])).toBe(true);
});

it.effect("requires a separate direct URL for externally managed databases", () =>
  DatabaseDeployment.pipe(
    Effect.provide(externalDatabase),
    Effect.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: "postgres://pooled" })),
    ),
    Effect.exit,

    Effect.map((exit) => expect(Exit.isFailure(exit)).toBe(true)),
  ),
);

it.effect(
  "keeps application secrets redacted and excludes undeclared provisioning credentials",
  () =>
    applicationConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_URL: "https://app.example.com",
            BETTER_AUTH_SECRET: "private-auth-secret",
            RESEND_API_KEY: "private-email-secret",
            EMAIL_FROM: "Lineupkeep <lineupkeep@example.com>",
            AUTH_CLIENT_IP_HEADERS: "cf-connecting-ip",
            CLOUDFLARE_API_TOKEN: "must-not-cross",
          }),
        ),
      ),

      Effect.map((config) => {
        expect(Redacted.isRedacted(config["BETTER_AUTH_SECRET"])).toBe(true);
        expect(Redacted.isRedacted(config["RESEND_API_KEY"])).toBe(true);
        expect(config).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
      }),
    ),
);

it.effect("exports traces using the forwarded production configuration", () =>
  Effect.gen(function* () {
    const config = yield* applicationConfig.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_URL: "https://app.example.com",
            BETTER_AUTH_SECRET: "private-auth-secret",
            RESEND_API_KEY: "private-email-secret",
            EMAIL_FROM: "Lineupkeep <lineupkeep@example.com>",
            AUTH_CLIENT_IP_HEADERS: "cf-connecting-ip",
            OTEL_TRACES_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
            OTEL_EXPORTER_OTLP_HEADERS: "authorization=private-exporter-secret",
          }),
        ),
      ),
    );
    const environment = Object.fromEntries(
      Object.entries(config).map(([name, value]) => [
        name,
        Redacted.isRedacted(value) ? Redacted.value(value) : value,
      ]),
    );
    const exports = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const collector = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        expect(url.href).toBe("https://collector.example.com/v1/traces");
        expect(request.headers["authorization"]).toBe("private-exporter-secret");
        expect(request.body._tag).toBe("Uint8Array");
        if (request.body._tag === "Uint8Array") {
          const payload = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(
            new TextDecoder().decode(request.body.body),
          );
          yield* Ref.update(exports, (payloads) => [...payloads, payload]);
        }
        return HttpClientResponse.fromWeb(request, new Response("{}"));
      }),
    );
    const tracing = OtlpTracer.layerFromConfig({
      resource: { serviceName: "lineupkeep-web", serviceVersion: "test" },
    }).pipe(
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(Layer.succeed(HttpClient.HttpClient)(collector)),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment))),
    );

    yield* Effect.gen(function* () {
      yield* Effect.void.pipe(Effect.withSpan("production.configuration.probe"));
      yield* (yield* OtlpExporter.Flusher).flush;
    }).pipe(Effect.provide(tracing));

    expect(yield* Ref.get(exports)).toEqual([
      expect.objectContaining({
        resourceSpans: [
          expect.objectContaining({
            scopeSpans: [
              expect.objectContaining({
                spans: [expect.objectContaining({ name: "production.configuration.probe" })],
              }),
            ],
          }),
        ],
      }),
    ]);
  }),
);

it.effect("selects optional development settings with explicitly redacted secrets", () =>
  developmentApplicationConfig.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BETTER_AUTH_SECRET: "private-auth-secret",
          GOOGLE_CLIENT_ID: "public-google-client",
          GOOGLE_CLIENT_SECRET: "private-google-secret",
          OTEL_EXPORTER_OTLP_HEADERS: "authorization=private-exporter-secret",
          OTEL_TRACES_EXPORTER: "otlp",
          DEV_SLOW_SPAN_THRESHOLD: "100 millis",
          BETTER_AUTH_URL: "https://must-not-select.example.com",
          AUTH_CLIENT_IP_HEADERS: "must-not-select",
          CLOUDFLARE_API_TOKEN: "must-not-cross",
        }),
      ),
    ),

    Effect.map((config) => {
      expect(Redacted.isRedacted(config["BETTER_AUTH_SECRET"])).toBe(true);
      expect(Redacted.isRedacted(config["GOOGLE_CLIENT_SECRET"])).toBe(true);
      expect(Redacted.isRedacted(config["OTEL_EXPORTER_OTLP_HEADERS"])).toBe(true);
      expect(config["GOOGLE_CLIENT_ID"]).toBe("public-google-client");
      expect(config["OTEL_TRACES_EXPORTER"]).toBe("otlp");
      expect(config["DEV_SLOW_SPAN_THRESHOLD"]).toBe("100 millis");
      expect(config).not.toHaveProperty("RESEND_API_KEY");
      expect(config).not.toHaveProperty("BETTER_AUTH_URL");
      expect(config).not.toHaveProperty("AUTH_CLIENT_IP_HEADERS");
      expect(config).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    }),
  ),
);

it.effect("requires production email configuration even when development needs none", () =>
  applicationConfig.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BETTER_AUTH_URL: "https://app.example.com",
          BETTER_AUTH_SECRET: "private-auth-secret",
          EMAIL_FROM: "Lineupkeep <lineupkeep@example.com>",
          AUTH_CLIENT_IP_HEADERS: "cf-connecting-ip",
        }),
      ),
    ),
    Effect.exit,

    Effect.map((exit) => expect(Exit.isFailure(exit)).toBe(true)),
  ),
);
