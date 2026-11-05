import * as Alchemy from "alchemy";
import * as GCP from "alchemy/GCP";
import * as Secrets from "alchemy/Secrets";
import { Effect } from "effect";

import { gcpProviders } from "./gcpProviders.ts";
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
  { id: "TelemetryApi", service: "telemetry.googleapis.com" },
  { id: "CloudTraceApi", service: "cloudtrace.googleapis.com" },
];

const providers = gcpProviders;

export default Alchemy.Stack(
  "LineupgradePlatform",
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
      displayName: "Lineupgrade monthly budget",
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
