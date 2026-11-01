import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { Config, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";

import type { AuthService } from "#contexts/auth/Auth.ts";
import { AuthorizationScopes } from "#contexts/auth/AuthorizationScopes.ts";
import { AuthDatabase } from "#contexts/auth/internal/AuthDatabase.ts";
import { AuthLive } from "#contexts/auth/internal/AuthLive.ts";
import { BetterAuthAdapter } from "#contexts/auth/internal/BetterAuthAdapter.ts";
import { OAuthClientRepository } from "#contexts/auth/internal/OAuthClientRepository.ts";
import { SignInCodeQuotaRepository } from "#contexts/auth/internal/SignInCodeQuotaRepository.ts";
import { SignInSessionRepository } from "#contexts/auth/internal/SignInSessionRepository.ts";
import { SignInSessionsLive } from "#contexts/auth/internal/SignInSessionsLive.ts";
import { UserDirectoryLive } from "#contexts/auth/internal/UserDirectoryRepository.ts";
import type { SignInSessions } from "#contexts/auth/SignInSessions.ts";
import type { Automation } from "#contexts/connections/Automation.ts";
import type { Connections } from "#contexts/connections/Connections.ts";
import type { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import type { HostedLinking } from "#contexts/connections/HostedLinking.ts";
import { AutomationLive } from "#contexts/connections/internal/AutomationLive.ts";
import { ConnectionCredentialEncryption } from "#contexts/connections/internal/ConnectionCredentialEncryption.ts";
import { ConnectionRepository } from "#contexts/connections/internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "#contexts/connections/internal/ConnectionsDatabase.ts";
import { ConnectionsLive } from "#contexts/connections/internal/ConnectionsLive.ts";
import { FantasyQueriesLive } from "#contexts/connections/internal/FantasyQueriesLive.ts";
import { HostedLinkingLive } from "#contexts/connections/internal/HostedLinkingLive.ts";
import { HostedLinkingRepository } from "#contexts/connections/internal/HostedLinkingRepository.ts";
import { LineupDeliveryCloudTasks } from "#contexts/connections/internal/LineupDeliveryCloudTasks.ts";
import { LineupDeliveryLocal } from "#contexts/connections/internal/LineupDeliveryLocal.ts";
import { LineupDispatcherLive } from "#contexts/connections/internal/LineupDispatcherLive.ts";
import { LineupRunRepository } from "#contexts/connections/internal/LineupRunRepository.ts";
import { LineupRunsLive } from "#contexts/connections/internal/LineupRunsLive.ts";
import { LineupWorkerLive } from "#contexts/connections/internal/LineupWorkerLive.ts";
import { NotificationsLive } from "#contexts/connections/internal/NotificationsRepository.ts";
import { QueryRepository } from "#contexts/connections/internal/QueryRepository.ts";
import { QueryTokens } from "#contexts/connections/internal/QueryTokens.ts";
import { RetentionSweepLive } from "#contexts/connections/internal/RetentionSweepRepository.ts";
import { TeamRepository } from "#contexts/connections/internal/TeamRepository.ts";
import { TeamsLive } from "#contexts/connections/internal/TeamsLive.ts";
import { TransactionProposalRepository } from "#contexts/connections/internal/TransactionProposalRepository.ts";
import { TransactionProposalsLive } from "#contexts/connections/internal/TransactionProposalsLive.ts";
import { TransactionReviewsLive } from "#contexts/connections/internal/TransactionReviewsLive.ts";
import { yahooProvider } from "#contexts/connections/internal/yahoo/YahooProvider.ts";
import type { LineupRuns } from "#contexts/connections/LineupRuns.ts";
import type { LineupDispatcher, LineupWorker } from "#contexts/connections/LineupWork.ts";
import type { Notifications } from "#contexts/connections/Notifications.ts";
import { ProviderRegistry, providerRegistryOf } from "#contexts/connections/ProviderRegistry.ts";
import type { RetentionSweep } from "#contexts/connections/Retention.ts";
import type { Teams } from "#contexts/connections/Teams.ts";
import type { TransactionProposals } from "#contexts/connections/TransactionProposals.ts";
import type { TransactionReviews } from "#contexts/connections/TransactionReview.ts";
import type { Feedback } from "#contexts/feedback/Feedback.ts";
import type { FeedbackRetention } from "#contexts/feedback/FeedbackRetention.ts";
import { FeedbackDatabase } from "#contexts/feedback/internal/FeedbackDatabase.ts";
import { FeedbackLive } from "#contexts/feedback/internal/FeedbackLive.ts";
import { FeedbackRepository } from "#contexts/feedback/internal/FeedbackRepository.ts";
import { FeedbackRetentionLive } from "#contexts/feedback/internal/FeedbackRetentionLive.ts";
import { ToolCallQuotaDatabase } from "#contexts/toolCalls/internal/ToolCallQuotaDatabase.ts";
import { ToolCallQuotaLive } from "#contexts/toolCalls/internal/ToolCallQuotaLive.ts";
import { ToolCallQuotaRepository } from "#contexts/toolCalls/internal/ToolCallQuotaRepository.ts";
import type { ToolCallQuota } from "#contexts/toolCalls/ToolCallQuota.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";
import { advertisedScopes } from "#runtime/ApplicationScopes.ts";

const EmailDeliveryLayer = EmailDelivery.fromConfig.pipe(Layer.provide(FetchHttpClient.layer));
const AuthLayer = AuthLive.pipe(
  Layer.provide(BetterAuthAdapter.layer),
  Layer.provide(Layer.succeed(AuthorizationScopes)(advertisedScopes)),
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(OAuthClientRepository.layer),
  Layer.provide(AuthDatabase.layer),
  Layer.provide(EmailDeliveryLayer),
);
const SignInSessionRepositoryLayer = SignInSessionRepository.layer.pipe(
  Layer.provide(AuthDatabase.layer),
);
const SignInSessionsLayer = SignInSessionsLive.pipe(Layer.provide(SignInSessionRepositoryLayer));
const ProviderLayer = Layer.effect(ProviderRegistry)(
  Effect.map(yahooProvider, (yahoo) => ProviderRegistry.of(providerRegistryOf([yahoo]))),
);
const CredentialEncryptionLayer = ConnectionCredentialEncryption.layer;
const RepositoryLayer = ConnectionRepository.layer.pipe(Layer.provide(ConnectionsDatabase.layer));
const ConnectionsLayer = ConnectionsLive.pipe(
  Layer.provide(RepositoryLayer),
  Layer.provide(ProviderLayer),
  Layer.provide(CredentialEncryptionLayer),
);
const HostedLinkingRepositoryLayer = HostedLinkingRepository.layer.pipe(
  Layer.provide(ConnectionsDatabase.layer),
);
const HostedLinkingLayer = HostedLinkingLive.pipe(
  Layer.provide(HostedLinkingRepositoryLayer),
  Layer.provide(ConnectionsLayer),
);
const QueryRepositoryLayer = QueryRepository.layer.pipe(
  Layer.provide(RepositoryLayer),
  Layer.provide(ConnectionsDatabase.layer),
);
const QueriesLayer = Layer.merge(FantasyQueriesLive, TransactionReviewsLive).pipe(
  Layer.provide(QueryRepositoryLayer),
  Layer.provide(ConnectionsLayer),
  Layer.provide(ProviderLayer),
  Layer.provide(CredentialEncryptionLayer),
  Layer.provide(QueryTokens.layer),
);
const ProposalRepositoryLayer = TransactionProposalRepository.layer.pipe(
  Layer.provide(ConnectionsDatabase.layer),
);
const ProposalsLayer = TransactionProposalsLive.pipe(
  Layer.provide(ProposalRepositoryLayer),
  Layer.provide(QueryRepositoryLayer),
  Layer.provide(ProviderLayer),
  Layer.provide(CredentialEncryptionLayer),
  Layer.provide(QueryTokens.layer),
);
const LineupRepositoryLayer = LineupRunRepository.layer.pipe(
  Layer.provide(ConnectionsDatabase.layer),
);
const LineupWorkerLayer = LineupWorkerLive.pipe(
  Layer.provide(LineupRepositoryLayer),
  Layer.provide(QueryRepositoryLayer),
  Layer.provide(CredentialEncryptionLayer),
  Layer.provide(ProviderLayer),
);
const LineupDeliveryLayer = Layer.unwrap(
  Config.option(Config.String("LINEUP_CLOUD_TASKS_QUEUE")).pipe(
    Effect.map(
      Option.match({
        onNone: () => LineupDeliveryLocal.pipe(Layer.provide(LineupWorkerLayer)),
        onSome: () => LineupDeliveryCloudTasks.pipe(Layer.provide(FetchHttpClient.layer)),
      }),
    ),
  ),
);
const LineupDispatcherLayer = LineupDispatcherLive.pipe(
  Layer.provide(LineupRepositoryLayer),
  Layer.provide(LineupDeliveryLayer),
);
const LineupRunsLayer = LineupRunsLive.pipe(
  Layer.provide(LineupRepositoryLayer),
  Layer.provide(QueryRepositoryLayer),
  Layer.provide(LineupDispatcherLayer),
);
const TeamRepositoryLayer = TeamRepository.layer.pipe(
  Layer.provide(ConnectionsDatabase.layer),
  Layer.provide(ProviderLayer),
);
const TeamsLayer = TeamsLive.pipe(
  Layer.provide(TeamRepositoryLayer),
  Layer.provide(LineupRepositoryLayer),
  Layer.provide(ProviderLayer),
  Layer.provide(CredentialEncryptionLayer),
);
const RetentionSweepLayer = RetentionSweepLive.pipe(Layer.provide(ConnectionsDatabase.layer));
const AutomationLayer = AutomationLive.pipe(
  Layer.provide(TeamRepositoryLayer),
  Layer.provide(LineupRepositoryLayer),
  Layer.provide(LineupDispatcherLayer),
  Layer.provide(RetentionSweepLayer),
);
const UserDirectoryLayer = UserDirectoryLive.pipe(Layer.provide(AuthDatabase.layer));
const NotificationsLayer = NotificationsLive.pipe(
  Layer.provide(ConnectionsDatabase.layer),
  Layer.provide(UserDirectoryLayer),
  Layer.provide(EmailDeliveryLayer),
);
const FeedbackRepositoryLayer = FeedbackRepository.layer.pipe(
  Layer.provide(FeedbackDatabase.layer),
);
const FeedbackLayer = FeedbackLive.pipe(Layer.provide(FeedbackRepositoryLayer));
const FeedbackRetentionLayer = FeedbackRetentionLive.pipe(Layer.provide(FeedbackRepositoryLayer));
const ToolCallQuotaLayer = ToolCallQuotaLive.pipe(
  Layer.provide(ToolCallQuotaRepository.layer),
  Layer.provide(ToolCallQuotaDatabase.layer),
);
export const ApplicationLayer = Layer.mergeAll(
  ConnectionsLayer,
  HostedLinkingLayer,
  QueriesLayer,
  ProposalsLayer,
  LineupRunsLayer,
  TeamsLayer,
  AutomationLayer,
  NotificationsLayer,
  RetentionSweepLayer,
  LineupDispatcherLayer,
  LineupWorkerLayer,
  FeedbackLayer,
  FeedbackRetentionLayer,
  ToolCallQuotaLayer,
  SignInSessionsLayer,
  AuthLayer,
  ProviderLayer,
  QueryTokens.layer,
).pipe(Layer.provide(PostgresLive), Layer.provide(NodeCrypto.layer));

export type BackendServices =
  | AuthService
  | SignInSessions
  | Connections
  | HostedLinking
  | FantasyQueries
  | TransactionReviews
  | TransactionProposals
  | LineupRuns
  | Teams
  | Automation
  | Notifications
  | RetentionSweep
  | LineupDispatcher
  | LineupWorker
  | Feedback
  | FeedbackRetention
  | ToolCallQuota;
