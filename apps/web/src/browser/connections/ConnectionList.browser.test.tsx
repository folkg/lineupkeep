import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

import { ConnectionList } from "./ConnectionList";

const completed: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
  provider: "yahoo",
  status: "ready",
  approvedAt: "2026-10-25T08:00:00.000Z",
  credentialGeneration: 1,
  createdAt: "2026-10-25T07:00:00.000Z",
  updatedAt: "2026-10-25T08:00:00.000Z",
};

const linking: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  provider: "yahoo",
  status: "linking",
  pairingCode: "hosted-018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  linkingExpiresAt: "2026-10-25T08:10:00.000Z",
  createdAt: "2026-10-25T08:00:00.000Z",
  updatedAt: "2026-10-25T08:00:00.000Z",
};

it("renders every connection it is given without filtering by pairing code", async () => {
  using _list = setupConnectionList([completed, linking]);

  await expect.element(page.getByText("Connected")).toBeVisible();
  await expect.element(page.getByText("hosted-018f79ea-7d86-7c18-9b4a-8b4d0c9165a2")).toBeVisible();
});

function setupConnectionList(connections: ReadonlyArray<ConnectionView>): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ConnectionList
        approvingId={() => undefined}
        cancelingId={() => undefined}
        connections={() => connections}
        disconnectingId={() => undefined}
        isLoading={() => false}
        loadFailure={() => null}
        onApprove={() => undefined}
        onChangeReconnectCode={() => undefined}
        onCancel={() => undefined}
        onDisconnect={() => undefined}
        onRefresh={() => Promise.resolve()}
        onReconnect={() => undefined}
        reconnectCode={() => ""}
        reconnectingId={() => undefined}
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
