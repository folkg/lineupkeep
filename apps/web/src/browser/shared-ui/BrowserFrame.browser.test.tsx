import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { HostedBrowserKey } from "#contracts/connections/hostedBrowserProtocol.ts";

import { BrowserFrame } from "./BrowserFrame";

it("forwards typed characters to the remote page and keeps the local field empty", async () => {
  const events = recordedEvents();
  using _frame = renderFrame(events);

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" });
  await surface.click();
  await userEvent.keyboard("user@example.test");

  await expect.poll(() => events.text.join("")).toBe("user@example.test");
  await expect.element(surface).toHaveValue("");
  expect(document.activeElement).toBe(surface.element());
});

it("forwards Enter, Backspace, Tab, and arrow keys from a physical keyboard", async () => {
  const events = recordedEvents();
  using _frame = renderFrame(events);

  await page.getByRole("textbox", { name: "Yahoo sign-in browser" }).click();
  await userEvent.keyboard("{Enter}{Backspace}{Tab}{ArrowLeft}");

  expect(events.keys).toEqual(["Enter", "Backspace", "Tab", "ArrowLeft"]);
});

it("forwards pasted text once and does not keep it in the local field", async () => {
  const events = recordedEvents();
  using _frame = renderFrame(events);

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" });
  await surface.click();
  const clipboard = new DataTransfer();
  clipboard.setData("text/plain", "pasted@example.test");
  const paste = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: clipboard,
  });
  surface.element().dispatchEvent(paste);

  expect(paste.defaultPrevented).toBe(true);
  await expect.poll(() => events.text).toEqual(["pasted@example.test"]);
  await expect.element(surface).toHaveValue("");
});

it("forwards committed composition text without forwarding the composition itself", async () => {
  const events = recordedEvents();
  using _frame = renderFrame(events);

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" });
  const element = surface.element();
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("The browser frame did not render an input surface");
  }
  element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  element.value = "に";
  element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  element.value = "日本";
  element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

  await expect.poll(() => events.text).toEqual(["日本"]);
  await expect.element(surface).toHaveValue("");
});

it("uses a text cursor over the page and never a crosshair", () => {
  using _frame = renderFrame(recordedEvents());

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" });
  expect(getComputedStyle(surface.element()).cursor).toBe("text");
  expect(document.querySelector(".cursor-crosshair")).toBeNull();
});

it("keeps the frame aspect equal to the phone viewport", () => {
  using _frame = renderFrame(recordedEvents(), { width: 390, height: 844 });

  const frame = page
    .getByRole("textbox", { name: "Yahoo sign-in browser" })
    .element().parentElement;
  if (frame === null) {
    throw new Error("The browser frame did not render");
  }
  const bounds = frame.getBoundingClientRect();
  expect(bounds.width / bounds.height).toBeCloseTo(390 / 844, 2);
});

function renderFrame(
  events: RecordedEvents,
  viewport: { readonly width: number; readonly height: number } = { width: 1100, height: 720 },
): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <BrowserFrame
        frameUrl={undefined}
        ready={false}
        statusLabel="Loading the sign-in page…"
        viewport={viewport}
        onCancel={() => undefined}
        onKey={(key) => events.keys.push(key)}
        onPointer={(x, y) => events.pointer.push([x, y])}
        onScroll={() => undefined}
        onText={(text) => events.text.push(text)}
      />
    ),
    host,
  );

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function recordedEvents(): RecordedEvents {
  return { keys: [], pointer: [], text: [] };
}

type RecordedEvents = {
  readonly keys: Array<HostedBrowserKey>;
  readonly pointer: Array<readonly [number, number]>;
  readonly text: Array<string>;
};
