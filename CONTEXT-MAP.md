# Lineupkeep context map

## Product and execution plan

- [START-HERE.md](START-HERE.md): independent rewrite, scope, permissions, next assignment.
- [PRODUCT.md](PRODUCT.md): intended users and product direction, not implemented claims.
- [Planning index](docs/fantasy-manager/README.md): all 17 planning documents.
- [Implementation plan](docs/fantasy-manager/IMPLEMENTATION-PLAN.md), [stages](docs/fantasy-manager/DELIVERY-PLAN.md), [architecture](docs/fantasy-manager/ARCHITECTURE.md), [testing](docs/fantasy-manager/TESTING.md).
- [Glossary](docs/fantasy-manager/GLOSSARY.md): authoritative fantasy-domain vocabulary.
- [DESIGN.md](DESIGN.md), [brand](docs/brand/BRAND.md), [.impeccable/design.json](.impeccable/design.json): approved foundation.
- [Setup](docs/SETUP.md), [release readiness](docs/release-readiness.md), [deployment](docs/deployment.md): provenance and gates.

## Existing platform

- `apps/web/src/routes/`: TanStack Start routes and metadata.
- `apps/web/src/browser/`: Solid browser UI. Auth and Notes are retained starter features; no fantasy workspace exists.
- `apps/web/src/browser/brand-ui/`, `apps/web/src/theme/`: Lineupkeep foundation and generic primitives.
- `apps/web/src/server/`: server functions, session/auth adapters, stateless starter MCP.
- `packages/backend/src/contexts/auth/`: application authentication.
- `packages/backend/src/contexts/notes/`: demo domain, not a fantasy model.
- `packages/backend/src/runtime/`: runtime composition and PublicInternet.
- `packages/backend/src/utilities/machine.ts`: starter machine convention, not a durable side-effect engine.
- `packages/brand/src/product.ts`: shared product identity.
- `infra/`: Alchemy scaffolding, not approved/applied Lineupkeep production infrastructure.
- `e2e/`: disposable verification harness, not deployed test endpoints.
- `.agents/skills/`: local testing, domain, interaction, observability, and verification instructions.

## Not implemented

Provider connection, team automation, lineup run, helper pairing, provider query adapter, lineup writer, worker/outbox/queue, scheduling, reconnect delivery, scoring, legal roster modelling, solver, and fantasy MCP. Proposed names in planning documents do not imply existing modules.

The old AutoCoach checkout is external reference evidence only. There is no build/runtime dependency, migration route, secret reuse, imported VCS history, or imported cloud state.
