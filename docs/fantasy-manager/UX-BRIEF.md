# Minimal application UX brief

Status: agreed functional scope with proposed interaction structure. Visual direction is not selected. Use Impeccable for the new product, not the old Angular client; do not copy its visual system or invent a completed DESIGN.md before the new interface is designed and verified.

## Job and audience

Operate mode: a fantasy manager connects a provider, sees their teams, decides which teams are managed, pauses a team for the rest of the fantasy day, and understands whether automation worked. Launch use is one person with five Yahoo NFL/NHL teams, but registration is open and identity/ownership are not hardcoded.

Trust comes from concrete state and outcomes, not claims of perfect optimization.

## Functional surfaces

### Registration/sign-in

Retain the starter's email-code flow: first successful sign-in creates the account. No password, registration allowlist, invitation system, or separate account-creation wizard. Include accessible validation, resend timing, expired/incorrect code, delivery failure, pending result, and return-to/consent behavior. Optional Google sign-in is not required to launch.

### Teams

The primary surface lists compact teams with sport, league, provider, enrollment, current availability, and last-run status. Five teams should be easy to scan without an analytics dashboard.

- Enable/disable is persistent enrollment.
- Pause is explicitly labeled 'for the rest of this fantasy day', with understandable resume time and zone.
- Unavailable/reconnect-required is not silently displayed as disabled.
- Changes are pending until confirmed; keep useful recovery rather than optimistic success after a lost response.
- Recent activity is inline or in a focused disclosure: changed, no change, pending, blocked, uncertain, failed, target period, and safe reason.
- Do not expose cookie state, provider account GUIDs, diamond cohorts, raw errors, scoring controls, or a policy-mode chooser.

### Provider connections

A compact connection surface supports link, status, reconnect, and disconnect. Linking clearly explains that a local helper runs on the user's machine and that the human signs in on the provider's own page. No passwords enter this app.

An expired connection supplies one clear reconnect action, identifies affected teams safely, retains enrollment, and opens one deduplicated action-required email incident. An inaccessible team retains configuration rather than disappearing silently.

### MCP consent

Keep the starter's normal OAuth consent and scope descriptions. Distinguish reads, lineup writes, and review-link generation. A prefilled human transaction page is not authorization for the app to submit a transaction.

## Scope exclusions

No transaction suggestions, transaction execution UI, feedback, marketing/about pages, custom scoring controls, onboarding questionnaire, social/community features, or admin/invitation console. No old Angular implementation port.

## State and accessibility acceptance

Cover signed-out, new account/no connection, linking, canceled/expired pairing, no teams, active teams, disabled, paused, pause expiry, reconnect-required, temporarily unavailable, queued/running, changed/no-op, uncertain, failed, and quota/delivery problems.

Use semantic controls, keyboard/focus behavior, visible text—not color alone—for status, reduced-motion behavior, and responsive small-screen layouts. Long team/league names and multiple connections must not break hierarchy. Test actual built SSR/hydration as well as injected browser failures.

## Design work at implementation time

After product naming and baseline approval, run Impeccable in the new application target, establish product context, choose and confirm a distinct operational visual direction, and build the actual required surfaces. Capture the final design system in DESIGN.md from the implemented interface. Verify desktop/mobile renders and recovery states; do not add decorative screens merely to display a design system.
