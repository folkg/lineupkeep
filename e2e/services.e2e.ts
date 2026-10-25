import { randomUUID } from "node:crypto";

import { Schema } from "effect";

import { ServiceIdentity } from "./serviceSetup.ts";
import { expect, signUp, test } from "./support.ts";
import { isServiceCallAttachment, ServiceCallJson } from "./verify/serviceEvidence.ts";
test("retains failed service outcomes and rejects non-JSON results", async ({ services }) => {
  const identity = await services.signIn("owner");

  await expect(
    services.exercise(identity, "reject a synthetic operation", "rejectOperation"),
  ).rejects.toThrow("ExpectedRejection");
  await expect(
    services.inspect(identity, "return a non-JSON value", "nonJsonResult"),
  ).rejects.toThrow();

  const calls = test
    .info()
    .attachments.filter(isServiceCallAttachment)
    .map((attachment) => Schema.decodeUnknownSync(ServiceCallJson)(attachment.body?.toString()));
  expect(calls[0]).toMatchObject({
    phase: "Action",
    persona: "owner",
    outcome: {
      status: "failed",
      failure: { tag: "ExpectedRejection", message: "Synthetic rejection" },
    },
  });
  expect(calls[1]).toMatchObject({ phase: "Read", outcome: { status: "failed" } });
});

test("signs in named personas headlessly and isolates persisted service outcomes without opening a page", async ({
  services,
  browser,
}) => {
  const owner = await services.signIn("owner");
  expect(owner).toBeInstanceOf(ServiceIdentity);
  expect(JSON.stringify(owner)).toBe('{"persona":"owner"}');
  const other = await services.signIn("other");
  await services.arrange(owner, "verify the empty starting collection", "readConnections");

  const connection = await services.exercise(owner, "start an owned link", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
  });
  const owned = await services.inspect(owner, "read persisted connections", "readConnections");
  const isolated = await services.inspect(
    other,
    "read another User's connections",
    "readConnections",
  );

  expect(owned).toEqual([connection]);
  expect(isolated).toEqual([]);
  expect(browser.contexts()).toEqual([]);
  const evidence = test
    .info()
    .attachments.filter(isServiceCallAttachment)
    .map((attachment) => Schema.decodeUnknownSync(ServiceCallJson)(attachment.body?.toString()));
  expect(evidence.map(({ phase }) => phase)).toEqual(["Setup", "Action", "Read", "Read"]);
  expect(evidence.map(({ persona }) => persona)).toEqual(["owner", "owner", "owner", "other"]);
  expect(evidence.every(({ traceId }) => /^[a-f0-9]{32}$/u.test(traceId))).toBe(true);
  expect(evidence[1]).toMatchObject({
    outcome: { status: "succeeded", result: connection },
    execution: "application",
  });
});

test("uses named browser personas with their real sessions for service calls", async ({
  page,
  newUser,
  services,
}) => {
  await signUp(page, "owner");
  const other = await newUser("other");
  await signUp(other);

  await services.exercise(page, "start a link as the browser owner", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
  });
  const isolated = await services.inspect(
    other,
    "read as the other browser User",
    "readConnections",
  );

  expect(isolated).toEqual([]);
  const calls = test
    .info()
    .attachments.filter(isServiceCallAttachment)
    .map((attachment) => Schema.decodeUnknownSync(ServiceCallJson)(attachment.body?.toString()));
  expect(calls.map(({ persona }) => persona)).toEqual(["owner", "other"]);
});

test("replays concurrent batch links and rolls back mixed-owner cancellations in PostgreSQL", async ({
  services,
}) => {
  const owner = await services.signIn("batch-owner");
  const other = await services.signIn("batch-other");
  const inputs = [
    { requestId: randomUUID(), provider: "yahoo" },
    { requestId: randomUUID(), provider: "yahoo" },
  ];
  await test.step("Baseline: [batch-owner] has no connections", async () => {
    expect(
      await services.inspect(owner, "read the starting collection", "readConnections"),
    ).toEqual([]);
  });

  const [first, replay] =
    await test.step("Action: [batch-owner] submits identical link batches concurrently", () =>
      Promise.all([
        services.exercise(owner, "start the batch", "startLinkingBatch", inputs),
        services.exercise(owner, "retry the batch concurrently", "startLinkingBatch", inputs),
      ]));
  expect(replay).toEqual(first);
  const observations = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        linkingExpiresAt: Schema.optional(Schema.String),
      }),
    ),
  )(first);
  const foreign = Schema.decodeUnknownSync(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      linkingExpiresAt: Schema.optional(Schema.String),
    }),
  )(
    await services.exercise(other, "start a foreign link", "startLinking", {
      requestId: randomUUID(),
      provider: "yahoo",
    }),
  );

  await test.step("Result: [batch-owner] cannot cancel a batch containing another owner's connection", async () => {
    await expect(
      services.exercise(owner, "reject a mixed-owner cancellation", "cancelLinkingBatch", [
        ...observations.map((connection) => ({ id: connection.id })),
        { id: foreign.id },
      ]),
    ).rejects.toThrow("connection.not_found");
  });
  await test.step("Persistence: both owners retain their original connections without duplicates", async () => {
    expect(
      await services.inspect(owner, "read after the rejected cancellation", "readConnections"),
    ).toEqual(observations.toSorted((left, right) => left.id.localeCompare(right.id)));
    expect(await services.inspect(other, "read the foreign connection", "readConnections")).toEqual(
      [foreign],
    );
  });
});

test("rejects anonymous service invocations and invalid programs or arguments", async ({
  request,
  services,
}) => {
  const invocation = {
    persona: "owner",
    phase: "Read",
    description: "read connections",
    program: "readConnections",
    arguments: {},
  };

  expect((await request.post("/__verification/services", { data: invocation })).status()).toBe(401);
  expect((await request.get("/__verification/services")).status()).toBe(405);
  expect((await request.post("/__verification/services", { data: {} })).status()).toBe(400);
  expect(
    (
      await request.post("/__verification/services", {
        data: { ...invocation, program: "missing" },
      })
    ).status(),
  ).toBe(404);
  const owner = await services.signIn("owner");
  await expect(
    services.exercise(owner, "reject invalid arguments", "startLinking", { provider: 42 }),
  ).rejects.toThrow();
});
