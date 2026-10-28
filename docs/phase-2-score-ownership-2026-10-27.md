# Phase 2 provider score ownership (2026-10-27)

This is the delivery record for the score-ownership cut. The current capability name and outcome shape
are recorded below; later amendments added the games-played facts and the six-rung availability ladder,
and reserve transits are now written rather than refused.

A provider exposes the result of its own scoring: one final signed score per player and the
availability tier the solver needs, or a refusal. How that score is constructed — which value source
wins, which periods it reads, how a missing player is treated — stays inside the provider. The
decision and its rejected alternatives are
[ADR 0009](fantasy-manager/adr/0009-provider-score-ownership.md); the field-by-field second pass over
every remaining seam concept is in the
[provider boundary audit](fantasy-manager/PROVIDER-BOUNDARY-AUDIT.md).

**Privacy:** this record contains no provider keys, team or league identifiers, player names,
cookies, crumbs, payloads, or database URLs.

## The seam

Before, planning returned a plan, the scoring basis that produced it, and per-player details the
generic layer read back:

```ts
type ProviderScoreOutcome =
  | { kind: "scored"; provenance; players; gamesPlayed }
  | { kind: "refused"; refusal; provenance; detail };
```

Now it returns a result:

```ts
type ProviderScoreOutcome =
  | {
      kind: "scored";
      provenance: string;
      players: ReadonlyArray<ProviderPlayerScore>;
      gamesPlayed: ReadonlyArray<ProviderGamesPlayed>;
    }
  | { kind: "refused"; refusal: "structural" | "transient"; provenance: string; detail: string };

type ProviderPlayerScore = {
  readonly providerPlayerKey: string;
  readonly score: number | null;
  readonly availability:
    | "confirmed-start"
    | "will-play"
    | "might-play"
    | "unlikely-to-play"
    | "will-not-play"
    | "not-scheduled";
};
```

`score: null` means the provider has no usable value for that player; the solver still decides, and
refuses if a required slot cannot be filled. Provenance is an opaque label the provider chooses; the
generic layer stores, displays, and migrates it without parsing or enumerating it.

The generic layer keeps what it genuinely needs for a decision that is not provider-specific: the
league's declared slots (`starting` / `bench` / `reserve`, capacity, eligible positions), each
player's eligible positions, current slot, and whether the player is editable. That is the input the
solver needs and the shape every provider's roster read must produce.

## What moved

| Concept                                                 | Now lives in                                     | Why                                                           |
| ------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `@lineupkeep/lineup-scoring` (exact values, valuations) | `contexts/connections/internal/provider-scoring` | how one provider constructs a score                           |
| `@lineupkeep/lineup-policy` (scheme ladder)             | `contexts/connections/internal/provider-scoring` | which source a provider prefers, and how it degrades          |
| `ProviderCapabilities.publishesCommunityStartRate`      | the Yahoo adapter                                | nothing generic read it; it named one provider's value source |
| `ProviderCapabilities.statBases`                        | the Yahoo adapter                                | only the provider's own scoring read it                       |
| `ProviderPlayerReadInput.startRateCoverage`             | the Yahoo adapter                                | only the provider's own scoring read it                       |
| `ProviderPlayerDetail.communityStartRate`               | the Yahoo adapter                                | a provider-specific crowd share, not a neutral fact           |
| `ProviderRoster` flex flag                              | the Yahoo adapter                                | slot structure already carries what the solver needs          |
| run `basis` (scheme, code, periods)                     | provider label in `LineupPlanProvenance`         | provenance is the provider's business                         |

`@lineupkeep/lineup-solver` stays top-level: it is assignment mathematics over scores, slots,
eligibility, and availability tiers, with no provider knowledge and no provider imports.

The `planAssignments` step that remains generic takes the provider's slots and final scores and
translates the solver's plan into changed assignments. Reserve eligibility is the provider's published
eligibility, and a reserve transit is written like any other changed assignment; the provider accepted
both directions on 2026-10-27.

Team automation stores `fantasyDayVersion` where it stored `policyVersion`. Between the ordinary
"unfinished workbench" rules and a paid lineup policy there is no shared version concept, so the
field now names what it versions.

## Migration

`packages/backend/migrations/20261027093000_lineup_plan_provenance` rewrites stored run state and
write intents from `policy` to `provenance` and team automation state from `policyVersion` to
`fantasyDayVersion`. Completed runs keep the label they recorded, so historical runs read the same
before and after.

## Verification

Local, before deploy:

- `bun checks`: format, lint, types, dependency rules, unit and browser suites, build.
- `bun run test:node` 96 files / 1191 tests, `test:browser` 15 files / 61 tests, `test:chromium`
  3 files / 7 tests.
- `bun run architecture`: 529 modules, 2058 dependencies, no violations.
- `bun run knip` and `knip:production`: clean.
- `bun run test:e2e`, `test:e2e:container`, `test:e2e:cloudflare` run serially.

Enforcement proved in the real tree and then reverted: a scoring import added to
`internal/LineupPlanning.ts` is rejected by `provider-scoring-stays-in-the-adapter`, and a scoring
term added to a generic contract module is rejected by `repository/provider-scoring-vocabulary`. Both
outputs are quoted in the [audit](fantasy-manager/PROVIDER-BOUNDARY-AUDIT.md).

## Deploy

- database and platform stacks: no changes.
- Cloud Run stage: web `lineupkeepweb-web-cloud-run-aptkd6b27csgvtcc-00020-t7w`, worker
  `lineupkeepweb-worker-cloud-run-hxmx3xmymjecuw3y-00021-wcc`, browser `lineupkeep-hb-00007-22n`.
- image `us-east1-docker.pkg.dev/lineupkeep-prod/lineupkeepweb-registry-cloud-run-u4rplfecdzi27v3w/web:532810e7e05b9afcc86d52cc506b219de93380d245ab46ea412569babbc3f973`.
- the committed migration ran before activation; the store held no non-terminal runs and no
  unresolved write intents at deploy time, and afterwards no stored run state or write intent
  contained `policy`, and no team carried `policyVersion`.

Smoke: `GET /` 200, `POST /mcp` unauthenticated 401, `POST /api/internal/lineup-worker`
unauthenticated 403, no error-level entries in either new revision.

## The first scheduled tick

The 17:00 UTC tick produced one run, because one team is enabled. Automation state was not touched by
this change or its migration; the other four teams were already `disabled` with the same
`changedAt` before the deploy started.

| Team     | Implementation    | Outcome | Verified | Plan provenance                                            |
| -------- | ----------------- | ------- | -------- | ---------------------------------------------------------- |
| football | `custom-policy/2` | `no_op` | yes      | `yahoo/mean-points-per-period:week:4,week:5,week:6,week:7` |

The run read back the provider's own lineup, found it already matched the explicit plan, made no
provider write, and recorded `lockedPlayers: 0` and `editablePlayers: 15` with no differences. The
label is the provider's, stored and displayed as written.

## A published-score regression and its fix

A later refinement published each score as the decimal it represents (`17.02`) rather than the
integer the solver ranks (`1702`). `knownSelection` requires a safe integer, so every planned run on
that build throws `Selection units must be a safe integer.` The 18:00 UTC tick is the evidence: one
run stayed in `planning` with no outcome and no provider write, so no lineup changed.

The committed tree publishes integer units again, which is what the tick at 17:00 UTC ran
successfully. `bun checks` and the three E2E targets pass on it. No deployment carries that tree yet;
the fix travels with the next deploy, or a traffic move back to the revisions above restores the
working behaviour sooner.

The community-start-rate path is covered by the node suites (`YahooLineup`, `ProviderFake` planning
through the seam) rather than by a live tick while those teams stay disabled.

## Rollback

`activeLineupImplementation` still selects the planner. Setting it back to `provider_native` and
deploying changes future execution only; runs already stamped `custom_policy` keep planning with the
custom planner on the older build's dispatch path. The migration is forward-only and additive in
meaning: older code that reads `policy` would not find it, so a code rollback past this change
requires draining runs first, as [the deployment runbook](deployment.md#redeploy-and-rollback) says.
