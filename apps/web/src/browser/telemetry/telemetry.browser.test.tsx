import { render } from "@solidjs/web";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { Errored, OBSERVE, createSignal, flush } from "solid-js";
import { attribution } from "solid-js/attribution";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { TelemetryReportData } from "#contracts/telemetry/telemetryContract.ts";

import { installClientTelemetry } from "./telemetry";

it("collects private-safe reactive records without verbose console logs", async () => {
  using fixture = setup();

  await page.getByRole("button", { name: "Private draft before", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Private draft after" })).toBeVisible();

  expect(fixture.records.length).toBeGreaterThan(0);
  expect(JSON.stringify([...fixture.records, ...fixture.events])).not.toContain("Private draft");
  expect(fixture.consoleOutput.filter((line) => line.includes("[why-run]"))).toEqual([]);

  fixture.telemetry[Symbol.dispose]();
  await page.getByRole("button", { name: "Private draft after", exact: true }).click();

  await expect
    .poll(() => JSON.stringify([...fixture.records, ...fixture.events]))
    .toContain("Private draft");
});

it("stops reporting real calls and interactions after disposal without retaining old subscriptions", async () => {
  using first = setup();

  await page.getByRole("button", { name: "Private draft before", exact: true }).click();
  await first.call();

  await expect
    .poll(() => first.reports.map((report) => report.kind).sort())
    .toEqual(["slow_call", "slow_interaction"]);
  first.telemetry[Symbol.dispose]();
  const reported = [...first.reports];
  const observed = first.events.length;

  await page.getByRole("button", { name: "Private draft after", exact: true }).click();
  await first.call();

  await expect.poll(() => first.events.length).toBeGreaterThan(observed + 1);
  expect(first.reports).toEqual(reported);
  first[Symbol.dispose]();
  const records = [...first.records];

  using later = setup();
  await page.getByRole("button", { name: "Private draft before", exact: true }).click();
  await later.call();

  await expect
    .poll(() => later.reports.map((report) => report.kind).sort())
    .toEqual(["slow_call", "slow_interaction"]);
  expect(first.reports).toEqual(reported);
  expect(first.records).toEqual(records);
});

it("clears its exclusive client error registration when disposed", () => {
  using first = setup();
  first.fail();

  expect(first.reports.map((report) => report.kind)).toEqual(["client_error"]);
  first.telemetry[Symbol.dispose]();
  first.fail();

  expect(first.reports.map((report) => report.kind)).toEqual(["client_error"]);
  first[Symbol.dispose]();

  using later = setup();
  later.fail();

  expect(later.reports.map((report) => report.kind)).toEqual(["client_error"]);
  expect(first.reports.map((report) => report.kind)).toEqual(["client_error"]);
});

function setup(): TelemetryFixture {
  using resources = new DisposableStack();
  const consoleOutput: string[] = [];
  const records: unknown[] = [];
  const events: unknown[] = [];
  const reports: TelemetryReportData[] = [];
  for (const method of ["groupCollapsed", "log"] as const) {
    resources.use(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(" "));
      }),
    );
  }
  resources.defer(() => vi.useRealTimers());
  vi.useFakeTimers({ toFake: ["performance"] });
  resources.use(
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      vi.advanceTimersByTime(600);
      return Promise.resolve(
        new Response(null, { status: 204, headers: { "X-Content-Raw": "true" } }),
      );
    }),
  );
  const unsubscribe = OBSERVE?.records.subscribe("rerun", (event) => records.push(event));
  if (unsubscribe !== undefined) {
    resources.defer(unsubscribe);
  }
  for (const type of ["call", "interaction"] as const) {
    const unsubscribe = OBSERVE?.records.subscribe(type, (event) => events.push(event));
    if (unsubscribe !== undefined) {
      resources.defer(unsubscribe);
    }
  }
  resources.defer(attribution.enable({ log: false, values: "full", checks: false }));
  const telemetry = resources.use(
    installClientTelemetry({ report: (report) => reports.push(report) }),
  );
  const root = document.body.appendChild(document.createElement("div"));
  resources.defer(() => root.remove());
  resources.defer(
    render(() => {
      const [value, setValue] = createSignal("Private draft before");
      let clicks = 0;
      return (
        <button
          onClick={() => {
            vi.advanceTimersByTime(600);
            setValue(`Private draft after${clicks++ === 0 ? "" : " again"}`);
          }}
        >
          {value()}
        </button>
      );
    }, root),
  );
  const call = createServerReference("telemetry-fixture");
  const owned = resources.move();
  return {
    consoleOutput,
    records,
    events,
    reports,
    telemetry,
    call: () => call(),
    fail: () => {
      const host = root.appendChild(document.createElement("div"));
      owned.defer(() => host.remove());
      owned.defer(
        render(
          () => (
            <Errored fallback={<p>Failure caught</p>}>
              <Failure />
            </Errored>
          ),
          host,
        ),
      );
      flush();
    },
    [Symbol.dispose]: () => owned.dispose(),
  };
}

function Failure(): never {
  throw new Error("Private failure");
}

type TelemetryFixture = Disposable & {
  readonly consoleOutput: string[];
  readonly records: unknown[];
  readonly events: unknown[];
  readonly reports: TelemetryReportData[];
  readonly telemetry: Disposable;
  readonly call: () => Promise<unknown>;
  readonly fail: () => void;
};
