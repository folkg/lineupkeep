# Lineupkeep linking helper

`lineupkeep link` is the fallback for linking a Yahoo session to a running Lineupkeep app when the hosted browser sign-in is unavailable. It runs on your computer and uploads only the provider session material, not your password.

The primary flow is **Connect Yahoo** on the Connections page: it streams a private hosted browser into the app. Use this helper when that path is unavailable or you prefer a local sign-in.

## Prerequisites

- The pinned Node runtime and dependencies (`bun install`).
- A running Lineupkeep app, by default at `http://localhost:5173`.
- Playwright's Chromium (`bunx playwright install chromium`, once per machine).
- Your own Yahoo account. Automated checks use a behavioral provider fake and never contact Yahoo.

## Usage

```sh
lineupkeep link
lineupkeep link --provider yahoo
lineupkeep link --app-url https://lineupkeep.example
lineupkeep --help
```

`--app-url` also reads `LINEUPKEEP_APP_URL`. Non-loopback origins must use HTTPS. The helper is linked as `./node_modules/.bin/lineupkeep` by `bun install`; `bun run --cwd apps/linking-helper start` runs the same command.

## What happens

1. The helper starts an RFC 8628 device authorization request for the first-party linking client and the narrow `connections:link` scope.
2. It prints only the public user code and the app's Connections URL. Open the URL, sign in, enter the code, and approve the helper.
3. It opens the provider's own sign-in page in a dedicated temporary Chromium profile. Never use your normal browser profile; the helper does not read it.
4. It reads only the `T` and `Y` session cookies, validates the session through the app, and uploads it over the authenticated endpoint.
5. The app validates the session against the provider and stores an encrypted, owner-scoped connection. The helper discards its scoped access token and removes the temporary profile.

The device code and access token stay in memory. They are never command arguments, shell history, output, logs, or telemetry. The upload token cannot call MCP tools: it is bound to a different client, carries only `connections:link`, and expires within five minutes.

## Failure recovery

- **Expired code or denied request:** run `lineupkeep link` again.
- **No active pairing:** enter the shown code on the Connections page and approve the helper.
- **Provider sign-in failed or timed out:** run the helper again and complete the Yahoo sign-in in the window it opens.
- **Upload rejected after a lost response:** check whether the app shows Yahoo as connected before running the helper again.

## Tests

`bun run test:node` covers the device flow against the real auth layer, cookie extraction from a local fake provider page, upload authorization and failure mapping, profile cleanup, and secret-free output. No test contacts Yahoo.
