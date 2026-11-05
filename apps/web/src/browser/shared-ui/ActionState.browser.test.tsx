import "#web/styles.css";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { cdp, page } from "vitest/browser";

import type { ActionState } from "./actionState";
import { Button } from "./Button";
import { ButtonLink } from "./ButtonLink";
import { IconButton } from "./IconButton";
import { Switch } from "./Switch";

it("keeps a button's box and the page height through every state", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mount(() => (
    <Button confirmed state={state()}>
      Save note
    </Button>
  ));
  const button = page.getByRole("button", { name: "Save note" });
  const idle = measure(button.element(), mounted.host);
  const style = getComputedStyle(button.element());
  expect(style.paddingLeft, "a confirmed button reserves its mark slot").toBe("36px");
  expect(style.paddingRight, "a confirmed button stays balanced").toBe("36px");

  setState("working");
  await expect.element(button).toHaveAttribute("aria-busy", "true");
  expect(measure(button.element(), mounted.host)).toEqual(idle);

  setState("done");
  await expect.element(button).toHaveAttribute("data-state", "done");
  expect(measure(button.element(), mounted.host)).toEqual(idle);
  expect(button.element().querySelector('[data-action-mark="tick"]')).not.toBeNull();
});

it("keeps a link's box and the page height through every state", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mountRouter(() => (
    <ButtonLink actionState={state()} confirmed to="/">
      Open teams
    </ButtonLink>
  ));
  const link = page.getByRole("link", { name: "Open teams" });
  await expect.element(link).toBeVisible();
  const idle = measure(link.element(), mounted.host);

  setState("working");
  await expect.element(link).toHaveAttribute("aria-busy", "true");
  await expect.element(link).toHaveAttribute("aria-disabled", "true");
  const path = window.location.pathname;
  link.element().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(window.location.pathname).toBe(path);
  expect(measure(link.element(), mounted.host)).toEqual(idle);

  setState("done");
  await expect.element(link).toHaveAttribute("data-state", "done");
  expect(measure(link.element(), mounted.host)).toEqual(idle);
});

it("keeps an icon button's box and the page height through every state", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mount(() => (
    <IconButton confirmed label="Refresh teams" state={state()} onClick={() => undefined}>
      <svg aria-hidden="true" height="17" viewBox="0 0 16 16" width="17">
        <path d="M13 8a5 5 0 1 1-1.7-3.8" fill="none" stroke="currentColor" />
      </svg>
    </IconButton>
  ));
  const button = page.getByRole("button", { name: "Refresh teams" });
  const idle = measure(button.element(), mounted.host);

  setState("working");
  await expect.element(button).toHaveAttribute("aria-busy", "true");
  await expect.element(button).toHaveAttribute("disabled");
  expect(measure(button.element(), mounted.host)).toEqual(idle);

  setState("done");
  await expect.element(button).toHaveAttribute("data-state", "done");
  expect(measure(button.element(), mounted.host)).toEqual(idle);
});

it("keeps a switch's box and the page height through every state", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mount(() => (
    <Switch checked name="Lineup checks" state={state()} onToggle={() => undefined}>
      Lineup checks
    </Switch>
  ));
  const control = page.getByRole("switch", { name: "Lineup checks" });
  const idle = measure(control.element(), mounted.host);

  setState("working");
  await expect.element(control).toHaveAttribute("aria-busy", "true");
  await expect.element(control).toHaveAttribute("disabled");
  expect(measure(control.element(), mounted.host)).toEqual(idle);

  setState("done");
  await expect.element(control).toHaveAttribute("data-state", "done");
  expect(measure(control.element(), mounted.host)).toEqual(idle);
});

it("propagates a state prop through a parent component", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mount(() => <PassThrough label="Refresh teams" value={state()} />);
  const button = page.getByRole("button", { name: "Refresh teams" });
  setState("working");
  await expect.element(button).toHaveAttribute("aria-busy", "true");
  expect(button.element().getAttribute("data-state")).toBe("working");
  expect(mounted.host.querySelector('[data-action-mark="work"]')).not.toBeNull();
});

it("adds no words beside a working control", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  using mounted = mount(() => (
    <div>
      <Button state={state()}>Save note</Button>
      <IconButton label="Refresh teams" state={state()} onClick={() => undefined}>
        <svg aria-hidden="true" height="17" viewBox="0 0 16 16" width="17">
          <path d="M13 8a5 5 0 1 1-1.7-3.8" fill="none" stroke="currentColor" />
        </svg>
      </IconButton>
      <Switch checked name="Lineup checks" state={state()} onToggle={() => undefined}>
        Lineup checks
      </Switch>
    </div>
  ));
  const words = textNodes(mounted.host);
  const children = mounted.host.childElementCount;

  setState("working");
  await expect
    .element(page.getByRole("button", { name: "Save note" }))
    .toHaveAttribute("aria-busy", "true");

  expect(textNodes(mounted.host)).toEqual(words);
  expect(mounted.host.childElementCount).toBe(children);
});

it("collapses action-state motion to instant when the reader asks for less", async () => {
  const session = cdp();
  if (!hasSend(session)) {
    throw new Error("The browser test session cannot emulate media.");
  }
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  try {
    const [state, setState] = createSignal<ActionState>("idle");
    using mounted = mount(() => <Button state={state()}>Save note</Button>);
    setState("working");
    await expect
      .element(page.getByRole("button", { name: "Save note" }))
      .toHaveAttribute("aria-busy", "true");
    const button = mounted.host.querySelector("button");
    const mark = mounted.host.querySelector('[data-action-mark="work"]');
    expect(button).not.toBeNull();
    expect(mark).not.toBeNull();
    expect(getComputedStyle(button ?? document.body).transitionDuration).toBe("0s");
    expect(getComputedStyle(mark ?? document.body).animationName).toBe("none");
  } finally {
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

function PassThrough(props: { readonly label: string; readonly value: ActionState }): JSX.Element {
  return (
    <IconButton label={props.label} state={props.value} onClick={() => undefined}>
      <svg aria-hidden="true" height="17" viewBox="0 0 16 16" width="17">
        <path d="M13 8a5 5 0 1 1-1.7-3.8" fill="none" stroke="currentColor" />
      </svg>
    </IconButton>
  );
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

function mountRouter(view: () => JSX.Element): {
  readonly host: HTMLDivElement;
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => view(),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const dispose = render(() => <RouterProvider router={router} />, host);
  return {
    host,
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function measure(
  element: Element,
  host: HTMLElement,
): {
  readonly box: ReadonlyArray<number>;
  readonly hostHeight: number;
  readonly pageHeight: number;
} {
  const box = element.getBoundingClientRect();
  return {
    box: [box.x, box.y, box.width, box.height],
    hostHeight: host.getBoundingClientRect().height,
    pageHeight: document.body.scrollHeight,
  };
}

function textNodes(host: HTMLElement): ReadonlyArray<string> {
  return Array.from(host.querySelectorAll("*"))
    .flatMap((element) => Array.from(element.childNodes))
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => text !== "");
}
