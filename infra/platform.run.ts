import * as Alchemy from "alchemy";
import * as GCP from "alchemy/GCP";
import * as Secrets from "alchemy/Secrets";
import { Effect, Layer } from "effect";

import { deploymentState } from "./state.ts";

const projectApis: ReadonlyArray<{ readonly id: string; readonly service: string }> = [
  { id: "ArtifactRegistryApi", service: "artifactregistry.googleapis.com" },
  { id: "BillingBudgetsApi", service: "billingbudgets.googleapis.com" },
  { id: "CloudBillingApi", service: "cloudbilling.googleapis.com" },
  { id: "CloudResourceManagerApi", service: "cloudresourcemanager.googleapis.com" },
  { id: "CloudRunApi", service: "run.googleapis.com" },
  { id: "CloudSchedulerApi", service: "cloudscheduler.googleapis.com" },
  { id: "CloudTasksApi", service: "cloudtasks.googleapis.com" },
  { id: "IamApi", service: "iam.googleapis.com" },
  { id: "IamCredentialsApi", service: "iamcredentials.googleapis.com" },
  { id: "LoggingApi", service: "logging.googleapis.com" },
  { id: "MonitoringApi", service: "monitoring.googleapis.com" },
  { id: "SecretManagerApi", service: "secretmanager.googleapis.com" },
  { id: "ServiceUsageApi", service: "serviceusage.googleapis.com" },
];

const credentialsWithQuotaProject = Layer.effect(
  GCP.Credentials,
  Effect.gen(function* () {
    const resolve = yield* GCP.Credentials;
    return Effect.map(resolve, (config) => ({ ...config, quotaProject: config.project }));
  }),
).pipe(Layer.provide(GCP.providers()));

const gcpEnvironment = Layer.effect(
  GCP.GcpEnvironment,
  Effect.map(GCP.Credentials, (resolve) =>
    Effect.gen(function* () {
      const config = yield* resolve.pipe(Effect.orDie);
      if (config.project === undefined) {
        return yield* Effect.die(new Error("GCP project id is required"));
      }
      return {
        accessToken: config.accessToken,
        project: config.project,
        region: config.region ?? "us-central1",
      };
    }),
  ),
).pipe(Layer.provide(credentialsWithQuotaProject));

const providers = Layer.mergeAll(
  Layer.effect(GCP.Providers)(GCP.Providers.pipe(Effect.provide(GCP.providers()))),
  credentialsWithQuotaProject,
  gcpEnvironment,
);

export default Alchemy.Stack(
  "LineupkeepPlatform",
  {
    providers,
    state: deploymentState,
    secrets: Secrets.ProcessEnv(),
  },
  Effect.gen(function* () {
    yield* Effect.forEach(projectApis, ({ id, service }) =>
      GCP.ServiceUsage.ProjectService(id, { service }),
    );
    const budget = yield* GCP.BillingBudgets.BillingBudget("MonthlyBudget", {
      displayName: "Lineupkeep monthly budget",
      amount: { specifiedAmount: { currencyCode: "CAD", units: "5" } },
      budgetFilter: {
        projects: ["projects/lineupkeep-prod"],
        calendarPeriod: "MONTH",
      },
      thresholdRules: [
        { thresholdPercent: 0.5, spendBasis: "CURRENT_SPEND" },
        { thresholdPercent: 0.9, spendBasis: "CURRENT_SPEND" },
        { thresholdPercent: 1, spendBasis: "CURRENT_SPEND" },
      ],
    });
    return { budgetName: budget.name };
  }),
);
