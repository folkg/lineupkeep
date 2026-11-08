import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { cdp, page } from "vitest/browser";

import { Button } from "./Button";
import { RuleList } from "./RuleList";
import { createSettle } from "./settle";

const durationTokens = ["quick", "reveal", "work", "tick", "confirm"] as const;

it("settles an arrival once on the theme's duration and easing", async () => {
  const [teams, setTeams] = createSignal<ReadonlyArray<string>>([]);
  using mounted = mount(() => <SettledTeams teams={teams()} />);
  expect(mounted.host.querySelector("ol"), "no list before there are teams").toBeNull();

  setTeams(["Alpha", "Beta"]);
  await Promise.resolve();

  const list = listOf(mounted.host);
  const style = getComputedStyle(list);
  expect(list.getAttribute("data-motion")).toBe("settle");
  expect(style.animationName).toBe("settle-in");
  expect(time(style.animationDuration)).toBe(time(token("--theme-duration-reveal")));
  expect(style.animationTimingFunction).toBe(token("--theme-ease-out"));
  expect(list.textContent).toContain("Alpha");
});

it("leaves a collection that was already there still", async () => {
  using mounted = mount(() => <SettledTeams teams={["Alpha", "Beta"]} />);
  await Promise.resolve();

  const list = listOf(mounted.host);
  expect(list.getAttribute("data-motion"), "a page load does not animate").toBeNull();
  expect(getComputedStyle(list).animationName).toBe("none");
  expect(getComputedStyle(list).opacity).toBe("1");
});

it("keeps every running animation inside the theme's duration tokens", async () => {
  const [teams, setTeams] = createSignal<ReadonlyArray<string>>([]);
  using _mounted = mount(() => (
    <div>
      <SettledTeams teams={teams()} />
      <Button state="working">Submit moves</Button>
    </div>
  ));
  setTeams(["Alpha"]);
  await Promise.resolve();

  const durations = new Set(durationTokens.map((name) => time(token(`--theme-duration-${name}`))));
  const running = document.getAnimations();
  expect(running.length, "the settle and the hairline are running").toBeGreaterThanOrEqual(2);
  for (const animation of running) {
    const timing = animation.effect?.getComputedTiming();
    expect(durations.has(typeof timing?.duration === "number" ? timing.duration : 0)).toBe(true);
  }
});

it("shows the same content with no motion when the reader asks for less", async () => {
  const session = cdp();
  if (!hasSend(session)) {
    throw new Error("The browser test session cannot emulate media.");
  }
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  try {
    const [teams, setTeams] = createSignal<ReadonlyArray<string>>([]);
    using mounted = mount(() => <SettledTeams teams={teams()} />);
    setTeams(["Alpha", "Beta"]);
    await Promise.resolve();

    const list = listOf(mounted.host);
    const style = getComputedStyle(list);
    expect(style.animationName).toBe("none");
    expect(style.opacity, "the list is not held transparent").toBe("1");
    expect(style.transform, "the list is not held off its place").toBe("none");
    expect(list.textContent, "every team is still listed").toContain("Beta");
  } finally {
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

it("draws a working control at full strength and a plain disabled one faded", () => {
  using _mounted = mount(() => (
    <div>
      <Button state="working">Submit moves</Button>
      <Button disabled>Withdraw offer</Button>
    </div>
  ));
  const working = page.getByRole("button", { name: "Submit moves" }).element();
  const disabled = page.getByRole("button", { name: "Withdraw offer" }).element();
  expect(getComputedStyle(working).opacity, "the hairline is drawn at full strength").toBe("1");
  expect(getComputedStyle(disabled).opacity, "a disabled control still reads as unavailable").toBe(
    "0.5",
  );
});

function SettledTeams(props: { readonly teams: ReadonlyArray<string> }): JSX.Element {
  const settling = createSettle(() => props.teams.length > 0);
  return (
    <Show when={props.teams.length > 0}>
      <RuleList settling={settling()}>
        <For each={props.teams}>{(team) => <li>{team}</li>}</For>
      </RuleList>
    </Show>
  );
}

function listOf(host: HTMLElement): HTMLElement {
  const list = host.querySelector("ol");
  if (list === null) {
    throw new Error("The arrival did not render a list.");
  }
  return list;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function time(value: string): number {
  return value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
}

function hasSend(value: unknown): value is {
  readonly send: (method: string, params?: unknown) => Promise<unknown>;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "send" in value &&
    typeof value.send === "function"
  );
}

function mount(view: () => JSX.Element): {
  readonly host: HTMLDivElement;
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(view, host);
  return {
    host,
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}
