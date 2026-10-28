import { DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import type {
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderReadFailure,
  ProviderReviewIntent,
} from "#contexts/connections/Provider.ts";
import type { Provider } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import {
  type CounterpartyRef,
  type PlayerRef,
  type QueryCoverage,
  type QueryFailure,
  type QueryPage,
  type QueryTeam,
} from "#contexts/connections/QueryValues.ts";
import { TransactionReviews } from "#contexts/connections/TransactionReview.ts";
import type {
  ReviewIntent,
  ReviewLink,
  ReviewLinksData,
  TransactionReviewInput,
} from "#contexts/connections/TransactionReview.ts";
import { ReviewLinksData as ReviewLinksSchema } from "#contexts/connections/TransactionReview.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { fitPage, queryBudget } from "./QueryBudget.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type { OwnedTeam } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";

type ReadOutcome<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "unsupported"; readonly detail: string }
  | { readonly _tag: "failed"; readonly failure: QueryFailure };

const humanReviewInstruction =
  "Open each review link in your browser and review the proposal in the provider's own interface. Lineupkeep cannot submit transactions, and a prefilled review page does not guarantee that the provider will accept the proposal.";

export const TransactionReviewsLive = Layer.effect(
  TransactionReviews,
  Effect.gen(function* () {
    const repository = yield* QueryRepository;
    const registry = yield* ProviderRegistry;
    const encryption = yield* ConnectionCredentialEncryption;
    const tokens = yield* QueryTokens;

    const readOutcome = <A>(
      context: TeamContext,
      resource: string,
      program: Effect.Effect<A, ProviderReadFailure>,
    ): Effect.Effect<ReadOutcome<A>> =>
      Effect.matchEffect(program, {
        onSuccess: (value) => Effect.succeed<ReadOutcome<A>>({ _tag: "ok", value }),
        onFailure: (error) => {
          switch (error._tag) {
            case "provider.operation_unsupported":
              return Effect.succeed<ReadOutcome<A>>({ _tag: "unsupported", detail: error.reason });
            case "provider.session_rejected":
              return repository.recordSessionRejected(context.userId, context.owned).pipe(
                Effect.as<ReadOutcome<A>>({
                  _tag: "failed",
                  failure: {
                    code: "provider_session_rejected",
                    resource,
                    message:
                      "The provider rejected the stored session. Reconnect the connection and try again.",
                  },
                }),
              );
            case "provider.request_failed":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "provider_unavailable",
                  resource,
                  message: "The provider could not be reached.",
                },
              });
            case "provider.response_invalid":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "provider_invalid_response",
                  resource,
                  message:
                    "The provider returned data that could not be verified for this request.",
                },
              });
            case "provider.period_mismatch":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "period_unavailable",
                  resource,
                  message: "The provider did not return the requested period.",
                },
              });
          }
        },
      });

    const readLeague = (context: TeamContext): Effect.Effect<ReadOutcome<ProviderLeagueSettings>> =>
      Effect.gen(function* () {
        const outcome = yield* readOutcome(
          context,
          "league",
          context.provider.readLeague({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            sport: context.owned.team.sport,
          }),
        );
        if (outcome._tag !== "ok" || outcome.value.season === context.owned.team.season) {
          return outcome;
        }
        return {
          _tag: "failed" as const,
          failure: {
            code: "league_season_mismatch",
            resource: "league",
            message: "The provider league season does not match the linked team.",
          },
        };
      });

    const generate = Effect.fn("TransactionReviews.generate")(function* (
      userId: UserId,
      input: TransactionReviewInput,
    ) {
      const context = yield* loadTeamContext(repository, encryption, registry, userId, input.team);
      const team = queryTeam(context.owned);
      const linkTemplate = {
        provider: context.owned.team.provider,
        version: context.provider.reviewLinkTemplate.version,
      };
      const fetchedAt = yield* DateTime.now;
      const leagueOutcome = yield* readLeague(context);
      if (leagueOutcome._tag !== "ok") {
        return reviewWithoutData(team, linkTemplate, fetchedAt, leagueOutcome);
      }
      const league = leagueOutcome.value;
      const rosterOutcome = yield* readOutcome(
        context,
        "roster",
        context.provider.readRoster({
          ...providerIdentity(context),
          providerTeamKey: context.owned.team.providerTeamKey,
          period: undefined,
        }),
      );
      const roster = rosterOutcome._tag === "ok" ? rosterOutcome.value : undefined;
      const rosterKeys = new Set(roster?.players.map((player) => player.providerPlayerKey) ?? []);
      const failures: QueryFailure[] =
        rosterOutcome._tag === "failed" ? [rosterOutcome.failure] : [];
      const coverageEntries: QueryCoverage[] = [
        coverage("league", "league_settings", fetchedAt),
        rosterOutcome._tag === "ok"
          ? coverage("roster", "roster", fetchedAt)
          : unsupportedCoverage("roster", "roster", fetchedAt),
      ];

      let leagueTeams: ReadonlyArray<ProviderLeagueTeam> | undefined;
      let leagueTeamsUnsupported: string | undefined;
      if (input.intents.some((intent) => intent.kind === "trade")) {
        const teamsOutcome = yield* readOutcome(
          context,
          "league_teams",
          context.provider.readLeagueTeams({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
          }),
        );
        if (teamsOutcome._tag === "ok") {
          leagueTeams = teamsOutcome.value;
          coverageEntries.push(coverage("league_teams", "league_teams", fetchedAt));
        } else {
          leagueTeamsUnsupported =
            teamsOutcome._tag === "unsupported"
              ? teamsOutcome.detail
              : teamsOutcome.failure.message;
          coverageEntries.push(unsupportedCoverage("league_teams", "league_teams", fetchedAt));
          if (teamsOutcome._tag === "failed") {
            failures.push(teamsOutcome.failure);
          }
        }
      }

      const links = yield* Effect.forEach(
        input.intents,
        (intent, index) =>
          reviewLink(
            context,
            tokens,
            context.provider,
            league,
            context.owned.team.sport,
            rosterKeys,
            leagueTeams,
            leagueTeamsUnsupported,
            intent,
            index,
          ),
        { concurrency: 1 },
      );
      const reviewOnly = links.filter((link) => link.status === "review_only").length;
      const status =
        reviewOnly > 0
          ? "ok"
          : links.some((link) => link.status === "unsupported")
            ? "unsupported"
            : "failed";
      const fingerprintValue = yield* queryFingerprint(
        `review_links|team=${input.team}|intents=${input.intents.map((intent) => intent.kind).join(",")}|order=request`,
      );
      const now = yield* DateTime.now;
      const base: Omit<ReviewLinksData, "links" | "page"> = {
        status,
        team,
        linkTemplate,
        instruction: humanReviewInstruction,
        coverage: coverageEntries,
        failures,
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: ReviewLinksSchema,
        rows: links,
        offset: 0,
        limit: 5,
        resource: "review_links",
        groups: input.intents.map((intent) => intent.kind),
        build: (pageRows, page) => ({ ...base, links: [...pageRows], page }),
        makeNext: () =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: 5, now }),
        recordLabel: (row) => row.kind,
      });
    });

    return TransactionReviews.of({ generate });
  }),
);

function reviewLink(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  provider: Provider,
  league: ProviderLeagueSettings,
  sport: FantasySport,
  rosterKeys: ReadonlySet<string>,
  leagueTeams: ReadonlyArray<ProviderLeagueTeam> | undefined,
  leagueTeamsUnsupported: string | undefined,
  intent: ReviewIntent,
  index: number,
): Effect.Effect<ReviewLink> {
  return Effect.gen(function* () {
    const unsupported = (
      detail: string,
      players: ReadonlyArray<PlayerRef>,
      counterparty?: CounterpartyRef,
    ): ReviewLink =>
      ({
        status: "unsupported" as const,
        index,
        kind: intent.kind,
        players,
        ...(counterparty === undefined ? {} : { counterparty }),
        detail,
      }) satisfies ReviewLink;

    switch (intent.kind) {
      case "add": {
        const add = yield* openPlayer(tokens, context, intent.add);
        if (add._tag === "invalid") {
          return unsupported(add.detail, [intent.add]);
        }
        return yield* buildLink(
          provider,
          league,
          context.owned.team.providerTeamKey,
          sport,
          intent.kind,
          { kind: "add", add: add.value },
          [intent.add],
          index,
        );
      }
      case "drop": {
        const drop = yield* openPlayer(tokens, context, intent.drop);
        if (drop._tag === "invalid") {
          return unsupported(drop.detail, [intent.drop]);
        }
        if (!rosterKeys.has(drop.value)) {
          return unsupported("The player to drop is not on the selected roster.", [intent.drop]);
        }
        return yield* buildLink(
          provider,
          league,
          context.owned.team.providerTeamKey,
          sport,
          intent.kind,
          { kind: "drop", drop: drop.value },
          [intent.drop],
          index,
        );
      }
      case "add_drop": {
        const add = yield* openPlayer(tokens, context, intent.add);
        const drop = yield* openPlayer(tokens, context, intent.drop);
        if (add._tag === "invalid" || drop._tag === "invalid") {
          return unsupported(
            add._tag === "invalid" ? add.detail : drop._tag === "invalid" ? drop.detail : "",
            [intent.add, intent.drop],
          );
        }
        if (!rosterKeys.has(drop.value)) {
          return unsupported("The player to drop is not on the selected roster.", [
            intent.add,
            intent.drop,
          ]);
        }
        return yield* buildLink(
          provider,
          league,
          context.owned.team.providerTeamKey,
          sport,
          intent.kind,
          { kind: "add_drop", add: add.value, drop: drop.value },
          [intent.add, intent.drop],
          index,
        );
      }
      case "trade": {
        const players = [...intent.send, ...intent.receive];
        const send = yield* Effect.forEach(intent.send, (ref) => openPlayer(tokens, context, ref), {
          concurrency: 1,
        });
        const receive = yield* Effect.forEach(
          intent.receive,
          (ref) => openPlayer(tokens, context, ref),
          { concurrency: 1 },
        );
        const invalid = [...send, ...receive].find((result) => result._tag === "invalid");
        if (invalid !== undefined) {
          return unsupported(invalid.detail, players, intent.counterparty);
        }
        const sendKeys = send.flatMap((result) => (result._tag === "valid" ? [result.value] : []));
        const receiveKeys = receive.flatMap((result) =>
          result._tag === "valid" ? [result.value] : [],
        );
        if (sendKeys.some((key) => !rosterKeys.has(key))) {
          return unsupported(
            "A player to send is not on the selected roster.",
            players,
            intent.counterparty,
          );
        }
        const counterparty = yield* tokens
          .openCounterpartyRef({
            userId: context.userId,
            leagueKey: context.owned.team.providerLeagueKey,
            ref: intent.counterparty,
          })
          .pipe(
            Effect.map((teamKey) => ({ _tag: "valid" as const, value: teamKey })),
            Effect.catchTag("query.reference_invalid", () =>
              Effect.succeed({ _tag: "invalid" as const }),
            ),
          );
        if (counterparty._tag === "invalid") {
          return unsupported(
            "The counterparty reference is invalid for this league.",
            players,
            intent.counterparty,
          );
        }
        if (leagueTeamsUnsupported !== undefined || leagueTeams === undefined) {
          return unsupported(
            leagueTeamsUnsupported ?? "League team membership is not available for this provider.",
            players,
            intent.counterparty,
          );
        }
        if (counterparty.value === context.owned.team.providerTeamKey) {
          return unsupported(
            "Select another league team as the trade counterparty.",
            players,
            intent.counterparty,
          );
        }
        if (!leagueTeams.some((team) => team.providerTeamKey === counterparty.value)) {
          return unsupported(
            "The counterparty is not a member of the selected league.",
            players,
            intent.counterparty,
          );
        }
        return yield* buildLink(
          provider,
          league,
          context.owned.team.providerTeamKey,
          sport,
          intent.kind,
          { kind: "trade", send: sendKeys, receive: receiveKeys },
          players,
          index,
          intent.counterparty,
        );
      }
    }
  });
}

function buildLink(
  provider: Provider,
  league: ProviderLeagueSettings,
  providerTeamKey: string,
  sport: FantasySport,
  kind: ReviewIntent["kind"],
  providerIntent: ProviderReviewIntent,
  players: ReadonlyArray<PlayerRef>,
  index: number,
  counterparty?: CounterpartyRef,
): Effect.Effect<ReviewLink> {
  return provider
    .buildReviewLink({
      providerLeagueKey: league.providerLeagueKey,
      providerTeamKey,
      leagueWebUrl: league.webUrl,
      sport,
      intent: providerIntent,
    })
    .pipe(
      Effect.flatMap((url) =>
        safeReviewUrl(url)
          ? Effect.succeed<ReviewLink>({
              status: "review_only",
              index,
              kind,
              url,
              players,
              ...(counterparty === undefined ? {} : { counterparty }),
              humanReview: humanReviewInstruction,
            })
          : Effect.succeed<ReviewLink>({
              status: "unsupported",
              index,
              kind,
              players,
              ...(counterparty === undefined ? {} : { counterparty }),
              detail:
                "The provider review link did not meet the review-only safety check, so it was not returned.",
            }),
      ),
      Effect.catchTag("provider.review_link_invalid", (error) =>
        Effect.succeed<ReviewLink>({
          status: "unsupported",
          index,
          kind,
          players,
          ...(counterparty === undefined ? {} : { counterparty }),
          detail:
            error.reason === "unsupported-player-key"
              ? "A player key in this intent cannot be mapped to a provider review link."
              : error.reason === "unsupported-team-key"
                ? "The selected team cannot be mapped to a provider review link."
                : error.reason === "unsupported-league-url"
                  ? "The provider league page cannot be used for a review link."
                  : kind === "trade"
                    ? "This provider publishes no parameterized trade proposal page, so a prefilled trade review link is not available. Propose the trade in the provider's own interface."
                    : "The provider review surface is not supported for this intent.",
        }),
      ),
    );
}

function openPlayer(
  tokens: QueryTokens["Service"],
  context: TeamContext,
  ref: PlayerRef,
): Effect.Effect<
  | { readonly _tag: "valid"; readonly value: string }
  | { readonly _tag: "invalid"; readonly detail: string }
> {
  return tokens
    .openPlayerRef({
      userId: context.userId,
      leagueKey: context.owned.team.providerLeagueKey,
      ref,
    })
    .pipe(
      Effect.map((value) => ({ _tag: "valid" as const, value })),
      Effect.catchTag("query.reference_invalid", () =>
        Effect.succeed({
          _tag: "invalid" as const,
          detail: "A player reference is invalid for this team and owner.",
        }),
      ),
    );
}

function safeReviewUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  const forbidden = ["submit", "confirm", "transaction", "execute"];
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    !url.pathname.split("/").some((segment) => forbidden.includes(segment.toLocaleLowerCase()))
  );
}

function queryTeam(owned: OwnedTeam): QueryTeam {
  return {
    id: owned.team.id,
    name: owned.team.name,
    provider: owned.team.provider,
    league: owned.team.league,
    sport: owned.team.sport,
    season: owned.team.season,
  };
}

function reviewWithoutData(
  team: QueryTeam,
  linkTemplate: ReviewLinksData["linkTemplate"],
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderLeagueSettings>,
): ReviewLinksData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    linkTemplate,
    links: [],
    instruction: humanReviewInstruction,
    coverage: [
      outcome._tag === "ok"
        ? coverage("league", "league_settings", fetchedAt)
        : unsupportedCoverage("league", "league_settings", fetchedAt),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
    page: emptyPage(),
    budget: queryBudget,
  };
}

function coverage(resource: string, source: string, fetchedAt: DateTime.Utc): QueryCoverage {
  return { resource, status: "available", source, fetchedAt };
}

function unsupportedCoverage(
  resource: string,
  source: string,
  fetchedAt: DateTime.Utc,
): QueryCoverage {
  return { resource, status: "unsupported", source, fetchedAt };
}

function emptyPage(): QueryPage {
  return { returned: 0, complete: true, remaining: 0 };
}

function queryFingerprint(value: string): Effect.Effect<string> {
  return Effect.promise(() =>
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(value))
      .then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
  );
}
