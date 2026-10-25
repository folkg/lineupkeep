# Backend public-service proof

Export named `ServiceProgram` functions in `e2e/scratch/<task>/services.ts`; selecting the task's scenario selects that module and helpers. Committed programs live in [e2e/scenarios/services.ts](../../../../e2e/scenarios/services.ts); no feature facade needs updating.
The [program contract](../../../../e2e/serviceContract.ts) supplies authenticated `user` and unknown arguments. Decode with the domain's public Schema, call its public service with `user.id`, and return JSON-encodable domain observations; unsupported results reject with retained evidence.
Use the current executable programs as examples, not a required domain vocabulary or singular-service API.

## Phases and identity

Call `services.signIn(name)` for real email-code HTTP sign-in through the isolated inbox; headless identity keeps its session private. Mixed scenarios may pass a signed-in Page. Names label personas, not authority; see [browser fixtures](browser.md).

- `services.arrange(actor, label, program, arguments)` establishes prerequisites and is never proof.
- `services.exercise(actor, label, program, arguments)` is a citable action.
- `services.inspect(actor, label, program, arguments)` observes persisted results to assert independently.

Arguments default to `{}`. Assert ownership/lifecycle boundaries with another real User where relevant. Calls retain phase, persona, program, arguments, result/failure, and trace linkage; follow [evidence privacy](harness.md#evidence-privacy).
Never manufacture UserIds, replace services, or bypass domain rules through persistence. [Scenario lint](../../../../oxlint.config.ts) and [import policy](../../../../.dependency-cruiser.ts) cover selected ignored scratch code too; these are coding guardrails, not a hostile-code sandbox.

## Execution boundary

Every phase crosses a test-build-only authenticated route through the normal request pipeline and `runBackend`. Programs run **in the target** Node process/container or workerd with production services and request context—not in Playwright. Normal artifacts exclude route/programs; deployment guards reject test builds.
Traces come from the application's exporter; missing workerd export is not zero work. This proves use cases, not production HTTP/MCP adapters, worker invocation, or scheduling. Enter those paths when claimed.
Service-only criteria belong in `shots.notShown`, not footage. The [harness](harness.md#evidence-privacy) owns local-proof limitations and shared evidence rules.
