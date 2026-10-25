import { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect, Redacted } from "effect";

import { ConnectionId } from "./Connection.ts";
import type { ConnectionError, ProviderConnection } from "./Connection.ts";

export const HostedLinkingSessionId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("HostedLinkingSessionId"),
);
export type HostedLinkingSessionId = typeof HostedLinkingSessionId.Type;

export const HostedLinkingSessionStatus = Schema.Literals([
  "active",
  "completing",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);
export type HostedLinkingSessionStatus = typeof HostedLinkingSessionStatus.Type;

export const HostedLinkingFailureReason = Schema.Literals([
  "session_rejected",
  "provider_unavailable",
  "link_expired",
  "connection_unavailable",
  "persistence_failed",
]);
export type HostedLinkingFailureReason = typeof HostedLinkingFailureReason.Type;

const SessionTimestamp = Schema.DateTimeUtc;

export const HostedLinkingSession = Schema.Struct({
  id: HostedLinkingSessionId,
  userId: UserId,
  connectionId: ConnectionId,
  provider: Schema.Literals(["yahoo"]),
  status: HostedLinkingSessionStatus,
  startedAt: SessionTimestamp,
  expiresAt: SessionTimestamp,
  completedAt: Schema.optional(SessionTimestamp),
  cancelledAt: Schema.optional(SessionTimestamp),
  expiredAt: Schema.optional(SessionTimestamp),
  failedAt: Schema.optional(SessionTimestamp),
  failureReason: Schema.optional(HostedLinkingFailureReason),
  createdAt: SessionTimestamp,
  updatedAt: SessionTimestamp,
});
export type HostedLinkingSession = typeof HostedLinkingSession.Type;

export const StartHostedLinkingInput = Schema.Struct({
  provider: Schema.Literals(["yahoo"]),
});
export type StartHostedLinkingInput = typeof StartHostedLinkingInput.Type;

export const HostedLinkingSessionInput = Schema.Struct({
  id: HostedLinkingSessionId,
});
export type HostedLinkingSessionInput = typeof HostedLinkingSessionInput.Type;

export const HostedLinkingTicket = Schema.String.pipe(
  Schema.check(Schema.isMinLength(32), Schema.isMaxLength(128)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/u)),
);
export type HostedLinkingTicket = typeof HostedLinkingTicket.Type;

const AuthorizeHostedLinkingInput = Schema.Struct({
  id: HostedLinkingSessionId,
  ticket: HostedLinkingTicket,
});
type AuthorizeHostedLinkingInput = typeof AuthorizeHostedLinkingInput.Type;

const ProviderSessionValue = Schema.RedactedFromValue(
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))),
);

export const CompleteHostedLinkingInput = Schema.Struct({
  id: HostedLinkingSessionId,
  ticket: HostedLinkingTicket,
  provider: Schema.Literals(["yahoo"]),
  session: ProviderSessionValue,
});
export type CompleteHostedLinkingInput = typeof CompleteHostedLinkingInput.Type;

type StartedHostedLinking = {
  readonly session: HostedLinkingSession;
  readonly ticket: Redacted.Redacted<string>;
};

type HostedLinkingCompletion = {
  readonly session: HostedLinkingSession;
  readonly connection: ProviderConnection;
  readonly teamsDiscovered: number;
};

export class HostedLinkingNotFound extends Schema.TaggedError<
  HostedLinkingNotFound,
  { readonly brand: unique symbol }
>()("hosted_linking.not_found", {
  id: HostedLinkingSessionId,
}) {}

export class HostedLinkingTicketRejected extends Schema.TaggedError<
  HostedLinkingTicketRejected,
  { readonly brand: unique symbol }
>()("hosted_linking.ticket_rejected", {
  id: HostedLinkingSessionId,
}) {}

export class HostedLinkingExpired extends Schema.TaggedError<
  HostedLinkingExpired,
  { readonly brand: unique symbol }
>()("hosted_linking.expired", {
  id: HostedLinkingSessionId,
}) {}

export class HostedLinkingNotActive extends Schema.TaggedError<
  HostedLinkingNotActive,
  { readonly brand: unique symbol }
>()("hosted_linking.not_active", {
  id: HostedLinkingSessionId,
  status: HostedLinkingSessionStatus,
}) {}

export class HostedLinkingSessionActive extends Schema.TaggedError<
  HostedLinkingSessionActive,
  { readonly brand: unique symbol }
>()("hosted_linking.session_active", {}) {}

export class HostedLinkingRateLimited extends Schema.TaggedError<
  HostedLinkingRateLimited,
  { readonly brand: unique symbol }
>()("hosted_linking.rate_limited", {}) {}

export class HostedLinkingPersistenceFailed extends Schema.TaggedError<
  HostedLinkingPersistenceFailed,
  { readonly brand: unique symbol }
>()("hosted_linking.persistence_failed", {
  cause: Schema.Defect(),
}) {}

export type HostedLinkingError =
  | HostedLinkingNotFound
  | HostedLinkingTicketRejected
  | HostedLinkingExpired
  | HostedLinkingNotActive
  | HostedLinkingSessionActive
  | HostedLinkingRateLimited
  | HostedLinkingPersistenceFailed;

export class HostedLinking extends Context.Service<HostedLinking, HostedLinkingShape>()(
  "@lineupkeep/backend/contexts/connections/HostedLinking",
) {}

export type HostedLinkingShape = {
  readonly start: (
    userId: UserId,
    input: StartHostedLinkingInput,
  ) => Effect.Effect<StartedHostedLinking, HostedLinkingError | ConnectionError>;

  readonly authorize: (
    userId: UserId,
    input: AuthorizeHostedLinkingInput,
  ) => Effect.Effect<HostedLinkingSession, HostedLinkingError | ConnectionError>;

  readonly complete: (
    userId: UserId,
    input: CompleteHostedLinkingInput,
  ) => Effect.Effect<HostedLinkingCompletion, HostedLinkingError | ConnectionError>;

  readonly cancel: (
    userId: UserId,
    inputs: ReadonlyArray<HostedLinkingSessionInput>,
  ) => Effect.Effect<ReadonlyArray<HostedLinkingSession>, HostedLinkingError | ConnectionError>;

  readonly expire: (
    userId: UserId,
    inputs: ReadonlyArray<HostedLinkingSessionInput>,
  ) => Effect.Effect<ReadonlyArray<HostedLinkingSession>, HostedLinkingError | ConnectionError>;

  readonly fail: (
    userId: UserId,
    input: HostedLinkingSessionInput,
    reason: HostedLinkingFailureReason,
  ) => Effect.Effect<HostedLinkingSession, HostedLinkingError | ConnectionError>;
};
