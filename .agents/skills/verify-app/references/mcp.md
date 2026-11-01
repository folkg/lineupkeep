# MCP proof

Import `test` and `expect` from `e2e/support.ts`. Use `mcp(scopes, name?)` with only the domain's needed scopes, then assert `listTools()` and actual `callTool(name, arguments)` results against its public contract.
Tool vocabulary, schemas, and replay identity are application-owned; see the executable [protocol tests](../../../../e2e/mcp.e2e.ts) rather than treating any sample tool as a harness requirement.
Decode unknown structured content with its schema when using domain values, never a cast. `request(method, params, version?)` exposes raw status, scope challenges, and protocol errors.

## Authorization is setup

The fixture follows real challenge/discovery, PKCE, browser sign-in/consent, and code exchange; it leaves the page blank after exchange. Navigate explicitly for UI assertions.
A name labels exchanges, not a different User; pass another signed-in Page for another identity. Call again for explicit step-up authorization.
Cite tool assertions, not successful OAuth. Assert missing-scope and cross-User behavior where relevant. Independent [service reads](services.md) corroborate persistence, not protocol behavior.
The [README](../../../../README.md#connecting-an-mcp-client) owns client prerequisites, revocation, and offline-grant handling.

## Scope acceptance command

Run `bun run mcp:accept` before accepting an MCP change. It exercises the real protocol surface and prints a per-tool table. It exits non-zero on a metadata disagreement other than the deliberate `offline_access` difference, a wrong 401 baseline, a tool that runs without its scope, or a 403 that names a different scope. It never prints, logs, or stores a token.

### Local flow: the scope boundary

`bun run mcp:accept` starts a disposable local stack, registers a fresh public client for each modern grant, and runs discovery, PKCE, browser sign-in, and consent. It requests the full advertised set and the onboarding baseline, then prints every tool's result under both grants. It also authorizes once through the client metadata document that still asks for the retired `connections:read` name and prints the same table for that legacy grant, proving a retired name in a token's claim still reaches its tool. Each tool's required scope comes from that tool's own unauthenticated 401 challenge, cross-checked against whether the grant actually runs or refuses it. `--scopes <subset>` reproduces a client's exact request and accepts a retired name; the restricted baseline and the legacy grant are still tested. `--origin` may point at an existing loopback test-composition stack with `RESEND_API_BASE_URL` set; otherwise omit it.

### Provided token: the deployed origin

```sh
read -rs MCP_ACCEPT_TOKEN && export MCP_ACCEPT_TOKEN
bun run mcp:accept --origin https://<host> --token-env MCP_ACCEPT_TOKEN
```

The command reads the token from the named environment variable, never from an argument. It checks metadata consistency, the 401 baseline, and every listed tool against the token's granted scopes. Write tools are called only with empty arguments, so a 400 proves the scope check passed without a write. Use a fresh access token: access tokens last five minutes. It cannot prove dynamic registration, consent, PKCE, or a scope the token does not hold.

Each local grant uses a fresh dynamic client so the grant's scope is tested independently; reusing one dynamic registration for a second authorization is a separate case. The legacy grant deliberately reuses the client whose metadata document still asks for the retired name, which is what a pre-rename client looks like. If a client fails after consent, capture its authorization `error` and `error_description` and its metadata document. The report includes both metadata scope lists and their differences, the baseline challenge, the tool tables, the retired-name mapping, the legacy grant, the feedback read-grant case, findings, and limitations. Cite the tool assertions, not the successful OAuth setup.

## Evidence

Each exchange retains a redacted transcript with persona, method/tool, arguments, status, response, and trace linkage; [harness privacy](harness.md#evidence-privacy) owns safe artifacts.
Unavailable spans are not zero work. Wrap calls with the shared `measure`/`profile` fixtures for client latency, traced backend work, database-window evidence, and plain Node CPU; see [performance](performance.md) for attribution limits.
MCP-only criteria belong in `shots.notShown`. A mixed citation needs an asserted browser checkpoint to label footage; protocol text is not a picture of its outcome.
