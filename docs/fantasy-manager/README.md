# Lineupkeep planning

Planning workspace for Lineupkeep, the independent provider-neutral rewrite. The owner selected the name and authorized the independent starter copy plus branding/design-system preparation in `/Users/graemefolk/Documents/Software/lineupkeep`. That setup is complete; fantasy feature implementation, infrastructure plans/apply, publication, and live provider probes/writes remain separate approval gates. Start with [the project handoff](../../START-HERE.md).

## Documents

- [Glossary](GLOSSARY.md): agreed domain language only.
- [Implementation plan](IMPLEMENTATION-PLAN.md): consolidated scope, technical recommendations, and approval gates.
- [Detailed delivery stages](DELIVERY-PLAN.md): stages 0–8 with entry/exit criteria.
- [Architecture](ARCHITECTURE.md): modules, solver, machines, durable execution, linking, and security.
- [Testing plan](TESTING.md): proposed seams, independent oracles, generated/model-based tests, and crash recovery.
- [MCP contracts](MCP.md): generic tool families, budgets, paging, and client acceptance.
- [Minimal UX brief](UX-BRIEF.md): functional surfaces and later design work.
- [Grilling decisions](DECISIONS.md): all recorded rounds and corrections, including hosted browser linking.
- [Hosting comparison](HOSTING.md): Cloudflare/GCP/AWS limits, illustrative sizing, and the proposed acceptance checks.
- [Hosted browser infrastructure plan](HOSTED-BROWSER-INFRA-PLAN.md): planned IAM-private browser service, egress, limits, and deployment gates.
- [Research notes](RESEARCH.md): inspected code and primary-source evidence.
- [Naming research](NAMING-RESEARCH.md): preliminary domain/commercial/US-Canadian screening; Lineupkeep is selected, not legally cleared or purchased.
- Architecture decisions: [provider-neutral product](adr/0001-provider-neutral-product.md), [workflow machines and pure selection](adr/0002-workflow-machines-and-pure-selection.md), [independent product](adr/0003-independent-product.md), [Cloud Run first](adr/0004-cloud-run-first.md), and [free-tier Postgres](adr/0005-free-tier-postgres.md).

## Source of truth

The user's scope revision in the planning conversation supersedes the previous Yahoo-only scope and its exclusion of an optimizer, queue, scheduler, and application UI. Existing AutoCoach code is inspiration and evidence, not an implementation to transplant.

Previous research reports referenced under `/tmp` are no longer present on this machine at the start of this planning round. Conclusions preserved in the conversation are research evidence, not substitutes for maintained adapter tests or fresh verification where required. Do not copy private account/session data into these documents.

## Decision process

The recorded product-grilling rounds are complete. Do not reopen settled questions or present technical proposals as accepted implementation decisions; Round 10 records the owner's hosted-browser linking decision. Ask only for genuinely unresolved choices; resume through the delivery gates after explicit implementation authorization.
