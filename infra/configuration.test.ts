import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Layer, Redacted, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability";
import { expect } from "vitest";

import { applicationConfig, developmentApplicationConfig } from "./config.ts";
import { externalDatabase } from "./database/external.ts";
import {
  cloudRunContainer,
  hostedBrowserContainer,
  hostedBrowserTemplate,
  partitionEnvironment,
  webContainer,
} from "./hosts/cloudRun.ts";
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
  const network = containerRelayNetwork("darwin", ["172.17.0.1"], []);

  expect(network).toEqual({ bind: "127.0.0.1", host: "host-gateway" });
});

it("binds a Linux container relay to the owned IPv4 bridge gateway", () => {
  const network = containerRelayNetwork("linux", ["::", "0.0.0.0", "172.17.0.1"], ["172.17.0.1"]);

  expect(network).toEqual({ bind: "172.17.0.1", host: "host-gateway" });
});

it("rejects a Linux bridge gateway the host cannot bind", () => {
  expect(() => containerRelayNetwork("linux", ["10.89.0.2"], ["10.89.0.1"])).toThrow(
    "inspected bridge gateways: 10.89.0.2; addresses the host could bind: 10.89.0.1",
  );
});

it.each([
  { gateways: [], inspected: "none" },
  { gateways: ["0.0.0.0"], inspected: "0.0.0.0" },
  { gateways: ["::"], inspected: "::" },
  { gateways: ["not-an-address"], inspected: "not-an-address" },
])(
  "rejects an unavailable or wildcard Linux bridge gateway: $gateways",
  ({ gateways, inspected }) => {
    expect(() => containerRelayNetwork("linux", gateways, ["0.0.0.0", "::", "10.89.0.1"])).toThrow(
      `inspected bridge gateways: ${inspected}`,
    );
  },
);

it("keeps Cloud Run request-billed with CPU allocated only during requests", () => {
  const container = cloudRunContainer();

  expect(container.resources.cpuIdle).toBe(true);
});

it("probes the web service every second so readiness is not delayed by a probe cycle", () => {
  expect(webContainer().startupProbe).toEqual({
    httpGet: { path: "/", port: 8080 },
    periodSeconds: 1,
    failureThreshold: 60,
  });
  expect(cloudRunContainer().startupProbe.periodSeconds).toBe(5);
});

it("runs one hosted browser per instance inside Cloud Run IAM", () => {
  const template = hostedBrowserTemplate();

  expect(template.maxInstanceRequestConcurrency).toBe(1);
  expect(template.scaling).toEqual({ minInstanceCount: 0, maxInstanceCount: 2 });
  expect(template.timeout).toBe("780s");
});

it("sizes the hosted browser container for Chromium behind a readiness probe", () => {
  const container = hostedBrowserContainer();

  expect(container.resources).toEqual({
    limits: { cpu: "1", memory: "2Gi" },
    cpuIdle: true,
    startupCpuBoost: true,
  });
  expect(container.startupProbe.httpGet.path).toBe("/healthz");
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
            CONNECTION_ENCRYPTION_KEY: "private-connection-encryption-key",
            CONNECTION_ENCRYPTION_RETAINED_KEYS: "1:private-retained-connection-key",
            RESEND_API_KEY: "private-email-secret",
            EMAIL_FROM: "Lineupkeep <lineupkeep@example.com>",
            EMAIL_SMTP_PASSWORD: "private-smtp-secret",
            AUTH_CLIENT_IP_HEADERS: "cf-connecting-ip",
            CLOUDFLARE_API_TOKEN: "must-not-cross",
          }),
        ),
      ),

      Effect.map((config) => {
        expect(Redacted.isRedacted(config["BETTER_AUTH_SECRET"])).toBe(true);
        expect(Redacted.isRedacted(config["RESEND_API_KEY"])).toBe(true);
        expect(Redacted.isRedacted(config["EMAIL_SMTP_PASSWORD"])).toBe(true);
        expect(Redacted.isRedacted(config["CONNECTION_ENCRYPTION_KEY"])).toBe(true);
        expect(Redacted.isRedacted(config["CONNECTION_ENCRYPTION_RETAINED_KEYS"])).toBe(true);
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
            CONNECTION_ENCRYPTION_KEY: "private-connection-encryption-key",
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
          CONNECTION_ENCRYPTION_KEY: "private-connection-encryption-key",
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
      expect(Redacted.isRedacted(config["CONNECTION_ENCRYPTION_KEY"])).toBe(true);
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

it.effect("forwards SMTP relay settings with the password redacted", () =>
  applicationConfig.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BETTER_AUTH_URL: "https://app.example.com",
          BETTER_AUTH_SECRET: "private-auth-secret",
          CONNECTION_ENCRYPTION_KEY: "private-connection-encryption-key",
          EMAIL_FROM: "Lineupkeep <lineupkeep@example.com>",
          AUTH_CLIENT_IP_HEADERS: "cf-connecting-ip",
          EMAIL_SMTP_HOST: "smtp.gmail.com",
          EMAIL_SMTP_PORT: "587",
          EMAIL_SMTP_TLS: "starttls",
          EMAIL_SMTP_USER: "owner@example.com",
          EMAIL_SMTP_PASSWORD: "private-smtp-secret",
        }),
      ),
    ),

    Effect.map((config) => {
      expect(config["EMAIL_SMTP_HOST"]).toBe("smtp.gmail.com");
      expect(config["EMAIL_SMTP_USER"]).toBe("owner@example.com");
      expect(Redacted.isRedacted(config["EMAIL_SMTP_PASSWORD"])).toBe(true);
      expect(config).not.toHaveProperty("RESEND_API_KEY");
    }),
  ),
);
