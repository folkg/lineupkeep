import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

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

function setupConnectionList(connections: ReadonlyArray<ConnectionView>): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ConnectionList
        connections={() => connections}
        disconnectingId={() => undefined}
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
