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
  await expect.element(page.getByText(/Cannot read or set lineups/)).toBeVisible();
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

it("keeps a connected row's remove quiet, separate, and unclipped at desktop and phone widths", async () => {
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
      if (width === 390) {
        expectFullRowWidth(remove.element());
      }
    } finally {
      mounted[Symbol.dispose]();
    }
  }
});

it("puts Reconnect before a separate remove that stays unclipped at desktop and phone widths", async () => {
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
      expect(reconnect.element().getBoundingClientRect().top).toBeLessThan(
        remove.element().getBoundingClientRect().top,
      );
      if (width === 390) {
        expectFullRowWidth(reconnect.element());
        expectFullRowWidth(remove.element());
      }
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

function expectFullRowWidth(action: Element): void {
  const row = action.closest("li");
  expect(row, "the action belongs to a connection row").not.toBeNull();
  if (row === null) {
    return;
  }
  const actionBox = action.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  expect(actionBox.left).toBeGreaterThanOrEqual(rowBox.left - 1);
  expect(actionBox.right).toBeLessThanOrEqual(rowBox.right + 1);
  expect(Math.abs(actionBox.width - rowBox.width)).toBeLessThanOrEqual(1);
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
        reconnectingId={() => undefined}
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
