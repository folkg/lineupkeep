import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

import "#web/styles.css";

import { ConnectionList } from "./ConnectionList";

const connected: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
  provider: "yahoo",
  status: "ready",
  teamCount: 3,
  approvedAt: "2026-10-25T08:00:00.000Z",
  credentialGeneration: 1,
  createdAt: "2026-10-25T07:00:00.000Z",
  updatedAt: "2026-10-25T08:00:00.000Z",
};

const reconnectable: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  provider: "yahoo",
  status: "reconnect-required",
  teamCount: 1,
  approvedAt: "2026-10-24T08:00:00.000Z",
  credentialGeneration: 1,
  reconnectRequiredAt: "2026-10-25T08:00:00.000Z",
  createdAt: "2026-10-24T07:00:00.000Z",
  updatedAt: "2026-10-25T08:00:00.000Z",
};

it("identifies each connection by team count, connection time, and status", async () => {
  using _list = setupConnectionList([connected, reconnectable]);

  await expect.element(page.getByText(/3 teams/)).toBeVisible();
  await expect.element(page.getByText(/1 team/)).toBeVisible();
  await expect
    .element(
      page.getByText(new RegExp(`Connected ${formatReaderTime(connected.approvedAt ?? "")}`)),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await expect.element(page.getByText(/Paused until you sign in again/)).toBeVisible();
});

it("marks the row whose remove is waiting", async () => {
  const [disconnectingId, setDisconnectingId] = createSignal<string>();
  using _list = setupConnectionList([connected], { disconnectingId });
  const button = page.getByRole("button", { name: "Remove the Yahoo connection" });
  await expect.element(button).not.toHaveAttribute("aria-busy");

  setDisconnectingId(connected.id);

  await expect.element(button).toHaveAttribute("aria-busy", "true");
  await expect.element(button).toHaveAttribute("disabled");
  await expect.element(button).toBeDisabled();
});

it("keeps a connected row's remove quiet and clear of the heading at desktop and phone widths", async () => {
  for (const width of [1280, 390]) {
    await page.viewport(width, 844);
    const mounted = setupConnectionList([connected]);
    try {
      const remove = page.getByRole("button", { name: "Remove the Yahoo connection" });
      const heading = page.getByRole("heading", { name: "Yahoo connection" });
      await expect.element(remove).toBeVisible();

      expect(remove.element().textContent).toBe("Remove");
      expectSeparate(heading.element(), remove.element());
      expectUnclipped(remove.element());
      expectSingleAction(remove.element());
      expectNotFullRowWidth(remove.element());
    } finally {
      mounted[Symbol.dispose]();
    }
  }
});

it("puts Reconnect beside a separate remove at desktop and phone widths", async () => {
  for (const width of [1280, 390]) {
    await page.viewport(width, 844);
    const mounted = setupConnectionList([reconnectable]);
    try {
      const reconnect = page.getByRole("button", { name: "Reconnect" });
      const remove = page.getByRole("button", { name: "Remove the Yahoo connection" });
      const heading = page.getByRole("heading", { name: "Yahoo connection" });
      await expect.element(reconnect).toBeVisible();
      await expect.element(remove).toBeVisible();

      expect(remove.element().textContent).toBe("Remove");
      expect(
        reconnect.element().compareDocumentPosition(remove.element()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expectSeparate(reconnect.element(), remove.element());
      expectSeparate(heading.element(), reconnect.element());
      expectSeparate(heading.element(), remove.element());
      expectUnclipped(reconnect.element());
      expectUnclipped(remove.element());
      const reconnectBox = reconnect.element().getBoundingClientRect();
      const removeBox = remove.element().getBoundingClientRect();
      expect(Math.abs(reconnectBox.top - removeBox.top)).toBeLessThan(2);
      expect(reconnectBox.right).toBeLessThanOrEqual(removeBox.left);
      expectNotFullRowWidth(reconnect.element());
      expectNotFullRowWidth(remove.element());
    } finally {
      mounted[Symbol.dispose]();
    }
  }
});

function expectSeparate(first: Element, second: Element): void {
  const one = first.getBoundingClientRect();
  const other = second.getBoundingClientRect();
  const overlap =
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom;
  expect(overlap, "the row's text and actions never collide").toBe(false);
}

function expectUnclipped(element: Element): void {
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
  expect(element.getBoundingClientRect().width).toBeGreaterThan(0);
}

function expectSingleAction(action: Element): void {
  const row = action.closest("li");
  expect(row, "the action belongs to a connection row").not.toBeNull();
  expect(row?.querySelectorAll("button")).toHaveLength(1);
}

function expectNotFullRowWidth(action: Element): void {
  const row = action.closest("li");
  expect(row, "the action belongs to a connection row").not.toBeNull();
  if (row === null) {
    return;
  }
  expect(action.getBoundingClientRect().width).toBeLessThan(row.getBoundingClientRect().width - 24);
}

function setupConnectionList(
  connections: ReadonlyArray<ConnectionView>,
  overrides: { readonly disconnectingId?: () => string | undefined } = {},
): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ConnectionList
        connections={() => connections}
        departingId={() => undefined}
        disconnectingId={overrides.disconnectingId ?? (() => undefined)}
        isLoading={() => false}
        loadFailure={() => null}
        onDisconnect={() => undefined}
        onReconnect={() => undefined}
        onRefresh={() => Promise.resolve()}
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
