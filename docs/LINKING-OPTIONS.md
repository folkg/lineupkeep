# Connecting a fantasy account: options and recommendation

Research date: 2026-10-28. Revised 2026-10-28 after owner review. Status: corrected record of the owner's position and of observed provider behaviour, not an accepted architecture change. Update 2026-10-29: the local helper described here was removed; the hosted browser is the only linking path.

## The problem, as it actually stands

**The only blocker is that Yahoo sends Google-identity accounts to Google, and Google refuses our hosted browser.**

The owner's Yahoo account is a Google identity. Yahoo's sign-in page offers it nothing but “Sign in with Google”, and Google answers our hosted Chromium with “This browser or app may not be secure”. The hosted browser's UX is not the objection: “I didn't reject this on UX. This is okay for UX if this is the only way to do it. But I don't think this works for Google at all. So that is our current problem.” [R7]

The obvious escape — give the account a Yahoo password and sign in with that — is not reachable either. Yahoo's sign-in page refuses a Gmail-shaped address before it looks up any account: it removes its own **Next** button and shows “To use a Gmail address, sign in with Google.” That rule is a static domain test in Yahoo's page, so a password on the account cannot make the page accept the address. [R7]

## Decision in brief

- **Yahoo will not grant write access.** Do not plan around it. Yahoo's access page states that the API is read-only and that “Write access is not available at this time”; the owner states flatly that it will not be granted. The form's later invitation to describe a unique read/write case is not a route to a grant, and this document no longer recommends pursuing it. [Y1, Y2]
- **Keep the hosted browser on its merits.** Its UX is acceptable if it is the only way; it fails only because Google refuses the browser. No cosmetic, transport or egress change alters that. [R3, R7]
- **The Yahoo-password workaround is not available.** The sign-in page will not accept a Gmail address, so a password, if one can be set at all, is unusable there. The one residual is Yahoo's account-recovery flow, which is not a sign-in page and cannot be tested for the owner's account from outside. [R7]
- **Yahoo's other authentication methods are unreachable for the same reason.** The page never reaches a state in which Account Key, codes, passkeys or an app password could be offered for that address. [R7]
- **A browser extension is the only identified route that keeps the Google sign-in in the person's own browser.** It is not a chosen direction: the owner is lukewarm about it, and store approval is expected to be hard. Section C1 keeps the platform facts; it is not a recommendation. [R7]
- **The co-manager idea is rejected.** The owner does not want a co-manager identity visible to other managers in the league. [R7]
- **Desktop-once-then-phone does not escape the Google blocker.** The desktop step is still a Google sign-in in whatever browser performs the capture: if that browser is ours, Google refuses it, and if it is the person's own, the capture is the local helper — an install, not mobile-first onboarding.
- **Rejected and staying rejected:** relaying credentials through our origin, reverse-proxying Yahoo's login, and any anti-detection tooling intended to defeat Google's refusal. Those were rejected before this review and remain rejected on security and policy grounds.

No researched, currently verified path provides unattended lineup writes, ordinary mobile-browser onboarding, Google-identity support, no installation, no account-security change, and a clear provider-policy basis. That is a constraint conflict, and after the corrections above it is a narrower one than the earlier version of this document implied: Google's sign-in page is the wall, and every candidate either keeps it in our browser (hosted browser), moves it into the person's browser (extension, helper), or fails (password, other Yahoo methods, co-manager).

## 1. The problem, precisely

### What the current adapter needs

This is not “get a Google token” or “know that the person signed in.” The existing Yahoo adapter needs a reusable **Yahoo authenticated session** that our backend can use after the person's browser is closed.

| Material or operation | Exact current requirement                                                                                                 | Evidence and limits                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session               | Nonempty `T` and `Y` cookies, serialized as `T=<value>; Y=<value>`                                                        | Existing live read/write findings and capture code. Not the entire cookie jar, Google cookies, a password, or a Lineupkeep login token. [R1, R3]                                                                                                                                                                                                                        |
| Capture scope         | Hosted capture asks for cookies applicable to `https://login.yahoo.com/`, not every cookie with either name in any origin | `context.cookies([session.loginUrl])` in `packages/hosted-browser/src/browser.ts`; production URL in `provider.ts`. The removed local helper queried cookies applicable to `https://football.fantasysports.yahoo.com/`. Cookies are domain/path scoped, not strictly origin scoped. The intended material is Yahoo's session, not a Google-origin session. [R3, R4, W1] |
| Acceptance            | Yahoo must accept the completed session and return an authenticated user; nonempty cookies alone are not acceptance       | Backend validation uses `GET https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1?format=json`. Invalid sessions were observed returning 401. [R1, R3]                                                                                                                                                                                               |
| Reads                 | Send the validated session to the adapter's explicitly authorized Yahoo endpoints                                         | The read origin is `https://pub-api-ro.fantasysports.yahoo.com`; discovery scopes games to NFL/NHL. This is the first-party cookie path, not the public OAuth API. [R1, R3]                                                                                                                                                                                             |
| Writes                | Obtain a session-bound crumb, then submit and independently read back roster changes                                      | Crumb: `GET https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f`. Writes: `PUT https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/team/{team_key}/roster?format=json_f&crumb=…`. A crumb is not an independent authorization grant and an expired session can return a null crumb. [R1, R3]                                                    |
| Persistence           | Encrypt only the required session material, bound to the owning user, connection and provider                             | Current runbook specifies a versioned AES-GCM envelope. Expiry/revocation must suspend access and trigger reconnect; “link once” is not a lifetime guarantee. [R2]                                                                                                                                                                                                      |

The retained live findings establish the `T`/`Y` pair's sufficiency, including explicit assignment writes and readback. They do **not** retain a current production cookie-attribute inventory. The fake deliberately marks both cookies HttpOnly; that is a test condition, not proof of each real cookie's current flags, exact Domain/Path, expiry, or SameSite attributes. A future capture acceptance should inspect only that metadata, never record values. No recommendation here depends on finding a script-readable Yahoo token. [R1, R3]

The important security boundary is that ordinary Lineupkeep JavaScript cannot read Yahoo's cookie jar. A Yahoo tab, popup, iframe, redirect or PWA installation does not grant that access. HttpOnly cookies are also unavailable to page script running on Yahoo itself. `Set-Cookie` is not exposed as a response header to frontend JavaScript. Giving our server permissive CORS headers does not change Yahoo's policy or expose the person's browser cookies to it. [W1, W2]

**The product needs delegated read/write authority, not intrinsically these two cookies.** OAuth would replace this capture requirement with access/refresh tokens. A co-manager would change the acting Yahoo principal. Both need an explicit integration decision and acceptance, not pretending those credentials fit the existing adapter unchanged.

### Hard constraints versus preferences

- **Hard security requirement:** never retain a person's password. No password database, vault, logs, traces, recordings, support exports or backup copies. Encrypt retained session/token material. A password stored “temporarily” to automate future sign-ins still fails the requirement.
- **Different claim:** “Lineupkeep never sees your password” is stronger than “Lineupkeep never stores it.” The current hosted flow relays input through the web and browser services, which can observe it transiently. The owner previously accepted transient relay; that does not authorize retention. Browser save-password databases, temporary-profile contents and crash diagnostics need scrutiny too. The current flow cannot honestly claim cryptographic exclusion of Lineupkeep from the password path. [R2, R3]
- **Hard product direction for this decision:** support onboarding on ordinary mobile browsers, including a Google-identity Yahoo account. Do not require the removed helper, a browser extension, desktop access, or an Apple native/Safari-extension development and approval program. Do not simply re-propose the three rejected mechanisms under another label.
- **Hard task boundary:** research and this document only. No account changes, signed-in provider access, access applications submitted, implementation, infrastructure changes or deployments were performed; the page-behaviour observations in [R7](fantasy-manager/RESEARCH.md) used a fresh browser and addresses nobody owns.
- **Preferences/tradeoffs, not laws of physics:** a short connection flow, no Yahoo account change, low cold-start latency, small engineering/maintenance burden and the documented CAD 5/month operating budget. Account changes were specifically requested for evaluation, not approved. The owner can reject them on product grounds.
- **Not established:** an exact mobile traffic percentage or the fraction of Yahoo users with Google identities. Mobile inclusion is an owner requirement; it does not need an invented market-share statistic to justify it.

### Policy is a separate gate

A working capture is not permission to run an automated fantasy manager.

Yahoo's general terms §2(d)(9) prohibit automated access or data collection without express prior permission; §2(e) also restricts access methods and commercial reuse. The published API terms §1(h) require OAuth for API access to user accounts. The current Fantasy portal requires an API Access and Use Agreement. These are concrete contractual restrictions, not a claim that cookie copying is inherently criminal. The exact applicable agreement, jurisdiction and any written authorization need review. No such authorization is established by the linking evidence. [Y1, Y5, Y6]

**As published, unapproved automated use conflicts with those restrictions.** This risk applies to the existing cookie-based backend regardless of whether capture uses a helper, extension, password, remote desktop or native app. The user's consent does not itself supply Yahoo's permission. An owner deciding to accept commercial risk is also not the same as Yahoo granting permission.

Google separately forbids directing OAuth authorization into a developer-controlled embedded user-agent. Its definition includes environments that permit arbitrary script injection, request-routing changes or access to session cookies; it also requires users to be able to verify the requested URI and connection security. Google's browser help warns about automation and embedded browsers. These are broader conditions than a single `navigator.webdriver` bit. [G1, G2]

There is no established blanket Apple or Android ban on an app reading **its own web view's** cookies. The technical APIs exist. That does not grant access to Safari/Chrome's separate cookie store, guarantee Google sign-in, or guarantee store approval. [M1–M5]

## 2. Capture and delegation paths

### A. Provider cooperation: OAuth, partner access and delegated roles

#### A1. Yahoo Fantasy OAuth

**Not available. Do not plan around it.** Yahoo's access page states that the API “currently provides read access only” and that “Write access is not available at this time”. The owner's position is that write access will never be granted, and nothing observed contradicts it. [Y1, Y2]

The architecture would have been the best UX: tap Connect, authenticate in the person's actual browser, consent on Yahoo, return to Lineupkeep, with Google sign-in handled by Google in a browser Google trusts. The backend would retain encrypted Yahoo access/refresh tokens rather than `T`/`Y` or a password. That is exactly why its unavailability matters, and why no other option becomes equally good by waiting. [Y1, Y4]

What the current evidence actually shows:

1. Yahoo still accepts applications and reviews them; access follows **if approved**, and new users without a YDN account may leave Client ID blank and be provisioned after approval. That is a review process for **read** access, not an open write channel. [Y1, Y2]
2. The same form later invites additional details for a unique read/write use case, and the API documentation still documents `PUT …/team/{team_key}/roster`. Neither is evidence that a write grant is available. Documentation of an operation is not a permission to use it, and a written inquiry is not a plan. [Y2, Y3]
3. A read-only grant can support discovery and analysis, not unattended lineup setting. It does not mint Yahoo browser cookies, and combining approved reads with unapproved cookie writes does not inherit the read grant's permission. [Y2, Y4–Y6]
4. The OAuth endpoint, `https://fantasysports.yahooapis.com/fantasy/v2`, is a different origin from the first-party endpoints in section 1, so even an approved grant would need data-parity and write/readback acceptance.

An old third party's working key, a legacy grant, or an existing library proves neither new-app approval nor permission to reuse its identity.

**Verdict:** unavailable, and not a dependency to schedule around. No application was submitted, and none should be prepared on this evidence.

#### A2. Authorized integration vendor or managed identity provider

An actual Yahoo-authorized partner with **sublicensable lineup-write authority** could provide the same consent UX. Ask for the contractual right, supported sports/operations, mobile flow, token custody, revocation and pricing. No qualifying partner was verified here, and with write access not offered to new applicants there is no realistic expectation that one exists; treat the option as closed until Yahoo says otherwise. A vendor's “Yahoo integration” or OAuth login connector alone is not that evidence.

Auth0, another identity broker, “Sign in with Google,” Yahoo OpenID identity, enterprise SSO, FedCM, or Google token exchange cannot manufacture missing Yahoo Fantasy permissions. An identity assertion is not a Yahoo session. Yahoo's documented code/refresh grants require Yahoo authorization; they are not a documented exchange for an arbitrary Google token. This is protocol reasoning from the published flow, not a claim about unpublished partner arrangements. [Y4]

Outsourcing a hosted browser or RPA stack also outsources credential custody and cost; it does not remove the same authentication/policy boundary.

#### A3. Invite Lineupkeep as a Yahoo co-manager

**Rejected by the owner.** A dedicated Lineupkeep-controlled Yahoo identity invited to each team would be visible to the other managers in the league, and the owner does not want a co-manager identity in their league. That is a product objection, and it settles the option.

For the record, the mechanism is real: Yahoo permits co-managers, allows their removal or locking, and gives them the same tasks as the main manager except changes to Edit Team Information, excluding **Public Prize Leagues**. It is broad team authority, not a narrow “lineups only” grant. It would also still need provider authorization for automated access, is not available in every league type, and would put several customers' teams behind one shared session. [Y7]

**Verdict:** rejected. Do not propose it again unless the owner reopens the visibility question.

### B. Obtain a session in an operator-hosted browser

#### B1. The hosted browser as deployed

The deployed image contains Playwright's **Chromium headless shell**, not a normal headed desktop browser. It uses CDP-backed screencasting, synthetic mouse/keyboard input, a new profile per attempt and cookie polling. The web service mediates its authenticated stream. The address-filtering forward proxy and popup handling fix egress and target activation; neither makes Google accept the browser. The 2026-10-28 refusal occurred after Google loaded. [R2, R3]

The relevant history is `572f9d21` / jj change `nykskrpn`, **fix(hosted-browser): resolve egress by address and stream provider popups**, followed by `efa9c642` documenting deployment and `e031537e` recording Google's refusal. Earlier claims that widening egress would complete Google sign-in were predictions, invalidated by that later observation. No need to re-debug the old blank-popup failure. [R2, R5, R6]

It requires no user install and can display on a phone, but that is not proof of usable mobile onboarding. `BrowserFrame.tsx` is an image inside a focused button with keydown, click and wheel handlers, not a local editable input or accessible provider DOM. Native mobile keyboard invocation, IME/composition, paste, autofill, passkeys and touch scrolling are not equivalent to a normal login page. The owner's “janky and slow” note is a real observation about the interface; it is not the reason this path fails, and the interface is acceptable if it is the only way to do it. [R3, R5]

Measured first frame: **9.434 seconds cold, 0.812 seconds warm**. Estimated two-minute session: **CAD 0.003–0.01 before shared free allowances**, not an invoice. Min-zero, maximum two browsers, 1 vCPU/2 GiB and the application egress boundary constrain today's costs/security. No network-level egress isolation or Chromium namespace sandbox is provided by this deployment. [R2]

**Verdict:** the right UX for this product, and the only route that needs no install, but disproved for Google-identity accounts by Google's own refusal. The failure is the supported-browser gate, not the interface. Fixing the browser or its egress would not change it, as the same refusal reproduces in an unmodified Chromium on an ordinary network. [R3, R7]

#### B2. Real headed Chromium/Chrome on a virtual display, remote-desktop input

A materially different experiment would launch an unmodified, supported, **headed** browser on X11/Wayland, show its browser chrome through a browser-based remote-desktop client, and relay only human input at the desktop layer. No Playwright launch/attachment, WebDriver, CDP during sign-in, hidden DOM automation, fingerprint patches or automated Google interactions. Merely adding Xvfb while retaining Playwright/CDP is not this experiment.

Cookie extraction still has to be designed: for example, explicit completion followed by browser shutdown and reading only the application's disposable profile with its own local encryption material. That has not been implemented or proved; changing the input protocol does not itself yield cookies. An in-browser capture extension or post-login debugging attachment would add a privileged component and must be described, not smuggled into “no automation.” Never copy a complete Google/Yahoo profile back to the application.

**What is Google's gate detecting?**

- **Known:** Google explicitly lists software automation and embedded environments as unsupported. The deployed headless, automation-controlled environment has those characteristics. Browser-environment signals are therefore the strongest documented mismatch. We have not identified the exact classifier input that produced this refusal. [G1, G2]
- **Also relevant:** Google documents blocking a correct-password login when it does not recognize the device or location, and includes IP address in the review. New cloud IPs/devices can add challenges. Yahoo similarly documents VPN/proxy, incognito, unfamiliar device and location challenges. [G3, Y12]
- **Unknown:** no primary source inspected attributes this exact error to datacenter IP reputation, says all GCP IPs are forbidden, or guarantees that removing CDP fixes it. Both browser characteristics and network/account risk may matter. “Just buy residential IPs” is not an evidence-based answer.

**Observed on an ordinary connection (2026-10-28):** the same unmodified Playwright Chromium, on a developer machine outside GCP, submitted a Yahoo-connector sign-in and was refused immediately with “This browser or app may not be secure”. That rules out Cloud Run egress as the cause and leaves the automation-driven browser environment as the trigger, even though the exact classifier input is still unidentified. [R7]

**Is this policy circumvention?** An ordinary standalone browser operated by a human over remote desktop is not inherently an automated browser. Google itself offers remote-desktop software; that is evidence against treating all remote use as categorically forbidden, **not approval of this product**. [G4]

Our developer-hosted login/cookie-export product still gives the developer control of the environment and session material. Google's secure-browser rule is broader than whether input arrives over CDP. A browser rendered inside Lineupkeep without inspectable URI/security information is especially problematic. I cannot honestly label this product policy-compliant just because `webdriver` is absent, nor assert that every genuine remote desktop violates policy. **Classification: technically plausible, policy unresolved; require a provider determination before treating it as a supported Google path.** [G2]

Masking automation signals while keeping the automated architecture, using “undetected” drivers, spoofing browser identity, challenge solvers, stolen profiles, or rotating proxies specifically to defeat the refusal is circumvention, not this experiment. Do not present successful evasion as a supported login integration.

Product drawbacks remain: another remote desktop on a phone, no local Yahoo/Google cookie reuse, limited password-manager/device-auth integration, bandwidth and cold starts. Engineering must cover a full browser/display stack, secure browser chrome, mobile input, capture, isolation, upgrades and disposal. Existing min-zero estimates do not establish its cost. Under a future separately authorized test, compare the ordinary browser on the same cloud egress with a normal local-browser baseline; change browser and network separately, and stop on refusal rather than tune a bypass.

**Verdict:** worth understanding, not a promised fix or preferred product. It requires more engineering and unresolved policy work to preserve a UX the owner would accept only if it were the only way.

#### B3. Give the same Yahoo account a Yahoo password

**Observed unreachable at Yahoo's sign-in page.** Yahoo's help still says accounts created with a Facebook or Google ID can use the Sign-in Helper and create a password, and its reset instructions cover desktop and mobile web. [Y9, Y10] What that help does not say is how such a person would then use the password. On 2026-10-28, Yahoo's sign-in page refused a Gmail-shaped address before any account lookup: typing it removes **Next**, shows “To use a Gmail address, sign in with Google”, and either pressing Enter or using the remaining control goes to Google's connector with the address pre-filled. The rule is a static domain test in the page (`forceGoogleForGmailAddress` over `["gmail.com", "googlemail.com"]`), identical on desktop and on an iPhone user-agent viewport, on fantasy and language entry URLs, and through the legacy `config/login` path. [R7]

The Yahoo password challenge is not addressable directly either: `/account/challenge/password`, with or without `sessionIndex`, `acrumb` or `username`, redirects to `/account/challenge/fail`. Challenge state is server-side, so no URL forces the password form. [R7]

The earlier version of this option was therefore wrong on its central premise. A password, if one can be set, has no surface to be entered on for this account class, because the page never asks the server about the address and so cannot react to account state. Whether a password can be set at all is a separate, untested question; whether recovery ends in a usable session is another. [R7]

What remains genuinely open:

- **Whether the account can acquire a password.** `https://login.yahoo.com/account/security` under “Ways of signing in” is the documented surface, reached by signing in with Google. If it refuses a Google-ID account, the question closes. Yahoo also notes that Account Key may need disabling first, which is an account-security change in itself. [Y10]
- **Whether recovery ends in a session.** `https://login.yahoo.com/forgot` accepts a Gmail-shaped address without the Gmail notice and asks for a verification code “if this email is linked to an account”. A completed recovery may leave a signed-in Yahoo session, which would give the hosted browser a session without Google — but that cannot be tested for the owner's account from outside, and it is account recovery rather than a sign-in method. [R7, Y9]
- **Whether the owner wants either.** Both are account-security changes, and the owner has not approved them.

**Verdict:** not an available option. The sign-in page refuses the address, so a Yahoo password cannot be used with the hosted browser today. The five-minute owner test in §5 is the only thing that could overturn that, and only through account recovery, not through the sign-in page. [R7]

#### B4. Yahoo's other authentication methods

**Likely unreachable for the same reason.** The sign-in page removes **Next** for a Gmail-shaped identifier before any account lookup, so it never reaches a state in which Account Key, a code, a passkey or an app password could be chosen. The facts below remain relevant only if some Yahoo surface that accepts the address is found. [R7]

- **Existing Yahoo Account Key:** Yahoo describes approving a login notification in a signed-in Yahoo mobile app. Approval could authenticate a hosted Yahoo session without a password or Google interaction, but it requires the Yahoo app/account configuration, Yahoo says Account Key can no longer be set up for all accounts, and the sign-in page cannot reach the approval step for a Gmail identifier. Eligibility and compatibility with Google-identity accounts are unverified. [Y11, R7]
- **Yahoo SMS/email codes and recovery links:** use them if Yahoo offers them to that account in its own login flow. Yahoo documents code/link delivery, not a universal passwordless third-party grant or a way for us to request a reusable Fantasy token. Sign-in Helper can lead to password creation rather than direct access. Do not build an undocumented credential-code endpoint or ask users to forward recovery links to support. [Y9, Y13]
- **Yahoo passkeys:** supported on eligible accounts, sometimes with a desktop QR prompt. But a passkey on the person's phone is not a credential in the cloud browser. Standard cross-device passkey authentication verifies physical proximity with Bluetooth; streaming a QR code from a cloud VM does not satisfy that check. A local passkey assertion is also bound to the relying party, not transferable to a different Lineupkeep challenge. Device/OS remote-authentication integration would need separate proof, not an assumed WebAuthn relay. [Y14, M7]
- **Mail app passwords:** Yahoo documents these for non-Yahoo email clients. No documented Fantasy session or roster-write grant follows from one. Storing one would also violate the password requirement. [Y15]
- **A persistent hosted profile:** could reduce repeat logins but retains far more identity-provider state, increases cross-session exposure and abandons the current ephemeral-profile boundary. It neither fixes first-time onboarding nor establishes permission. Not a harmless performance optimization.

#### B5. Reverse-proxy Yahoo login, direct credential submission or “stealth” browser vendors

A backend could attempt to reproduce Yahoo's login requests, relay its HTML through a Lineupkeep origin, or use a vendor to run that exchange. This can make cookie capture technically easy because the backend receives Yahoo's responses. It is not the person's normal secure Yahoo browser: origin-bound scripts, Google redirects, cookies, CSRF defenses, MFA and passkeys do not transparently survive that substitution. It is an adversary-in-the-middle credential/session relay architecture, even if users consent. Google's secure-browser rule explicitly includes altered request routing and cookie access. A vendor cannot turn it into authorized OAuth by calling it an integration. [G2, W1]

Not persisting a submitted password would satisfy only the retention constraint, not origin transparency, provider permission or safe consumer UX. Never use a lookalike Yahoo/Google form, suppress security warnings, or tell users to disable account protections. Keeping the current automation and purchasing anti-detection tooling is the circumvention case in B2, not an additional acceptable capture route.

**Verdict:** no. This is a more dangerous substitute for the rejected browser, not a simpler connection flow.

### C. Capture from the person's browser

#### C1. Browser extensions, by platform

A privileged extension can read HttpOnly cookies through a cookies API when granted the relevant host/cookie permissions. A page content script alone cannot. This is a genuine technical route, but the permissions also make the extension and its update supply chain a session-theft surface. Yahoo session cookies are not documented as Fantasy-only grants; do not promise they cannot authorize other Yahoo access. [E1, W1]

| Browser                                               | Can an extension strategy serve it?                           | What it means here                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Chrome, Edge and compatible Chromium browsers | Yes, subject to API/store compatibility and host permissions  | Install plus sensitive permissions; each distribution/review channel needs care. Not mobile-first.                                                                                                                    |
| Desktop Firefox                                       | Yes, with WebExtensions cookie permissions                    | Separate signing/distribution and compatibility testing; not a new account-security model. [E2]                                                                                                                       |
| Firefox Android                                       | Yes, Android extensions exist                                 | Potential Android subset, not “all Android.” Test the cookie API and specific distribution, not just content-script support. Existing Chrome users would need another browser and another sign-in. [E2]               |
| Chrome Android                                        | No ordinary Chrome Web Store extension execution on the phone | Google's “Install on your phone” instructions actually say **Add to Desktop** and enable later on the computer. Do not count this as mobile support. [E3]                                                             |
| Chrome iOS/iPadOS                                     | No ordinary Chrome extension route                            | The desktop-extension installation route does not become an iOS cookie API. Safari extensions do not run in Chrome. [E3, E4]                                                                                          |
| Firefox iOS/iPadOS                                    | No WebExtensions support                                      | Mozilla's feature request remains `NEW`, unresolved, in its primary tracker. [E5]                                                                                                                                     |
| Safari macOS                                          | Technically available                                         | Apple's app packaging/signing/distribution requirements and a sensitive-permission install. Excluded by the owner. [E4]                                                                                               |
| Safari iOS/iPadOS                                     | Technically available, not an install-free web feature        | App Store app/extension, enabling it and granting site access; Apple development and review. Apple's API compatibility differs, including no iOS `webRequest` and no `cookies.onChanged`. Excluded by the owner. [E4] |
| Other extension-capable mobile browsers               | A browser-specific subset, not a general escape hatch         | For example Microsoft has an Android extensions catalog. Do not equate an advertised extensions feature with support for our cookie API, arbitrary distribution, or the user's existing browser session. [E6]         |

**Verdict:** not a chosen direction. It is the only identified route that keeps Google's sign-in in the person's own browser, which matters because that is the one context Google does not refuse. Store approval is expected to be hard and the owner is lukewarm; the platform table above is the record, not a recommendation.

#### C2. Popup/redirect, bookmarklet, share sheet, Shortcut or PWA

Opening Yahoo in the real browser solves Google's browser-context problem. It does **not** solve extraction. A redirect back to Lineupkeep carries only data Yahoo deliberately puts in that redirect. A generic `returnTo` URL is not OAuth and cannot collect Yahoo's cookies on our domain. The same applies to a QR/deep link to Yahoo. [W1, W2, Y4]

Bookmarklets, userscripts, an iOS Shortcut's page JavaScript and page-manipulation extensions cannot read HttpOnly cookies. A share-sheet action can receive a URL or page data; Apple explicitly describes its Safari web-page preprocessing as JavaScript, not privileged cookie-store export. Android URL sharing likewise does not include Chrome's cookie jar. [W1, M6]

A script running with Yahoo page authority might perform a supported same-origin read or action using cookies implicitly and share the **result**. That is different from exporting the session. It needs an active browser/action for each run, remains subject to Yahoo policy, and does not provide unattended server execution after the tab closes. Background web APIs do not grant one site's worker another site's cookie-reading privilege.

Developer tools “Copy as cURL,” HAR/cookie export, remote debugging, or a generic cookie-editor extension can transfer tokens. They are desktop-oriented, error-prone and easy to overcapture, and teach users to export reusable account secrets. Mobile debugging generally adds a computer/tooling dependency. No ordinary onboarding.

**Verdict:** no standards-based install-free cookie handoff was found. Relying on an XSS, CORS mistake, open redirect or browser vulnerability would be exploitation, not a product feature.

### D. Mobile-native capture

#### D1. An app-owned `WKWebView` or Android `WebView`

**Technically capable of reading its own session:** Apple provides `WKHTTPCookieStore.getAllCookies`; Android provides `CookieManager.getCookie(url)` for the application's WebViews. Chromium's Android implementation uses all-inclusive cookie options for that native call. HttpOnly protects against page script, not these privileged app-owned browser interfaces. They do **not** grant an app access to cookies already in Safari or Chrome. [M1, M2]

The same capability that makes capture possible gives the app control over login content and credentials. Google's policy disallows this developer-controlled embedded authorization environment; its guidance explicitly calls out WebViews. Installing a wrapper does not turn it into the system browser. Yahoo-password-only sign-in might work, but then the product has both installation and account-change friction. [G1, G2, G5]

Apps still need disclosure/consent, safe credential handling, platform-specific lifecycle/security work, distribution and review. Apple privacy/security requirements do not imply automatic rejection of all cookie access, but neither do they imply approval of arbitrary third-party session export. No app-store acceptance was obtained. An App Clip or a thin wrapper does not exempt us from Apple development/distribution obligations. [M8]

**Verdict:** not a fix for the owner's constraints, even before maintaining two apps.

#### D2. System-controlled in-app browser/authentication session

Apple's `SFSafariViewController` explicitly does not expose browsing interactions or website data to its host app. `ASWebAuthenticationSession` returns the provider's callback URL; it is an authentication handoff, not a general cookie export API. Android Custom Tabs use the chosen browser and its shared state, not the app's WebView jar. A Trusted Web Activity similarly does not give its host access to cookies or local storage. [M3–M5]

These are good OAuth surfaces. Without a provider-issued callback token/grant, they leave the Yahoo cookies in the browser. Custom Tab messaging or redirect observation cannot make Yahoo send `T`/`Y` to an unrelated app.

**Verdict:** correct native authentication architecture when Yahoo authorizes OAuth, not an alternative to provider authorization.

#### D3. Native share extensions, autofill, VPNs and OS privileges

A share extension is not a Safari/Chrome cookie entitlement. An autofill or password-manager integration can assist with credentials but does not confer Yahoo Fantasy delegation. Reading another app's private cookie database would require unavailable privileges, a compromised/rooted device or a separately installed debugging/control component. That is unacceptable ordinary onboarding.

A VPN/carrier route sees encrypted HTTPS, not plaintext cookies. TLS interception would require a trusted-root installation and invasive credential access; it also undermines exactly the secure login we need. Accessibility-driven automation and a locally installed remote-control agent are helpers with a much larger permission surface, not install-free alternatives. These conclusions follow from the platform boundaries above, not a claim to have tested every OS/vendor product. [W1, M1–M6]

### E. Cross-device, human-assisted and reduced-scope products

- **Desktop once, phone thereafter:** useful once any valid session is stored, but it does not escape the Google blocker. The desktop step is still a Google sign-in in whatever browser performs the capture: if that browser is ours, Google refuses it, and if it is the person's own, the capture is the local helper — a desktop install, not mobile-first onboarding. A phone can show a one-use, owner-bound pairing code or QR and later observe completion, and reconnect repeats the dependency when the session expires. The removed helper's device authorization was a **Lineupkeep** grant, not proof Yahoo implements the same device flow. [R4]
- **“Connect later from desktop”:** an honest optional escape hatch. Save progress and clearly say nothing is automated until connection succeeds. It supports later mobile use, not the initial mobile conversion requirement. Do not describe the deferred signup as a successful connection.
- **Second-device approval:** Account Key/OTP can authenticate a session if Yahoo offers it. Standard passkey QR has the proximity limitation above. Pairing two Lineupkeep clients routes our authorization, not Yahoo's cookie jar. [Y11, M7]
- **Screen sharing with support or a concierge:** a remote helper still needs privileged extraction; pixels alone do not reveal HttpOnly values. It adds a human trust boundary, staffing and weak scaling. Taking over a person's logged-in browser is a much broader permission than Fantasy access. Not suitable for registration.
- **Owner-operated service identity/co-manager:** rejected with A3; not a fallback.
- **New Yahoo account, aliases or team transfers:** a new account does not inherit the old account's leagues. Transfers/invitations change authority per team and may require league actions. Do not silently substitute account creation for linking the existing account.
- **Read-only OAuth, public-league reads, imports/screenshots, recommendation links or reminders:** legitimate scope reductions. They cannot provide private unattended lineup writes without additional authority. Public reads do not authorize managing a team; email notifications do not grant a writable session.
- **User-side scheduled automation:** browser/phone background execution is not a reliable server substitute and still requires an installed, privileged agent or provider cooperation. It revives the helper/native-extension decision rather than avoiding it.

The search space has a useful boundary: either Yahoo issues a delegated grant, a privileged component accesses a browser/session, we operate the browser in which Yahoo issues it, someone manually exports a secret, or we act through a separately delegated account. UI handoffs transport an existing grant; they do not create an additional source of authority. This is a protocol/security classification, not a claim to have disproved every future provider feature.

## 3. Comparison

“Mobile” means **can finish connection on the phone**, not merely use Lineupkeep afterwards. “Conditional” is not a passing acceptance result. Costs below are engineering judgments, not quotations. All cookie routes have the Yahoo permission issue **Y**: unapproved automation conflicts with published terms, regardless of capture method. “No capture” means it cannot supply the unattended-write product as specified.

| Option                                             | Mobile connection                         | Google-identity Yahoo                           | Install/account-change friction                | Security surface                                                  | Policy/ToS                                      | Engineering cost                       | Store/review gates                                | Maintenance                           |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| Yahoo OAuth with writes                            | Moot                                      | Would work in a real browser                    | Consent                                        | Scoped tokens                                                     | **Not available** — do not plan around it       | Do not budget                          | None to seek; owner states it will not be granted | —                                     |
| Yahoo read-only OAuth                              | Yes                                       | Expected                                        | Consent                                        | Read tokens only                                                  | Approved reads only                             | Medium                                 | Yahoo approval                                    | Low–medium; **no writes**             |
| Authorized partner with delegated writes           | Depends on partner                        | Depends                                         | Partner consent                                | Additional token custodian                                        | Must prove licensing/write rights               | Medium, plus vendor fees               | Yahoo/partner contract; no verified vendor        | Vendor dependency                     |
| Managed identity broker alone                      | Yes for identity                          | Yes for identity                                | Consent                                        | Extra identity processor                                          | No Fantasy authority created                    | Low–medium but **no capture**          | Broker configuration                              | Low; wrong capability                 |
| Current hosted headless/CDP                        | Browser display yes; UX accepted by owner | **No, observed refusal**                        | None installed; remote login                   | Input relay, broad session, ephemeral unsandboxed browser, egress | Y; Google browser conflict                      | Already built; Google gate is external | No app store                                      | High browser/login churn              |
| Reverse-proxy login/direct credential relay        | Page can display, reliable auth unproved  | Google secure-browser conflict                  | No install; opaque credential relay            | Password/session interception and rewritten origins               | Y + Google policy; dishonest if disguised       | High, brittle and unacceptable         | No store; provider permission absent              | Very high login/security churn        |
| Genuine headed remote desktop, no login automation | Plausible; unproved                       | **Unknown**                                     | No local install with web client               | Full desktop/browser, input relay, profile extraction             | Y; Google product classification unresolved     | High                                   | Provider policy clearance, not store              | High; display/input/browser/infra     |
| Yahoo password + existing hosted capture           | Possible only if the page asked for one   | **Unreachable: page refuses a Gmail address**   | Account-security change, then remote login     | New password surface plus hosted risks                            | Yahoo password operation; Y remains             | Not worth building on this evidence    | No store                                          | —                                     |
| Existing Account Key + hosted capture              | Conditional                               | **Unreachable at Yahoo's sign-in page**         | Existing Yahoo app/setup; approval             | Approval phishing risk plus hosted session                        | Supported auth subset; Y remains                | Low spike, likely no route             | No Lineupkeep store app                           | Medium; limited population            |
| Yahoo codes/recovery + hosted capture              | Recovery only; not a sign-in method       | **Not offered for a Gmail identifier**          | Code/app switching; possibly password creation | Recovery proof plus hosted session                                | Provider-offered auth only; Y remains           | Unknown until the owner tests it       | No store                                          | Medium–high                           |
| Passkey QR into cloud browser                      | **No standard remote proximity path**     | Not a solution as proposed                      | Passkey enrollment/device requirements         | Would need privileged authenticator relay                         | Do not defeat proximity protections; Y remains  | High; no established design            | OS/provider integration                           | High/unknown                          |
| Desktop Chromium extension                         | No, desktop only                          | Yes, if person signs in normally                | Extension and cookie permissions               | Browser session and update supply chain                           | Y; disclose session export                      | Medium                                 | Browser-store review; expected hard               | Medium–high                           |
| Firefox desktop/Android extension                  | Android subset, not iOS                   | Expected                                        | Add-on; possibly browser change/sign-in        | Same privileged cookie risks                                      | Y                                               | Medium                                 | Mozilla signing/review                            | Medium–high                           |
| Safari macOS/iOS extension                         | Safari mobile only                        | Expected                                        | App install, enable, site grant                | Cookie-capable signed extension                                   | Y; consent/privacy requirements                 | High for this project                  | **Apple program/review, owner excludes**          | High                                  |
| Chrome Android/iOS; Firefox iOS extension          | **No supported route**                    | No capture                                      | Platform change would be required              | N/A                                                               | Not an option in those browsers                 | Not applicable                         | Platform capability absent                        | Not applicable                        |
| Other extension-capable mobile browser             | Limited subset                            | Expected, not tested                            | Often browser + extension install              | Privileged session export                                         | Y; API compatibility unproved                   | Medium–high                            | Browser-specific distribution                     | High fragmentation                    |
| Local CLI or desktop native helper                 | No independent mobile onboarding          | Works per existing evidence                     | **Install/tooling, owner excludes**            | Local browser, scoped upload, broad session                       | Y                                               | Was built; removed 2026-10-29          | Desktop distribution, not mobile store            | Medium                                |
| iOS/Android app-owned WebView                      | Phone yes; Google flow no                 | Google disallows embedded auth                  | Native install; perhaps Yahoo password         | App can observe login and own web-view cookies                    | Y + Google policy; platform privacy             | High                                   | App distribution/review; Apple excluded           | High, two platforms                   |
| System auth browser/Custom Tab                     | Yes for OAuth                             | Expected supported-browser auth                 | Native install unless plain web redirect       | Browser keeps cookies; app gets callback                          | Good OAuth surface, **no cookie capture**       | Medium                                 | Native stores if app used                         | Medium                                |
| Share sheet/Shortcut/bookmarklet/PWA               | UI yes, **no session export**             | Sign-in yes, capture no                         | Setup; native share extension needs app        | Page-script boundary; possible over-sharing                       | Y if automated actions; no HttpOnly access      | Low–medium; wrong capability           | Apple review if native extension                  | Provider-page churn                   |
| Manual cookie/HAR/cURL export                      | Not ordinary mobile                       | Technically possible                            | Devtools/debugging/export steps                | Very high overcapture/leakage risk                                | Y                                               | Low backend, high support              | None unless exporter extension                    | High support burden                   |
| Desktop capture + one-use mobile pairing           | **No, desktop required**                  | Still a Google sign-in in the capturing browser | Desktop and its capture tool                   | Secure handoff plus underlying capture                            | Y unless authorized OAuth                       | Low–medium                             | Underlying method's gates                         | Reconnect dependence                  |
| Co-manager service identity                        | Rejected                                  | No customer Google capture needed               | Per-team Yahoo invitation, broad team grant    | Shared identity has cross-customer blast radius                   | Y; no Public Prize Leagues; capacity unresolved | Not pursued                            | None; owner rejects the visible identity          | —                                     |
| Support screen sharing/concierge                   | Awkward; tooling-dependent                | Depends on extraction                           | Support appointment/control tools              | Human sees/control surface; privileged export                     | Y; substantial consent/privacy risk             | Low prototype, high operating cost     | Tool/platform permissions                         | Very high staffing                    |
| VPN/root CA/rooted-device/OS extraction            | Not acceptable onboarding                 | Does not itself solve auth                      | Invasive install/privileges                    | TLS interception/device compromise                                | Not a legitimate ordinary capture design        | High                                   | OS privileges/distribution                        | Very high                             |
| Connect later; read-only/manual assistance         | Deferral or reduced scope only            | Can avoid capture                               | Later desktop visit or manual work             | Much smaller if no session retained                               | Use approved/public access only                 | Low–medium                             | Depends on data source                            | Low–medium; **not unattended writes** |

The binding constraint is not installs: it is whether the browser performing the sign-in is one Google trusts. Approved OAuth would have been the only architecture that kept the person's own browser and a clear authorization model, and it is not available. Of the rest, only an extension (or the local helper) puts Google's sign-in back in a browser Google accepts. Everything else either streams a browser Google refuses or cannot get past Yahoo's address check at all.

So the extension row is the only identified technical route to a Google-identity Yahoo session that does not require Google in our browser. Its costs are real: install, sensitive cookie permissions, and store review the owner expects to be hard and is lukewarm about. This table records that; it is not a recommendation.

## 4. Where that leaves the decision

### What is settled

Yahoo write access is not available and is not coming. The hosted browser is the right shape but Google will not accept it. The Yahoo password and Yahoo's other sign-in methods are unreachable because the sign-in page will not accept the address. The co-manager identity is rejected. Those are decisions, not open questions, and none of them is a reason to start another browser-emulation project.

### What is actually open

The owner faces a constraint conflict, not a missing experiment:

1. **Put the sign-in back in the person's browser with an extension (or the local helper).** Google does not refuse a normal browser, and a privileged component can hand over the Yahoo session. This is the only route identified that preserves Google-identity linking. It costs an install, sensitive cookie permissions, and — for mobile — either a store listing the owner expects to be hard to approve or a desktop-only story. The owner is lukewarm, and this document does not claim it should be chosen.
2. **Keep the hosted browser and state the limitation.** Honest, already built, no install; the owner's own account cannot use it. That is a product limitation to surface, not a bug to hide.
3. **Reduce scope.** Read-only or manual assistance needs no session capture, at the cost of the unattended-write product.
4. **Change provider.** Not researched here and not recommended on this evidence.

### What this document will not do

It will not recommend another OAuth inquiry, another browser-emulation project, a credential relay, a co-manager identity, or a “try harder with Google” experiment. It also will not present a password as a solution: Yahoo's sign-in page refuses the address, and that is the whole finding.

## 5. First step: the five-minute test only the owner can run

The one remaining unknown is whether Yahoo's account recovery can give this account a password, or a session usable by the hosted browser. It cannot be tested from outside, because it needs the owner's own account and identity.

1. In a normal browser, sign in to Yahoo with Google, open `https://login.yahoo.com/account/security`, and under “Ways of signing in” choose **Password** and set one. If that option is missing or refuses a Google-ID account, the password path closes there.
2. In a private window, open `https://login.yahoo.com/` and type the Gmail address.
3. Note whether **Next** and a password field appear, or whether only the “To use a Gmail address” notice and the Google button do.

Reading the result:

- **A password field appears:** the page does consult account state after all, and the hosted browser may be able to link this account with the Yahoo password. Revisit B3 and B1.
- **Notice only, as observed on every surface tested here:** the password route is dead for this account class. The remaining choice is §4: an install (extension or helper), a stated limitation, reduced scope, or a different provider.
- **No password option in Account security:** the question closes even earlier; there is nothing to enter.

Do not record the password, and do not paste a session cookie into research notes. If the test reports the notice, that is a result, not a failed experiment: it settles the option.

No provider application was submitted, no account was accessed and no infrastructure changed for this revision.

## Evidence register

Public sources were fetched on 2026-10-28. Quotes above are from those fetched pages; current admission rules and documentation can change. Community anecdotes were not used to establish provider permission or platform capability. No signed-in developer console was inspected, no provider account was accessed, no credential was entered and no live login, cookie export or roster operation was performed for this research. The page-behaviour observations in [R7](fantasy-manager/RESEARCH.md) used a fresh browser and addresses nobody owns.

### Repository evidence

- **R1:** [Dated provider findings](fantasy-manager/RESEARCH.md), especially “Live Yahoo read verification (2026-10-25),” “Live Yahoo native write verification,” “Live Yahoo explicit assignment write verification,” and changed-write/reserve readbacks. These establish the cookie path's observed behavior, not OAuth admission or provider authorization.
- **R2:** [Hosted browser infrastructure](fantasy-manager/HOSTED-BROWSER-INFRA-PLAN.md), [deployment runbook](deployment.md#cold-starts-and-cost), and [ADR 0010](fantasy-manager/adr/0010-address-based-egress.md). Cost is an estimate; cold/warm first-frame timings are recorded measurements, not universal SLAs.
- **R3:** [Hosted browser/capture](../packages/hosted-browser/src/browser.ts), [provider URL](../packages/hosted-browser/src/provider.ts), [web completion boundary](../apps/web/src/server/hostedLinking/hostedLinkingStream.ts), [remote transport](../apps/web/src/server/hostedLinking/remoteHostedBrowser.ts), [client controller](../apps/web/src/browser/connections/useHostedLinking.ts), [input surface](../apps/web/src/browser/shared-ui/BrowserFrame.tsx), [Yahoo adapter](../packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts), and [fake cookie attributes](../apps/web/src/server/hostedLinking/fakeProvider.ts).
- **R4:** local helper removed 2026-10-29. Its capture, provider configuration, pairing/upload command, and documentation no longer exist in the repository.
- **R5:** [Owner walkthrough and prior alternatives](UI-REVIEW-2026-10-28.md). Historical OAuth and Google-path conclusions are not adopted as current facts where contradicted above.
- **R6:** jj history inspected at `572f9d21` (`nykskrpn`), `efa9c642` (`vmlmktsl`) and `e031537e` (`tyqywkqy`). No source implementation changed in this research.
- **R7:** [Yahoo sign-in routing for a Google-identity account (2026-10-28)](fantasy-manager/RESEARCH.md#yahoo-sign-in-routing-for-a-google-identity-account-2026-10-28). Fresh-browser page-behaviour observations: the Gmail-address notice and Google-only forward path, the `/validate` challenge responses, the unreachable password challenge, the Google connector and its refusal, and the Sign-in Helper's first step. Quoted strings and the shipped client rule are recorded there; screenshots are gitignored under `.artifacts/linking-research/`.

### Yahoo primary sources

- **Y1:** [Current Fantasy developer portal](https://sports.yahoo.com/developer/). Application/review/conditional access, OAuth, agreement and attribution requirements; restrictions on automated developer-account creation.
- **Y2:** [Current access application](https://sports.yahoo.com/developer/access/). Read-only/unavailable-write statement, later read/write-use-case invitation, new-user provisioning after approval. The inconsistency is deliberately preserved, not resolved by assumption.
- **Y3:** [Fantasy API documentation](https://sports.yahoo.com/developer/docs/), “Register Your Application,” “Roster Resource” and “PUT.” Documents OAuth, the API origin and roster assignments; not proof of current new-app write availability.
- **Y4:** [Yahoo server authorization-code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/). Provider consent, callback/code exchange, access and refresh tokens, refresh rotation and revocation. Not an exchange of Google credentials for Yahoo browser cookies.
- **Y5:** [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), especially §2(d)(9), §2(e) and account responsibilities. Applicable country-specific terms/agreements still need review.
- **Y6:** [Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html), especially §1(h) OAuth, licensing/commercial restrictions and data use. The Fantasy portal's access agreement may impose additional terms.
- **Y7:** [Invite a co-manager](https://help.yahoo.com/kb/SLN6420.html). Broad team tasks, invitation/removal/locking, Public Prize exclusion. Does not establish automation permission or mobile UI support.
- **Y8:** [Personal team/league limits](https://help.yahoo.com/kb/SLN6239.html). Publishes per-ID limits; does not settle co-manager counting.
- **Y9:** [Restore Google/Facebook-ID accounts](https://help.yahoo.com/kb/SLN6178.html). Sign-in Helper and password creation, with the legacy-account context noted above.
- **Y10:** [Reset/change a Yahoo password](https://help.yahoo.com/kb/account/reset-yahoo-password-sln2047.html). Mobile/desktop web and Account Key caveat.
- **Y11:** [Use/manage Account Key](https://help.yahoo.com/kb/SLN25781.html). Mobile approval, signed-in app requirement and limited setup availability.
- **Y12:** [Extra sign-in verification](https://help.yahoo.com/kb/SLN8923.html). Unfamiliar browser/device/location, proxy/VPN and private-mode challenges.
- **Y13:** [Verification codes and links](https://help.yahoo.com/kb/SLN3139.html). Delivery/recovery behavior, not universal third-party authentication.
- **Y14:** [Yahoo passkeys](https://help.yahoo.com/kb/SLN35635.html). Eligibility, account-security enrollment and desktop QR sign-in.
- **Y15:** [Third-party app passwords](https://help.yahoo.com/kb/SLN15241.html). Yahoo Mail clients, eligibility and separate revocation.
- **Y16:** [Sign in or out of Yahoo](https://help.yahoo.com/kb/homepage/sign-yahoo-sln3407.html). Describes the general “Yahoo ID, then password” path and says non-Yahoo, ymail and rocketmail addresses are entered in full. It does not mention the Gmail-address exception that the sign-in page actually enforces. [R7]

### Google primary sources

- **G1:** [Sign in with a supported browser](https://support.google.com/accounts/answer/7675428?hl=en). Automation/embedded-browser warnings, supported browsers and browser-based OAuth guidance.
- **G2:** [OAuth policies: Use secure browsers](https://developers.google.com/identity/protocols/oauth2/policies#browsers). Developer-controlled embedded user-agent definition and inspectable URI/security requirement. The policy page fetched states last modified 2026-08-05.
- **G3:** [Blocked sign-in notification](https://support.google.com/accounts/answer/1144110?hl=en). Device/location risk and IP-address review. Does not disclose Google's classifier or prove a datacenter-IP ban.
- **G4:** [Chrome Remote Desktop](https://support.google.com/chrome/answer/1649523?hl=en). Establishes ordinary remote-desktop use exists; not authorization for hosted credential capture.
- **G5:** [Authorization error explanations](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#authorization-errors), `disallowed_useragent`. Explicitly calls out `WKWebView` and recommends system/default-browser or supported authentication surfaces.

### Browser/platform primary sources

- **W1:** [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265), especially §§4.1.2.3–6 and 5.4. Domain/path/Secure/HttpOnly and cookie transmission rules.
- **W2:** [Fetch standard](https://fetch.spec.whatwg.org/#forbidden-response-header-name). Forbidden response headers include `Set-Cookie`/`Set-Cookie2`; a redirect is not a browser-cookie export grant.
- **E1:** [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies). Cookie/host permissions, HttpOnly cookie representation and URL-scoped retrieval.
- **E2:** [Mozilla WebExtensions cookies](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies) and [Mozilla Android extension development](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/). API and Android add-on platform; not a guarantee of an untested extension's behavior.
- **E3:** [Google extension installation instructions](https://support.google.com/chrome_webstore/answer/2664769?hl=en). Explicit desktop framing and phone “Add to Desktop,” not phone execution.
- **E4:** Apple [iPhone Safari extensions](https://support.apple.com/guide/iphone/get-extensions-iphab0432bf6/ios), [distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension) and [API compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility). The developer articles were read through Apple's corresponding `tutorials/data/documentation/… .md` endpoints because the HTML documentation shell returned no text.
- **E5:** [Mozilla's Firefox iOS WebExtensions request](https://bugzilla.mozilla.org/show_bug.cgi?id=1497374), verified through its [primary REST record](https://bugzilla.mozilla.org/rest/bug/1497374?include_fields=id,summary,status,resolution,last_change_time): `NEW`, unresolved, last change 2026-05-27. The Mozilla support KB returned a client challenge, so it was not treated as fetched evidence.
- **E6:** [Microsoft Android extensions catalog](https://microsoftedge.microsoft.com/addons/collections/mobile_android_extensions). Located in Microsoft's indexed primary page; full fetch yielded no readable body. This establishes only an advertised Android subset, not the APIs/distribution needed for capture.
- **M1:** Apple [WKHTTPCookieStore](https://developer.apple.com/documentation/webkit/wkhttpcookiestore), read via [Apple's Markdown endpoint](https://developer.apple.com/tutorials/data/documentation/webkit/wkhttpcookiestore.md). Manages a particular web view's HTTP cookies and fetches stored cookies.
- **M2:** [Android CookieManager source](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/webkit/CookieManager.java), inspected via the [AOSP source mirror](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/webkit/CookieManager.java), and [Chromium's native implementation](https://raw.githubusercontent.com/chromium/chromium/main/android_webview/browser/cookie_manager.cc), `GetCookieListAsyncHelper`. Android's developer-reference URL redirect-looped during fetch; the first-party source was used instead.
- **M3:** Apple [SFSafariViewController](https://developer.apple.com/tutorials/data/documentation/safariservices/sfsafariviewcontroller.md) and [ASWebAuthenticationSession](https://developer.apple.com/tutorials/data/documentation/authenticationservices/aswebauthenticationsession.md). Website-data isolation versus callback handoff.
- **M4:** [Android Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs/overview). Browser-provided rendering/shared browser state versus separate WebView state.
- **M5:** [Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity). Explicitly no host-app access to browser cookies/local storage.
- **M6:** [Apple extension scenarios](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html), “Accessing a Webpage.” Safari Share/Action preprocessing is page JavaScript, not a cookie-store entitlement.
- **M7:** [FIDO Alliance passkey explanations](https://fidoalliance.org/passkeys/), cross-device authentication. Bluetooth proximity and hybrid transport; a remote QR image alone is insufficient.
- **M8:** [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), security/privacy and distribution requirements. Not evidence of approval/rejection of a hypothetical Lineupkeep app.
