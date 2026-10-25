import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { LineupRunId, LineupUuid } from "#contexts/connections/LineupRun.ts";
import { LineupDelivery } from "#contexts/connections/LineupWork.ts";

import { LineupDeliveryCloudTasks } from "./LineupDeliveryCloudTasks.ts";

it.effect("enqueues deterministic Cloud Tasks deliveries with no credentials", () =>
  Effect.gen(function* () {
    const delivery = yield* LineupDelivery;
    const runId = yield* Schema.decodeEffect(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
    const deliveryId = yield* Schema.decodeEffect(LineupUuid)(
      "018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
    );

    yield* delivery.enqueueMany([{ delivery: deliveryId, runs: [runId] }]);
    yield* delivery.enqueueMany([{ delivery: deliveryId, runs: [runId] }]);

    assert.strictEqual(requests.length, 4);
    const tasks = requests.filter((request) => request.url.endsWith("/tasks"));
    assert.strictEqual(tasks.length, 2);
    const first = tasks[0];
    if (first === undefined) {
      return;
    }
    const body = someBody(first);
    const task = yield* Schema.decodeEffect(Schema.fromJsonString(TaskRequest))(body);
    assert.strictEqual(
      task.task.name,
      "projects/p/locations/us-central1/queues/lineup/tasks/deliveries-018f79ea-7d86-7c18-9b4a-8b4d0c9164a3",
    );
    assert.strictEqual(task.task.httpRequest.url, "https://worker.test/api/internal/lineup-worker");
    assert.strictEqual(task.task.httpRequest.oidcToken.audience, "https://worker.test");
    assert.strictEqual(task.task.httpRequest.oidcToken.serviceAccountEmail, "queue@example.test");
    assert.strictEqual(
      atob(task.task.httpRequest.body),
      '{"action":"deliver","runs":["018f79ea-7d86-7c18-9b4a-8b4d0c9164a2"]}',
    );
    assert.notInclude(body, "cookie");
    assert.notInclude(body, "session");
  }).pipe(
    Effect.provide(
      LineupDeliveryCloudTasks.pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient)(sink)),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              LINEUP_CLOUD_TASKS_QUEUE: "projects/p/locations/us-central1/queues/lineup",
              LINEUP_WORKER_URL: "https://worker.test",
              LINEUP_QUEUE_SERVICE_ACCOUNT: "queue@example.test",
            }),
          ),
        ),
      ),
    ),
  ),
);

const requests: Array<{ readonly url: string; readonly body: unknown }> = [];
const sink = HttpClient.make((request) => {
  requests.push({ url: request.url, body: request.body });
  if (request.url.includes("metadata.google.internal")) {
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response('{"access_token":"metadata-token"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }
  const status = requests.filter((entry) => entry.url.endsWith("/tasks")).length === 1 ? 409 : 200;
  return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status })));
});

const TaskRequest = Schema.Struct({
  task: Schema.Struct({
    name: Schema.String,
    httpRequest: Schema.Struct({
      url: Schema.String,
      body: Schema.String,
      oidcToken: Schema.Struct({
        serviceAccountEmail: Schema.String,
        audience: Schema.String,
      }),
    }),
  }),
});

function someBody(request: { readonly body: unknown }): string {
  const body = request.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("_tag" in body) ||
    body._tag !== "Uint8Array" ||
    !("body" in body) ||
    !(body.body instanceof Uint8Array)
  ) {
    throw new Error("Expected a byte request body");
  }
  return new TextDecoder().decode(body.body);
}
