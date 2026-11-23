# Browser fixtures

Import `test`, `expect`, and sign-in helpers from `e2e/support.ts`. `signUp(page, "owner")` creates a real email-code account and follows the application’s post-sign-in route; `signIn(page, account)` uses an existing account. Assert the actual landing behavior rather than assuming a domain page. Browser claims must cross controls and visible outcomes.

`newUser("other")` creates another page/context and client address; authenticate with `signUp(page)` to retain its name. Primary defaults to `primary`. Names label evidence, never authority; real sessions identify Users. The fixture closes contexts and retains recordings when enabled.

Name actors in assertion steps: `Result: [owner] sees the saved item`. [Service reads](services.md) may corroborate persistence but cannot replace browser actions.

Call `captureCheckpoint(page, info, name)` from `e2e/verify/capture.ts` **after assertions**. It retains a screenshot, ARIA snapshot including dialogs, and persona label; video also holds the screen briefly. An attached PNG alone is not a checkpoint. Follow shared [privacy and evidence rules](harness.md#evidence-privacy).

## Solid diagnostics

The development client loads `@solidjs/diagnostics`. When changing a browser page, run the loopback development shell and inspect the console for reactivity warnings such as `STRICT_READ_UNTRACKED`; fix warnings owned by the changed view/controller and record any framework or router warnings that remain. Do not treat a clean console as behavioral proof; keep the page's assertions and checkpoints authoritative.
