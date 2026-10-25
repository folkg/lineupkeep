# MCP proof

Import `test` and `expect` from `e2e/support.ts`. Use `mcp(scopes, name?)` with only the domain's needed scopes, then assert `listTools()` and actual `callTool(name, arguments)` results against its public contract.
Tool vocabulary, schemas, and replay identity are application-owned; see the executable [protocol tests](../../../../e2e/mcp.e2e.ts) rather than treating any sample tool as a harness requirement.
Decode unknown structured content with its schema when using domain values, never a cast. `request(method, params, version?)` exposes raw status, scope challenges, and protocol errors.

## Authorization is setup

The fixture follows real challenge/discovery, PKCE, browser sign-in/consent, and code exchange; it leaves the page blank after exchange. Navigate explicitly for UI assertions.
A name labels exchanges, not a different User; pass another signed-in Page for another identity. Call again for explicit step-up authorization.
Cite tool assertions, not successful OAuth. Assert missing-scope and cross-User behavior where relevant. Independent [service reads](services.md) corroborate persistence, not protocol behavior.
The [README](../../../../README.md#connecting-an-mcp-client) owns client prerequisites, revocation, and offline-grant handling.

## Evidence

Each exchange retains a redacted transcript with persona, method/tool, arguments, status, response, and trace linkage; [harness privacy](harness.md#evidence-privacy) owns safe artifacts.
Unavailable spans are not zero work. Wrap calls with the shared `measure`/`profile` fixtures for client latency, traced backend work, database-window evidence, and plain Node CPU; see [performance](performance.md) for attribution limits.
MCP-only criteria belong in `shots.notShown`. A mixed citation needs an asserted browser checkpoint to label footage; protocol text is not a picture of its outcome.
