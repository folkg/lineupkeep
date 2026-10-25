import { Context, Schema } from "effect";
import type { Effect, Redacted } from "effect";

const ProviderSport = Schema.Literals(["football", "hockey"]);
type ProviderSport = typeof ProviderSport.Type;

const ProviderLeague = Schema.Literals(["nfl", "nhl"]);
type ProviderLeague = typeof ProviderLeague.Type;

const ProviderOperation = Schema.Literals(["validate_session", "discover_teams", "read_crumb"]);
type ProviderOperation = typeof ProviderOperation.Type;

export const ProviderSessionMaterial = Schema.Struct({
  provider: Schema.Literals(["yahoo"]),
  session: Schema.Redacted(Schema.String),
});
export type ProviderSessionMaterial = typeof ProviderSessionMaterial.Type;

export const ProviderTeam = Schema.Struct({
  provider: Schema.Literals(["yahoo"]),
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: ProviderLeague,
  sport: ProviderSport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
});
export type ProviderTeam = typeof ProviderTeam.Type;

type ProviderCrumb = {
  readonly crumb: Redacted.Redacted<string>;
};

type ProviderFailure = ProviderSessionRejected | ProviderRequestFailed | ProviderResponseInvalid;

export class ProviderSessionRejected extends Schema.TaggedError<
  ProviderSessionRejected,
  { readonly brand: unique symbol }
>()("provider.session_rejected", {
  operation: ProviderOperation,
}) {}

export class ProviderRequestFailed extends Schema.TaggedError<
  ProviderRequestFailed,
  { readonly brand: unique symbol }
>()("provider.request_failed", {
  operation: ProviderOperation,
}) {}

export class ProviderResponseInvalid extends Schema.TaggedError<
  ProviderResponseInvalid,
  { readonly brand: unique symbol }
>()("provider.response_invalid", {
  operation: ProviderOperation,
}) {}

export class ProviderCrumbUnavailable extends Schema.TaggedError<
  ProviderCrumbUnavailable,
  { readonly brand: unique symbol }
>()("provider.crumb_unavailable", {
  operation: ProviderOperation,
}) {}

export type ProviderGatewayShape = {
  readonly validateSession: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<void, ProviderFailure>;

  readonly discoverTeams: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<ReadonlyArray<ProviderTeam>, ProviderFailure>;

  readonly readCrumb: (
    input: ProviderSessionMaterial,
  ) => Effect.Effect<ProviderCrumb, ProviderFailure | ProviderCrumbUnavailable>;
};

export class ProviderGateway extends Context.Service<ProviderGateway, ProviderGatewayShape>()(
  "@lineupkeep/backend/contexts/connections/Provider/ProviderGateway",
) {}
