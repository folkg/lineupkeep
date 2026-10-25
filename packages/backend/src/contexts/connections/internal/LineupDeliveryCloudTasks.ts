import { Config, Effect, Layer, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";

import { LineupDelivery, LineupDeliveryFailed } from "#contexts/connections/LineupWork.ts";
import type { LineupDeliveryInput, LineupDeliveryShape } from "#contexts/connections/LineupWork.ts";

const metadataTokenUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const cloudTasksTasksUrl = "https://cloudtasks.googleapis.com/v2";
const MetadataToken = Schema.Struct({ access_token: Schema.String });
const DeliveryBody = Schema.Struct({
  action: Schema.Literal("deliver"),
  runs: Schema.Array(Schema.String),
});
const DeliveryBodyJson = Schema.fromJsonString(DeliveryBody);
const TaskRequestJson = Schema.fromJsonString(
  Schema.Struct({
    task: Schema.Struct({
      name: Schema.String,
      httpRequest: Schema.Struct({
        url: Schema.String,
        httpMethod: Schema.Literal("POST"),
        headers: Schema.Struct({ "content-type": Schema.Literal("application/json") }),
        body: Schema.String,
        oidcToken: Schema.Struct({
          serviceAccountEmail: Schema.String,
          audience: Schema.String,
        }),
      }),
    }),
  }),
);

export const LineupDeliveryCloudTasks = Layer.effect(
  LineupDelivery,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const queue = yield* Config.String("LINEUP_CLOUD_TASKS_QUEUE");
    const workerUrl = yield* Config.String("LINEUP_WORKER_URL");
    const serviceAccount = yield* Config.String("LINEUP_QUEUE_SERVICE_ACCOUNT");

    const enqueueMany: LineupDeliveryShape["enqueueMany"] = (inputs) =>
      Effect.forEach(inputs, enqueue, { concurrency: 2 }).pipe(Effect.asVoid);

    const enqueue = (input: LineupDeliveryInput): Effect.Effect<void, LineupDeliveryFailed> =>
      Effect.gen(function* () {
        const accessToken = yield* metadataAccessToken(http);
        const taskName = `${queue}/tasks/deliveries-${input.delivery}`;
        const body = yield* Schema.encodeEffect(DeliveryBodyJson)({
          action: "deliver" as const,
          runs: input.runs,
        }).pipe(Effect.mapError(() => LineupDeliveryFailed.make({ reason: "rejected" })));
        const requestBody = yield* Schema.encodeEffect(TaskRequestJson)({
          task: {
            name: taskName,
            httpRequest: {
              url: `${workerUrl}/api/internal/lineup-worker`,
              httpMethod: "POST" as const,
              headers: { "content-type": "application/json" as const },
              body: btoa(body),
              oidcToken: {
                serviceAccountEmail: serviceAccount,
                audience: workerUrl,
              },
            },
          },
        }).pipe(Effect.mapError(() => LineupDeliveryFailed.make({ reason: "rejected" })));
        const response = yield* http
          .post(`${cloudTasksTasksUrl}/${queue}/tasks`, {
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: HttpBody.text(requestBody, "application/json"),
          })
          .pipe(Effect.mapError(() => LineupDeliveryFailed.make({ reason: "unavailable" })));
        if (response.status === 409) {
          return;
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* LineupDeliveryFailed.make({ reason: "rejected" });
        }
      });

    return LineupDelivery.of({ enqueueMany });
  }),
);

function metadataAccessToken(
  http: HttpClient.HttpClient,
): Effect.Effect<string, LineupDeliveryFailed> {
  return Effect.gen(function* () {
    const response = yield* http
      .get(metadataTokenUrl, { headers: { "Metadata-Flavor": "Google" } })
      .pipe(Effect.mapError(() => LineupDeliveryFailed.make({ reason: "unavailable" })));
    if (response.status < 200 || response.status >= 300) {
      return yield* LineupDeliveryFailed.make({ reason: "unavailable" });
    }
    const body = yield* HttpClientResponse.schemaBodyJson(MetadataToken)(response).pipe(
      Effect.mapError(() => LineupDeliveryFailed.make({ reason: "unavailable" })),
    );
    return body.access_token;
  }).pipe(Effect.withSpan("LineupDeliveryCloudTasks.accessToken"));
}
