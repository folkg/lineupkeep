import { expect, it } from "vitest";

import { testEnvironment, verificationEnvironment } from "#e2e/verify/environment.ts";

it("isolates test runs from inherited application credentials and fixed addresses", () => {
  const defaults = { RESEND_API_KEY: "fake-email-key", APP_ENV: "test" };
  const inherited = {
    PATH: "/usr/bin",
    DATABASE_URL: "postgres://production:secret@remote.invalid/live",
    RESEND_API_KEY: "real-email-key",
    GOOGLE_CLIENT_ID: "real-google-client",
    GOOGLE_CLIENT_SECRET: "real-google-secret",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://remote.invalid",
  };
  const stack = {
    database: new URL("postgres://lineupkeep:local@127.0.0.1:49001/lineupkeep_test"),
    ports: { app: 21001, email: 21002, traces: 21003 },
    inspector: "ws://127.0.0.1:21004/owned-inspector",
  };

  const environment = verificationEnvironment(
    testEnvironment(defaults, inherited, stack, "node"),
    stack,
    "node",
    "/proof",
  );

  expect(environment["DATABASE_URL"]).toBe(
    "postgres://lineupkeep:local@127.0.0.1:49001/lineupkeep_test",
  );
  expect(environment["BETTER_AUTH_URL"]).toBe("http://127.0.0.1:21001");
  expect(environment["RESEND_API_BASE_URL"]).toBe("http://127.0.0.1:21002");
  expect(environment["FAKE_RESEND_PORT"]).toBe("21002");
  expect(environment["RESEND_API_KEY"]).toBe("fake-email-key");
  expect(environment["PATH"]).toBe("/usr/bin");
  expect(environment["GOOGLE_CLIENT_ID"]).toBeUndefined();
  expect(environment["GOOGLE_CLIENT_SECRET"]).toBeUndefined();
  expect(environment["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe("http://127.0.0.1:21003");
  expect(environment["VERIFICATION_NODE_INSPECTOR"]).toBe("http://127.0.0.1:21004");
  expect(environment["VERIFICATION_DIR"]).toBe("/proof");
});

it("leaves resource addresses absent until Alchemy reports ready endpoints", () => {
  const defaults = { RESEND_API_KEY: "fake-email-key", APP_ENV: "test" };

  const environment = verificationEnvironment(
    testEnvironment(defaults, { PATH: "/usr/bin" }, undefined, "node"),
    undefined,
    "node",
    "/proof",
  );

  expect(environment["RESEND_API_KEY"]).toBe("fake-email-key");
  expect(environment["VERIFICATION_DIR"]).toBe("/proof");
  for (const name of [
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "RESEND_API_BASE_URL",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "VERIFICATION_NODE_INSPECTOR",
  ]) {
    expect(environment[name]).toBeUndefined();
  }
});
