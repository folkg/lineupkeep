import { expect, test } from "./support";

test("passes requests through the application server entry", async ({ request }) => {
  const requestId = "server-entry-proof";

  const response = await request.get("/auth", { headers: { "x-request-id": requestId } });

  expect(response.headers()["x-request-id"]).toBe(requestId);
});

test("accepts a valid client report", async ({ request }) => {
  const report = {
    kind: "slow_call",
    id: "e2e-check",
    durationMs: 1200,
    method: "POST",
    outcome: "ok",
    status: 200,
  };

  const response = await request.post("/api/telemetry", { data: report });

  expect(response.status()).toBe(202);
  expect(await response.json()).toEqual({ ref: expect.any(String) });
});

test("rejects an invalid client report", async ({ request }) => {
  const report = { kind: "slow_call", id: "" };

  const response = await request.post("/api/telemetry", { data: report });

  expect(response.status()).toBe(400);
});
