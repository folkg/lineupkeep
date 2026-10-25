import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import type { AuthService } from "#contexts/auth/Auth.ts";
import { AuthorizationScopes } from "#contexts/auth/AuthorizationScopes.ts";
import { AuthDatabase } from "#contexts/auth/internal/AuthDatabase.ts";
import { AuthLive } from "#contexts/auth/internal/AuthLive.ts";
import { BetterAuthAdapter } from "#contexts/auth/internal/BetterAuthAdapter.ts";
import { SignInCodeQuotaRepository } from "#contexts/auth/internal/SignInCodeQuotaRepository.ts";
import type { Connections } from "#contexts/connections/Connections.ts";
import { connectionScopes } from "#contexts/connections/ConnectionScopes.ts";
import type { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import { ConnectionCredentialEncryption } from "#contexts/connections/internal/ConnectionCredentialEncryption.ts";
import { ConnectionRepository } from "#contexts/connections/internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "#contexts/connections/internal/ConnectionsDatabase.ts";
import { ConnectionsLive } from "#contexts/connections/internal/ConnectionsLive.ts";
import { FantasyQueriesLive } from "#contexts/connections/internal/FantasyQueriesLive.ts";
import { QueryRepository } from "#contexts/connections/internal/QueryRepository.ts";
import { QueryTokens } from "#contexts/connections/internal/QueryTokens.ts";
import { TransactionReviewsLive } from "#contexts/connections/internal/TransactionReviewsLive.ts";
import { YahooProvider } from "#contexts/connections/internal/yahoo/YahooProvider.ts";
import { fantasyQueryScopes } from "#contexts/connections/QueryScopes.ts";
import type { TransactionReviews } from "#contexts/connections/TransactionReview.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";

const AuthLayer = AuthLive.pipe(
  Layer.provide(BetterAuthAdapter.layer),
  Layer.provide(
    Layer.succeed(AuthorizationScopes)([
      ...Object.values(connectionScopes),
      ...Object.values(fantasyQueryScopes),
    ]),
  ),
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(AuthDatabase.layer),
  Layer.provide(EmailDelivery.fromConfig),
  Layer.provide(FetchHttpClient.layer),
);
const ProviderLayer = YahooProvider;
const CredentialEncryptionLayer = ConnectionCredentialEncryption.layer;
const RepositoryLayer = ConnectionRepository.layer.pipe(Layer.provide(ConnectionsDatabase.layer));
const ConnectionsLayer = ConnectionsLive.pipe(
  Layer.provide(RepositoryLayer),
  Layer.provide(ProviderLayer),
  Layer.provide(CredentialEncryptionLayer),
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
export const ApplicationLayer = Layer.mergeAll(
  ConnectionsLayer,
  QueriesLayer,
  AuthLayer,
  ProviderLayer,
  CredentialEncryptionLayer,
  QueryTokens.layer,
).pipe(Layer.provide(PostgresLive), Layer.provide(NodeCrypto.layer));

export type BackendServices = AuthService | Connections | FantasyQueries | TransactionReviews;
