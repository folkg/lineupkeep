import type { Stack } from "./lifecycle.ts";

export function testEnvironment(
  defaults: Readonly<Record<string, string | undefined>>,
  inherited: Readonly<Record<string, string | undefined>>,
  stack: Stack | undefined,
  target: "node" | "cloudflare" | "container",
): Record<string, string | undefined> {
  const environment: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "USER", "TMPDIR", "TMP", "TEMP", "SystemRoot", "CI"]) {
    const value = inherited[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return {
    ...environment,
    ...defaults,
    ...(stack === undefined
      ? {}
      : {
          DATABASE_URL: stack.database.href,
          BETTER_AUTH_URL: loopback(port(stack, "app")),
          FAKE_RESEND_PORT: String(port(stack, "email")),
          RESEND_API_BASE_URL: loopback(port(stack, "email")),
        }),
    APP_ENV: "test",
    E2E_TARGET: target,
  };
}

export function verificationEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  stack: Stack | undefined,
  target: "node" | "cloudflare" | "container",
  directory: string,
): Record<string, string | undefined> {
  return {
    ...base,
    VERIFICATION_DIR: directory,
    ...(stack === undefined
      ? {}
      : { OTEL_EXPORTER_OTLP_ENDPOINT: loopback(port(stack, "traces")) }),
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_BSP_SCHEDULE_DELAY: "100",
    ...(target === "node" && stack?.inspector !== undefined
      ? { VERIFICATION_NODE_INSPECTOR: `http://${new URL(stack.inspector).host}` }
      : {}),
  };
}

function port(stack: Stack, name: string): number {
  const value = stack.ports[name];
  if (value === undefined) {
    throw new Error(`The run was given no ${name} port.`);
  }
  return value;
}

function loopback(port: number): string {
  return `http://127.0.0.1:${port}`;
}
