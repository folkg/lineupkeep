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
  await services.arrange(owner, "verify the empty starting collection", "readNotes");

  const note = await services.exercise(owner, "create an owned Note", "createNote", {
    requestId: randomUUID(),
    title: "Service proof",
    body: "Private",
  });
  const owned = await services.inspect(owner, "read persisted Notes", "readNotes");
  const isolated = await services.inspect(other, "read another User's Notes", "readNotes");

  expect(owned).toEqual([note]);
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
    outcome: { status: "succeeded", result: note },
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

  await services.exercise(page, "create as the browser owner", "createNote", {
    requestId: randomUUID(),
    title: "Browser persona",
    body: "Private",
  });
  const isolated = await services.inspect(other, "read as the other browser User", "readNotes");

  expect(isolated).toEqual([]);
  const calls = test
    .info()
    .attachments.filter(isServiceCallAttachment)
    .map((attachment) => Schema.decodeUnknownSync(ServiceCallJson)(attachment.body?.toString()));
  expect(calls.map(({ persona }) => persona)).toEqual(["owner", "other"]);
});

test("replays concurrent batch creates and rolls back mixed-owner updates in PostgreSQL", async ({
  services,
}) => {
  const owner = await services.signIn("batch-owner");
  const other = await services.signIn("batch-other");
  const inputs = [
    { requestId: randomUUID(), title: "Batch first", body: "First body" },
    { requestId: randomUUID(), title: "Batch second", body: "Second body" },
  ];
  await test.step("Baseline: [batch-owner] has no Notes", async () => {
    expect(await services.inspect(owner, "read the starting collection", "readNotes")).toEqual([]);
  });

  const [first, replay] =
    await test.step("Action: [batch-owner] submits identical batches concurrently", () =>
      Promise.all([
        services.exercise(owner, "create the batch", "createNotes", inputs),
        services.exercise(owner, "retry the batch concurrently", "createNotes", inputs),
      ]));
  expect(replay).toEqual(first);
  const observations = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        body: Schema.String,
        lifecycle: Schema.String,
      }),
    ),
  )(first);
  const foreign = Schema.decodeUnknownSync(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      body: Schema.String,
      lifecycle: Schema.String,
    }),
  )(
    await services.exercise(other, "create a foreign Note", "createNote", {
      requestId: randomUUID(),
      title: "Other owner",
      body: "Private",
    }),
  );

  await test.step("Result: [batch-owner] cannot commit an update containing another owner's Note", async () => {
    await expect(
      services.exercise(owner, "reject a mixed-owner update", "updateNotes", [
        ...observations.map((note) => ({
          id: note.id,
          title: "Must roll back",
          body: "Must roll back",
        })),
        { id: foreign.id, title: "Forbidden", body: "Forbidden" },
      ]),
    ).rejects.toThrow("note.not_found");
  });
  await test.step("Persistence: both owners retain their original Notes without duplicates", async () => {
    expect(await services.inspect(owner, "read after the rejected update", "readNotes")).toEqual(
      observations.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
    expect(await services.inspect(other, "read the foreign Note", "readNotes")).toEqual([foreign]);
  });
});

test("rejects anonymous service invocations and invalid programs or arguments", async ({
  request,
  services,
}) => {
  const invocation = {
    persona: "owner",
    phase: "Read",
    description: "read Notes",
    program: "readNotes",
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
    services.exercise(owner, "reject invalid arguments", "createNote", { title: 42 }),
  ).rejects.toThrow();
});
