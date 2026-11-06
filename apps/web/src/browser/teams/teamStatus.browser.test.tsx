import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { expect, it, vi } from "vitest";

import { formatClockTime } from "#browser/shared-ui/formatTime.ts";
import { createMinuteClock } from "#browser/timing/minuteClock.ts";

import { nextScheduledCheck } from "./teamStatus";

it("finds the next check at the next :55 on either side of the boundary", () => {
  const cases = [
    ["2026-01-01T05:54:00.000Z", "2026-01-01T05:55:00.000Z"],
    ["2026-01-01T05:54:59.999Z", "2026-01-01T05:55:00.000Z"],
    ["2026-01-01T05:55:00.000Z", "2026-01-01T06:55:00.000Z"],
    ["2026-01-01T05:55:00.001Z", "2026-01-01T06:55:00.000Z"],
    ["2026-01-01T05:56:00.000Z", "2026-01-01T06:55:00.000Z"],
    ["2026-01-01T05:59:59.999Z", "2026-01-01T06:55:00.000Z"],
    ["2026-01-01T06:00:00.000Z", "2026-01-01T06:55:00.000Z"],
    ["2026-12-31T23:59:59.999Z", "2027-01-01T00:55:00.000Z"],
  ] as const;

  for (const [from, expected] of cases) {
    expect(nextScheduledCheck(new Date(from)).toISOString(), from).toBe(expected);
  }
});

it("renders :55 UTC as :25 in a zone offset by half an hour", () => {
  const next = nextScheduledCheck(new Date("2026-01-01T05:54:00.000Z"));

  expect(next.toISOString()).toBe("2026-01-01T05:55:00.000Z");
  expect(formatClockTime(next, { locale: "en-US", timeZone: "UTC" })).toBe("5:55 am");
  expect(formatClockTime(next, { locale: "en-US", timeZone: "Asia/Kolkata" })).toBe("11:25 am");
});

it("reads the clock at the next minute, on a refresh, and when the tab returns", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-01-01T17:54:30.000Z"));
  const host = document.body.appendChild(document.createElement("div"));
  const [refreshed, setRefreshed] = createSignal(0);
  const dispose = render(() => <ClockProbe refreshed={refreshed} />, host);

  try {
    await flush();
    expect(host.textContent).toBe("2026-01-01T17:54:30.000Z");

    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(host.textContent, "the next minute boundary reads the clock").toBe(
      "2026-01-01T17:55:00.000Z",
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(host.textContent, "each boundary schedules the one after it").toBe(
      "2026-01-01T17:56:00.000Z",
    );

    vi.setSystemTime(new Date("2026-01-01T18:20:00.000Z"));
    setRefreshed(1);
    await flush();
    expect(host.textContent, "a refetch reads the clock again").toBe("2026-01-01T18:20:00.000Z");

    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    vi.setSystemTime(new Date("2026-01-01T19:05:00.000Z"));
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(host.textContent, "returning to the tab reads the clock again").toBe(
      "2026-01-01T19:05:00.000Z",
    );
    Reflect.deleteProperty(document, "hidden");
  } finally {
    Reflect.deleteProperty(document, "hidden");
    dispose();
    host.remove();
    vi.useRealTimers();
  }
});

function ClockProbe(props: { readonly refreshed: Accessor<number> }): JSX.Element {
  const clock = createMinuteClock(() => props.refreshed());
  return <p>{clock.now().toISOString()}</p>;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
