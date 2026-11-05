# Lineupgrade planning

Planning workspace for Lineupgrade, the independent provider-neutral rewrite. The owner selected the name and authorized the independent starter copy plus branding/design-system preparation in `/Users/graemefolk/Documents/Software/lineupkeep`. That setup is complete; fantasy feature implementation, infrastructure plans/apply, publication, and live provider probes/writes remain separate approval gates. Start with [the project handoff](../../START-HERE.md).

## Documents

- [Glossary](GLOSSARY.md): agreed domain language only.
- [Implementation plan](IMPLEMENTATION-PLAN.md): consolidated scope, technical recommendations, and approval gates.
- [Detailed delivery stages](DELIVERY-PLAN.md): stages 0–8 with entry/exit criteria.
- [Architecture](ARCHITECTURE.md): modules, solver, machines, durable execution, linking, and security.
- [Lineup selection policy](POLICY.md): the objective, the provider's scoring schemes, availability, and the live evidence behind them.
- [Testing plan](TESTING.md): proposed seams, independent oracles, generated/model-based tests, and crash recovery.
- [MCP contracts](MCP.md): generic tool families, budgets, paging, and client acceptance.
- [Minimal UX brief](UX-BRIEF.md): functional surfaces and later design work.
- [Grilling decisions](DECISIONS.md): all recorded rounds and corrections, including hosted browser linking.
- [Hosting comparison](HOSTING.md): Cloudflare/GCP/AWS limits, illustrative sizing, and the proposed acceptance checks.
- [Hosted browser infrastructure](HOSTED-BROWSER-INFRA-PLAN.md): deployed IAM-only browser service, egress, limits, and remaining gates.
- [Research notes](RESEARCH.md): inspected code and primary-source evidence.
- [Schedule sources](SCHEDULE-SOURCES.md): the candidates probed, their terms, the freshness policy per observation kind, and the schedule-observation design.
- [Reference knowledge](AUTOCOACH-KNOWLEDGE.md): everything the AutoCoach implementation encodes about setting a lineup, recorded before that checkout stops being consulted.
- [Lineup correctness analysis](LINEUP-CORRECTNESS-ANALYSIS.md): the participation regression, the gap against the reference, and the ordered correction design.
- [Naming research](NAMING-RESEARCH.md): preliminary domain/commercial/US-Canadian screening; Lineupgrade is selected, not legally cleared or purchased.
- Architecture decisions: [provider-neutral product](adr/0001-provider-neutral-product.md), [workflow machines and pure selection](adr/0002-workflow-machines-and-pure-selection.md), [independent product](adr/0003-independent-product.md), [Cloud Run first](adr/0004-cloud-run-first.md), [free-tier Postgres](adr/0005-free-tier-postgres.md), [availability tiers in the lineup objective](adr/0006-availability-tiers.md), [provider registry and planner capability](adr/0007-provider-registry-and-planner-capability.md), [refusal kinds and the planner cutover](adr/0008-refusal-kinds-and-planner-cutover.md), [provider score ownership](adr/0009-provider-score-ownership.md), [address-based egress](adr/0010-address-based-egress.md), and [schedule observations and schedule sources](adr/0011-schedule-observations-and-schedule-sources.md).

## Source of truth

The user's scope revision in the planning conversation supersedes the previous Yahoo-only scope and its exclusion of an optimizer, queue, scheduler, and application UI. Existing AutoCoach code is inspiration and evidence, not an implementation to transplant.

Previous research reports referenced under `/tmp` are no longer present on this machine at the start of this planning round. Conclusions preserved in the conversation are research evidence, not substitutes for maintained adapter tests or fresh verification where required. Do not copy private account/session data into these documents.

## Decision process

The recorded product-grilling rounds are complete. Do not reopen settled questions or present technical proposals as accepted implementation decisions; Rounds 10–11 record the owner's hosted-browser linking and transient-relay decisions. Ask only for genuinely unresolved choices; resume through the delivery gates after explicit implementation authorization.
