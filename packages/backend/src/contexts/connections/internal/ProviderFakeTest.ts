import { Context, Deferred, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type { ProviderTeam } from "#contexts/connections/Provider.ts";

type FakeDiscoveryGate = {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
};

type FakeProviderState = {
  readonly sessionRejected: boolean;
  readonly teams: ReadonlyArray<ProviderTeam>;
  readonly requestFailure: FakeRequestFailure | undefined;
  readonly crumbAvailable: boolean;
  readonly discoveryGate: Option.Option<FakeDiscoveryGate>;
};

export type FakeProviderWorldShape = {
  readonly state: Ref.Ref<FakeProviderState>;
  readonly rejectSession: (rejected: boolean) => Effect.Effect<void>;
  readonly setTeams: (teams: ReadonlyArray<ProviderTeam>) => Effect.Effect<void>;
  readonly failRequests: (failure: FakeRequestFailure | undefined) => Effect.Effect<void>;
  readonly setCrumbAvailable: (available: boolean) => Effect.Effect<void>;
  readonly blockDiscovery: Effect.Effect<FakeDiscoveryGate>;
  readonly unblockDiscovery: Effect.Effect<void>;
};

export class FakeProviderWorld extends Context.Service<FakeProviderWorld, FakeProviderWorldShape>()(
  "@lineupkeep/backend/contexts/connections/internal/ProviderFakeTest/FakeProviderWorld",
) {
  static readonly layer = Layer.effect(
    FakeProviderWorld,
    Effect.gen(function* () {
      const state = yield* Ref.make<FakeProviderState>({
        sessionRejected: false,
        teams: [],
        requestFailure: undefined,
        crumbAvailable: true,
        discoveryGate: Option.none(),
      });
      const modify = (
        update: (current: FakeProviderState) => FakeProviderState,
      ): Effect.Effect<void> => Ref.update(state, update);
      return {
        state,
        rejectSession: (rejected) =>
          modify((current) => ({ ...current, sessionRejected: rejected })),
        setTeams: (teams) => modify((current) => ({ ...current, teams })),
        failRequests: (requestFailure) => modify((current) => ({ ...current, requestFailure })),
        setCrumbAvailable: (crumbAvailable) =>
          modify((current) => ({ ...current, crumbAvailable })),
        blockDiscovery: Effect.gen(function* () {
          const gate: FakeDiscoveryGate = {
            started: yield* Deferred.make<void>(),
            release: yield* Deferred.make<void>(),
          };
          yield* modify((current) => ({ ...current, discoveryGate: Option.some(gate) }));
          return gate;
        }),
        unblockDiscovery: modify((current) => ({ ...current, discoveryGate: Option.none() })),
      } satisfies FakeProviderWorldShape;
    }),
  );
}

export const ProviderFakeTest = Layer.effect(
  ProviderGateway,
  Effect.gen(function* () {
    const world = yield* FakeProviderWorld;
    return ProviderGateway.of({
      validateSession: Effect.fn("FakeProvider.validateSession")(function* (input) {
        yield* validate(input, "validate_session");
        const current = yield* Ref.get(world.state);
        if (current.sessionRejected) {
          return yield* ProviderSessionRejected.make({ operation: "validate_session" });
        }
        yield* requestFailure(current, "validate_session");
      }),
      discoverTeams: Effect.fn("FakeProvider.discoverTeams")(function* (input) {
        yield* validate(input, "discover_teams");
        const current = yield* Ref.get(world.state);
        if (current.sessionRejected) {
          return yield* ProviderSessionRejected.make({ operation: "discover_teams" });
        }
        yield* requestFailure(current, "discover_teams");
        const gate = Option.getOrUndefined(current.discoveryGate);
        if (gate !== undefined) {
          yield* Deferred.succeed(gate.started, undefined);
          yield* Deferred.await(gate.release);
        }
        const latest = yield* Ref.get(world.state);
        return latest.teams;
      }),
      readCrumb: Effect.fn("FakeProvider.readCrumb")(function* (input) {
        yield* validate(input, "read_crumb");
        const current = yield* Ref.get(world.state);
        if (current.sessionRejected) {
          return yield* ProviderSessionRejected.make({ operation: "read_crumb" });
        }
        yield* requestFailure(current, "read_crumb");
        if (!current.crumbAvailable) {
          return yield* ProviderCrumbUnavailable.make({ operation: "read_crumb" });
        }
        return { crumb: Redacted.make("fake-provider-crumb") };
      }),
    });
  }),
).pipe(Layer.provideMerge(FakeProviderWorld.layer));

function validate(
  input: ProviderSessionMaterial,
  operation: "validate_session" | "discover_teams" | "read_crumb",
): Effect.Effect<void, ProviderSessionRejected> {
  return Schema.decodeEffect(ProviderSessionMaterial)(input).pipe(
    Effect.flatMap((decoded) =>
      Redacted.value(decoded.session).length === 0
        ? ProviderSessionRejected.make({ operation })
        : Effect.void,
    ),
    Effect.mapError(() => ProviderSessionRejected.make({ operation })),
  );
}

function requestFailure(
  state: FakeProviderState,
  operation: "validate_session" | "discover_teams" | "read_crumb",
): Effect.Effect<void, ProviderRequestFailed | ProviderResponseInvalid> {
  switch (state.requestFailure) {
    case "unavailable":
      return ProviderRequestFailed.make({ operation });
    case "invalid_response":
      return ProviderResponseInvalid.make({ operation });
    case undefined:
      return Effect.void;
  }
}

type FakeRequestFailure = "unavailable" | "invalid_response";
