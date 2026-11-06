import { createSelectSchema } from "drizzle-orm/effect-schema";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation, Struct } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGeneration,
  ConnectionId,
  ProviderKey,
} from "#contexts/connections/Connection.ts";
import {
  FantasyLeague,
  FantasySport,
  TeamAutomation,
  TeamAutomationStatus,
  TeamAvailability,
  TeamId,
} from "#contexts/connections/FantasyTeam.ts";

import { ConnectionLifecycleState } from "./ConnectionLifecycleWorkflow.ts";
import { TeamAutomationState } from "./TeamAutomationWorkflow.ts";

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status", {
      enum: ["linking", "ready", "reconnect-required", "disconnected"],
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    credentialGeneration: integer("credential_generation"),
    reconnectRequiredAt: timestamp("reconnect_required_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_connections_user_id_id_idx").on(table.userId, table.id),
    uniqueIndex("provider_connections_user_id_request_id_idx").on(table.userId, table.requestId),
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    connectionId: text("connection_id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    generation: integer("generation").notNull(),
    envelope: text("envelope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_credentials_user_id_connection_id_idx").on(table.userId, table.connectionId),
  ],
);

export const providerTeams = pgTable(
  "provider_teams",
  {
    id: uuid("id").notNull().defaultRandom(),
    connectionId: text("connection_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    providerTeamKey: text("provider_team_key").notNull(),
    providerLeagueKey: text("provider_league_key").notNull(),
    league: text("league", { enum: ["nfl", "nhl", "mlb", "nba"] }).notNull(),
    sport: text("sport", { enum: ["football", "hockey", "baseball", "basketball"] }).notNull(),
    season: integer("season").notNull(),
    name: text("name").notNull(),
    leagueName: text("league_name"),
    providerUrl: text("provider_url"),
    availability: text("availability", { enum: ["available", "unavailable"] })
      .notNull()
      .default("available"),
    automationState: jsonb("automation_state").notNull(),
    automationStatus: text("automation_status", {
      enum: ["disabled", "enabled", "paused-until-fantasy-day-end"],
    }).notNull(),
    ownerNote: text("owner_note"),
    ownerNoteUpdatedAt: timestamp("owner_note_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.providerTeamKey] }),
    unique("provider_teams_id_unique").on(table.id),
    index("provider_teams_user_id_league_name_idx").on(table.userId, table.league, table.name),
    index("provider_teams_user_id_automation_status_idx").on(table.userId, table.automationStatus),
    index("provider_teams_automation_status_availability_idx").on(
      table.automationStatus,
      table.availability,
    ),
  ],
);

export const providerTeamAgentNotes = pgTable(
  "provider_team_agent_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => providerTeams.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    authorName: text("author_name"),
    authorClientId: text("author_client_id").notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_team_agent_notes_team_written_at_idx").on(table.teamId, table.writtenAt),
    index("provider_team_agent_notes_user_id_team_id_idx").on(table.userId, table.teamId),
  ],
);

const FantasyTeamSelect = createSelectSchema(providerTeams, {
  id: TeamId,
  connectionId: ConnectionId,
  userId: UserId,
  provider: ProviderKey,
  providerTeamKey: Schema.NonEmptyString,
  providerLeagueKey: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  leagueName: Schema.NullOr(Schema.NonEmptyString),
  providerUrl: Schema.NullOr(Schema.NonEmptyString),
  availability: TeamAvailability,
  automationState: Schema.Unknown,
  automationStatus: TeamAutomationStatus,
  ownerNote: Schema.NullOr(Schema.NonEmptyString),
  ownerNoteUpdatedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  lastSeenAt: Schema.DateTimeUtcFromDate,
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const FantasyTeamRow = FantasyTeamSelect.pipe(
  Schema.decodeTo(
    Schema.Struct({
      id: TeamId,
      connectionId: ConnectionId,
      userId: UserId,
      provider: ProviderKey,
      providerTeamKey: Schema.NonEmptyString,
      providerLeagueKey: Schema.NonEmptyString,
      league: FantasyLeague,
      sport: FantasySport,
      season: Schema.Int.check(Schema.isGreaterThan(1900)),
      name: Schema.NonEmptyString,
      leagueName: Schema.optional(Schema.NonEmptyString),
      providerUrl: Schema.optional(Schema.NonEmptyString),
      availability: TeamAvailability,
      automation: TeamAutomation,
      ownerNote: Schema.NullOr(Schema.NonEmptyString),
      ownerNoteUpdatedAt: Schema.NullOr(Schema.DateTimeUtc),
      lastSeenAt: Schema.DateTimeUtc,
      createdAt: Schema.DateTimeUtc,
      updatedAt: Schema.DateTimeUtc,
    }).pipe(Schema.toType),
    SchemaTransformation.transformEffect({
      decode: (row) =>
        Effect.gen(function* () {
          const state = yield* SchemaParser.decodeUnknownEffect(
            Schema.toCodecJson(TeamAutomationState),
          )(row.automationState);
          if (teamAutomationStateStatus(state) !== row.automationStatus) {
            return yield* Effect.die(
              new Error("The stored team automation status does not match its state"),
            );
          }
          return {
            id: row.id,
            connectionId: row.connectionId,
            userId: row.userId,
            provider: row.provider,
            providerTeamKey: row.providerTeamKey,
            providerLeagueKey: row.providerLeagueKey,
            league: row.league,
            sport: row.sport,
            season: row.season,
            name: row.name,
            ...(row.leagueName === null ? {} : { leagueName: row.leagueName }),
            ...(row.providerUrl === null ? {} : { providerUrl: row.providerUrl }),
            availability: row.availability,
            automation: automationView(state),
            ownerNote: row.ownerNote,
            ownerNoteUpdatedAt: row.ownerNoteUpdatedAt,
            lastSeenAt: row.lastSeenAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
      encode: (team) =>
        Effect.gen(function* () {
          const state = stateFromAutomation(team.automation);
          const automationState = yield* SchemaParser.encodeEffect(
            Schema.toCodecJson(TeamAutomationState),
          )(state);
          return {
            ...team,
            leagueName: team.leagueName ?? null,
            providerUrl: team.providerUrl ?? null,
            automationState,
            automationStatus: teamAutomationStateStatus(state),
          };
        }),
    }),
  ),
);

function teamAutomationStateStatus(state: TeamAutomationState): TeamAutomationStatus {
  switch (state._tag) {
    case "Disabled":
      return "disabled";
    case "Enabled":
      return "enabled";
    case "PausedUntilFantasyDayEnd":
      return "paused-until-fantasy-day-end";
  }
}

function automationView(state: TeamAutomationState): TeamAutomation {
  switch (state._tag) {
    case "Disabled":
    case "Enabled":
      return { status: teamAutomationStateStatus(state), changedAt: state.changedAt };
    case "PausedUntilFantasyDayEnd":
      return {
        status: "paused-until-fantasy-day-end",
        changedAt: state.changedAt,
        pausedAt: state.pausedAt,
        resumesAt: state.resumesAt,
        timeZone: state.timeZone,
        fantasyDay: state.fantasyDay,
        fantasyDayVersion: state.fantasyDayVersion,
      };
  }
}

function stateFromAutomation(automation: TeamAutomation): TeamAutomationState {
  switch (automation.status) {
    case "disabled":
      return { _tag: "Disabled", changedAt: automation.changedAt };
    case "enabled":
      return { _tag: "Enabled", changedAt: automation.changedAt };
    case "paused-until-fantasy-day-end":
      if (
        automation.pausedAt === undefined ||
        automation.resumesAt === undefined ||
        automation.timeZone === undefined ||
        automation.fantasyDay === undefined ||
        automation.fantasyDayVersion === undefined
      ) {
        throw new Error("A paused team is missing its fantasy-day boundary");
      }
      return {
        _tag: "PausedUntilFantasyDayEnd",
        changedAt: automation.changedAt,
        pausedAt: automation.pausedAt,
        resumesAt: automation.resumesAt,
        timeZone: automation.timeZone,
        fantasyDay: automation.fantasyDay,
        fantasyDayVersion: automation.fantasyDayVersion,
      };
  }
}

export const AgentNoteRow = createSelectSchema(providerTeamAgentNotes, {
  id: Schema.String,
  teamId: TeamId,
  connectionId: ConnectionId,
  userId: UserId,
  body: Schema.NonEmptyString,
  authorName: Schema.NullOr(Schema.NonEmptyString),
  authorClientId: Schema.NonEmptyString,
  writtenAt: Schema.DateTimeUtcFromDate,
});

const Row = createSelectSchema(providerConnections, {
  id: ConnectionId,
  userId: UserId,
  expiresAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  approvedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  credentialGeneration: Schema.NullOr(ConnectionCredentialGeneration),
  reconnectRequiredAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  disconnectedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

const Identity = Struct.pick(Row.fields, ["id", "userId", "requestId", "createdAt"]);
const LifecycleConnection = Schema.Struct({ ...Identity, state: ConnectionLifecycleState }).pipe(
  Schema.toType,
);

export const ConnectionRow = Row.pipe(
  Schema.decodeTo(
    LifecycleConnection,
    SchemaTransformation.transformEffect<typeof LifecycleConnection.Type, typeof Row.Type>({
      decode: (row) => {
        const content = {
          provider: row.provider,
          updatedAt: row.updatedAt,
        };
        const state = (() => {
          switch (row.status) {
            case "linking":
              return { _tag: "Linking", ...content, expiresAt: row.expiresAt };
            case "ready":
              return {
                _tag: "Ready",
                ...content,
                approvedAt: row.approvedAt,
                credentialGeneration: row.credentialGeneration,
              };
            case "reconnect-required":
              return {
                _tag: "ReconnectRequired",
                ...content,
                reconnectRequiredAt: row.reconnectRequiredAt,
                credentialGeneration: row.credentialGeneration,
              };
            case "disconnected":
              return { _tag: "Disconnected", ...content, disconnectedAt: row.disconnectedAt };
          }
        })();
        return SchemaParser.decodeUnknownEffect(ConnectionLifecycleState)(state).pipe(
          Effect.map((state) => ({
            id: row.id,
            userId: row.userId,
            requestId: row.requestId,
            createdAt: row.createdAt,
            state,
          })),
        );
      },
      encode: ({ state, ...identity }) =>
        Effect.succeed(
          (() => {
            switch (state._tag) {
              case "Linking":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "linking" as const,
                  expiresAt: state.expiresAt,
                  approvedAt: null,
                  credentialGeneration: null,
                  reconnectRequiredAt: null,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "Ready":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "ready" as const,
                  expiresAt: null,
                  approvedAt: state.approvedAt,
                  credentialGeneration: state.credentialGeneration,
                  reconnectRequiredAt: null,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "ReconnectRequired":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "reconnect-required" as const,
                  expiresAt: null,
                  approvedAt: null,
                  credentialGeneration: state.credentialGeneration,
                  reconnectRequiredAt: state.reconnectRequiredAt,
                  disconnectedAt: null,
                  updatedAt: state.updatedAt,
                };
              case "Disconnected":
                return {
                  ...identity,
                  provider: state.provider,
                  status: "disconnected" as const,
                  expiresAt: null,
                  approvedAt: null,
                  credentialGeneration: null,
                  reconnectRequiredAt: null,
                  disconnectedAt: state.disconnectedAt,
                  updatedAt: state.updatedAt,
                };
            }
          })(),
        ),
    }),
  ),
);
