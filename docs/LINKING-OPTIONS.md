# Connecting a fantasy account: options and recommendation

Research date: 2026-10-28. Status: recommendation for owner decision, not an accepted architecture change.

## Decision in brief

**Pursue Yahoo-authorized, write-capable OAuth before investing in another capture mechanism. Gate general Yahoo onboarding on an answer, rather than advertise a connection flow that excludes mobile or Google-identity users.** This is the least bad decision, not a claim that Yahoo will grant access.

There is a material correction to the earlier analysis: Yahoo is **accepting applications for Fantasy API access**. Its current application page says both “Write access is not available at this time” and, farther down, “If your use case is unique and requires read/write access, please include additional details in the notes section below.” Those statements do not establish an available write grant. They do establish a concrete permission question worth asking before another browser project. The API documentation still describes roster writes. [Y1–Y3]

No researched, currently verified path simultaneously provides unattended lineup writes, ordinary mobile-browser onboarding, Google-identity support, no installation, no account-security change, and a clear provider-policy basis. That is a constraint conflict, not evidence that extensions or a local helper should be imposed anyway.

**Runner-up:** an explicitly optional Yahoo-password setup followed by the existing hosted capture. It is the cheapest technical path to test for Google-identity accounts without installs or Google sign-in in our browser. It is also an account-security change followed by the remote-browser UX the owner already rejected. It is not a recommendation to ship that UX by default, and it does not resolve Yahoo's authorization terms.

**First step:** prepare a precise read/write access inquiry through Yahoo's current application channel. Ask whether Lineupkeep's unattended, user-authorized NFL/NHL roster edits can receive a new application's write grant, and reconcile the contradictory wording. Do not build OAuth, change anyone's account, or rebuild the hosted browser to find out. Section 5 supplies the inquiry and decision test.

## 1. The problem, precisely

### What the current adapter needs

This is not “get a Google token” or “know that the person signed in.” The existing Yahoo adapter needs a reusable **Yahoo authenticated session** that our backend can use after the person's browser is closed.

| Material or operation | Exact current requirement                                                                                                 | Evidence and limits                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session               | Nonempty `T` and `Y` cookies, serialized as `T=<value>; Y=<value>`                                                        | Existing live read/write findings and capture code. Not the entire cookie jar, Google cookies, a password, or a Lineupkeep login token. [R1, R3]                                                                                                                                                                                                                  |
| Capture scope         | Hosted capture asks for cookies applicable to `https://login.yahoo.com/`, not every cookie with either name in any origin | `context.cookies([session.loginUrl])` in `packages/hosted-browser/src/browser.ts`; production URL in `provider.ts`. The helper instead queries cookies applicable to `https://football.fantasysports.yahoo.com/`. Cookies are domain/path scoped, not strictly origin scoped. The intended material is Yahoo's session, not a Google-origin session. [R3, R4, W1] |
| Acceptance            | Yahoo must accept the completed session and return an authenticated user; nonempty cookies alone are not acceptance       | Backend validation uses `GET https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1?format=json`. Invalid sessions were observed returning 401. [R1, R3]                                                                                                                                                                                         |
| Reads                 | Send the validated session to the adapter's explicitly authorized Yahoo endpoints                                         | The read origin is `https://pub-api-ro.fantasysports.yahoo.com`; discovery scopes games to NFL/NHL. This is the first-party cookie path, not the public OAuth API. [R1, R3]                                                                                                                                                                                       |
| Writes                | Obtain a session-bound crumb, then submit and independently read back roster changes                                      | Crumb: `GET https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f`. Writes: `PUT https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/team/{team_key}/roster?format=json_f&crumb=…`. A crumb is not an independent authorization grant and an expired session can return a null crumb. [R1, R3]                                              |
| Persistence           | Encrypt only the required session material, bound to the owning user, connection and provider                             | Current runbook specifies a versioned AES-GCM envelope. Expiry/revocation must suspend access and trigger reconnect; “link once” is not a lifetime guarantee. [R2]                                                                                                                                                                                                |

The retained live findings establish the `T`/`Y` pair's sufficiency, including explicit assignment writes and readback. They do **not** retain a current production cookie-attribute inventory. The fake deliberately marks both cookies HttpOnly; that is a test condition, not proof of each real cookie's current flags, exact Domain/Path, expiry, or SameSite attributes. A future capture acceptance should inspect only that metadata, never record values. No recommendation here depends on finding a script-readable Yahoo token. [R1, R3]

The important security boundary is that ordinary Lineupkeep JavaScript cannot read Yahoo's cookie jar. A Yahoo tab, popup, iframe, redirect or PWA installation does not grant that access. HttpOnly cookies are also unavailable to page script running on Yahoo itself. `Set-Cookie` is not exposed as a response header to frontend JavaScript. Giving our server permissive CORS headers does not change Yahoo's policy or expose the person's browser cookies to it. [W1, W2]

**The product needs delegated read/write authority, not intrinsically these two cookies.** OAuth would replace this capture requirement with access/refresh tokens. A co-manager would change the acting Yahoo principal. Both need an explicit integration decision and acceptance, not pretending those credentials fit the existing adapter unchanged.

### Hard constraints versus preferences

- **Hard security requirement:** never retain a person's password. No password database, vault, logs, traces, recordings, support exports or backup copies. Encrypt retained session/token material. A password stored “temporarily” to automate future sign-ins still fails the requirement.
- **Different claim:** “Lineupkeep never sees your password” is stronger than “Lineupkeep never stores it.” The current hosted flow relays input through the web and browser services, which can observe it transiently. The owner previously accepted transient relay; that does not authorize retention. Browser save-password databases, temporary-profile contents and crash diagnostics need scrutiny too. The current flow cannot honestly claim cryptographic exclusion of Lineupkeep from the password path. [R2, R3]
- **Hard product direction for this decision:** support onboarding on ordinary mobile browsers, including a Google-identity Yahoo account. Do not require the removed helper, a browser extension, desktop access, or an Apple native/Safari-extension development and approval program. Do not simply re-propose the three rejected mechanisms under another label.
- **Hard task boundary:** research and this document only. No account changes, live provider probes, access applications submitted, implementation, infrastructure changes or deployments were performed.
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

**Best UX if the necessary access is granted:** tap Connect, authenticate in the person's actual browser, consent on Yahoo, return to Lineupkeep. Existing Google sign-in, password-manager and device-authentication affordances stay in the person's browser. The backend retains encrypted Yahoo access/refresh tokens, not `T`/`Y` or a password. Yahoo documents authorization-code and refresh-token flows. Mobile Google-identity success is an expected consequence of that architecture, not a live result of this research. [Y1, Y4]

Current evidence must be read in order of what it proves:

1. The current portal says apply, Yahoo reviews, access follows **if approved**. New users without a YDN account may leave Client ID blank and be provisioned after approval. Therefore “closed to all new applications” is not accurate. [Y1, Y2]
2. The application begins: **“The Yahoo Fantasy Sports API currently provides read access only. Write access is not available at this time.”** The same form later invites additional details for a unique read/write use case. Treat that as unresolved, not a secret self-service write option. No review SLA or acceptance probability was established. [Y2]
3. The current docs still instruct selecting Read or Read/Write and explicitly document `PUT …/team/{team_key}/roster`, with NFL week and NHL date examples. Thus “the API has no lineup-write operation” is also inaccurate. Documentation is not evidence that a new application can obtain that permission today. The access page is the safer authority for current admission. [Y3]
4. A new approved **read-only** application can support discovery and analysis, not unattended lineup setting. It does not mint Yahoo browser cookies. Combining approved reads with unapproved cookie writes does not inherit the read grant's permission. [Y2, Y4–Y6]

The OAuth endpoint is `https://fantasysports.yahooapis.com/fantasy/v2`, different from the first-party endpoints in section 1. A grant must be followed by data-parity and write/readback acceptance. Do not assume every current first-party field or native lineup action exists through the documented API. An old third party's working key, a legacy grant, or an existing library proves neither new-app approval nor permission to reuse its identity.

**Verdict:** pursue a written answer, not an OAuth implementation premised on write access already being available. This corrects the overly categorical OAuth dismissal in the walkthrough document without changing that historical record. [R5]

#### A2. Authorized integration vendor or managed identity provider

An actual Yahoo-authorized partner with **sublicensable lineup-write authority** could provide the same consent UX. Ask for the contractual right, supported sports/operations, mobile flow, token custody, revocation and pricing. No qualifying partner was verified here. A vendor's “Yahoo integration” or OAuth login connector alone is not that evidence.

Auth0, another identity broker, “Sign in with Google,” Yahoo OpenID identity, enterprise SSO, FedCM, or Google token exchange cannot manufacture missing Yahoo Fantasy permissions. An identity assertion is not a Yahoo session. Yahoo's documented code/refresh grants require Yahoo authorization; they are not a documented exchange for an arbitrary Google token. This is protocol reasoning from the published flow, not a claim about unpublished partner arrangements. [Y4]

Outsourcing a hosted browser or RPA stack also outsources credential custody and cost; it does not remove the same authentication/policy boundary.

#### A3. Invite Lineupkeep as a Yahoo co-manager

This is a genuine alternative to capturing the **person's** session. The person signs into Yahoo normally, including with Google, and invites a dedicated Lineupkeep-controlled Yahoo identity to each team. Only that identity's session would need operator-managed capture and encryption. The person's password/session need not enter Lineupkeep at all.

Yahoo officially supports co-managers, permits their removal or locking, and says they can perform the same tasks as the main manager except changes to Edit Team Information. It explicitly excludes **Public Prize Leagues**. This is broad team authority, including much more than lineup assignment, not a narrow “lineups only” grant. [Y7]

Important unresolved work:

- The help gives desktop-style navigation. Mobile-web invitation and acceptance on both supported sports must be proved; do not promise a Yahoo-app deep link that has not been verified.
- Each team requires an invitation. Existing co-manager arrangements and league restrictions can make this unavailable.
- Yahoo publishes per-ID personal-team limits, but that page does not settle whether co-managed teams count. A shared account's scalable capacity is unknown. Do not invent unlimited co-management or evade limits with a farm of accounts. The portal also prohibits automated creation of multiple developer accounts. [Y1, Y8]
- One shared session would see several customers' teams. Current owner-scoped connection assumptions would need deliberate redesign; a mapping defect or session breach has a multi-customer blast radius. Per-customer service accounts replace that with considerable account provisioning/recovery overhead.
- Team delegation is not permission for automated backend access. Yahoo approval is still needed. [Y5]

**Verdict:** a worthwhile provider-permission question and possible restricted pilot, not a verified general-registration answer. It is more substantively different than swapping browser libraries, but fails universal coverage and introduces a substantially broader authorization model.

### B. Obtain a session in an operator-hosted browser

#### B1. The hosted browser as deployed

The deployed image contains Playwright's **Chromium headless shell**, not a normal headed desktop browser. It uses CDP-backed screencasting, synthetic mouse/keyboard input, a new profile per attempt and cookie polling. The web service mediates its authenticated stream. The address-filtering forward proxy and popup handling fix egress and target activation; neither makes Google accept the browser. The 2026-10-28 refusal occurred after Google loaded. [R2, R3]

The relevant history is `572f9d21` / jj change `nykskrpn`, **fix(hosted-browser): resolve egress by address and stream provider popups**, followed by `efa9c642` documenting deployment and `e031537e` recording Google's refusal. Earlier claims that widening egress would complete Google sign-in were predictions, invalidated by that later observation. No need to re-debug the old blank-popup failure. [R2, R5, R6]

It requires no user install and can display on a phone, but that is not proof of usable mobile onboarding. `BrowserFrame.tsx` is an image inside a focused button with keydown, click and wheel handlers, not a local editable input or accessible provider DOM. Native mobile keyboard invocation, IME/composition, paste, autofill, passkeys and touch scrolling are not equivalent to a normal login page. The owner's “janky and slow” experience is consistent with those limitations. [R3, R5]

Measured first frame: **9.434 seconds cold, 0.812 seconds warm**. Estimated two-minute session: **CAD 0.003–0.01 before shared free allowances**, not an invoice. Min-zero, maximum two browsers, 1 vCPU/2 GiB and the application egress boundary constrain today's costs/security. No network-level egress isolation or Chromium namespace sandbox is provided by this deployment. [R2]

**Verdict:** already disproved as the universal Google-identity path and rejected on UX. Cosmetic fixes would not change that conclusion.

#### B2. Real headed Chromium/Chrome on a virtual display, remote-desktop input

A materially different experiment would launch an unmodified, supported, **headed** browser on X11/Wayland, show its browser chrome through a browser-based remote-desktop client, and relay only human input at the desktop layer. No Playwright launch/attachment, WebDriver, CDP during sign-in, hidden DOM automation, fingerprint patches or automated Google interactions. Merely adding Xvfb while retaining Playwright/CDP is not this experiment.

Cookie extraction still has to be designed: for example, explicit completion followed by browser shutdown and reading only the application's disposable profile with its own local encryption material. That has not been implemented or proved; changing the input protocol does not itself yield cookies. An in-browser capture extension or post-login debugging attachment would add a privileged component and must be described, not smuggled into “no automation.” Never copy a complete Google/Yahoo profile back to the application.

**What is Google's gate detecting?**

- **Known:** Google explicitly lists software automation and embedded environments as unsupported. The deployed headless, automation-controlled environment has those characteristics. Browser-environment signals are therefore the strongest documented mismatch. We have not identified the exact classifier input that produced this refusal. [G1, G2]
- **Also relevant:** Google documents blocking a correct-password login when it does not recognize the device or location, and includes IP address in the review. New cloud IPs/devices can add challenges. Yahoo similarly documents VPN/proxy, incognito, unfamiliar device and location challenges. [G3, Y12]
- **Unknown:** no primary source inspected attributes this exact error to datacenter IP reputation, says all GCP IPs are forbidden, or guarantees that removing CDP fixes it. Both browser characteristics and network/account risk may matter. “Just buy residential IPs” is not an evidence-based answer.

**Is this policy circumvention?** An ordinary standalone browser operated by a human over remote desktop is not inherently an automated browser. Google itself offers remote-desktop software; that is evidence against treating all remote use as categorically forbidden, **not approval of this product**. [G4]

Our developer-hosted login/cookie-export product still gives the developer control of the environment and session material. Google's secure-browser rule is broader than whether input arrives over CDP. A browser rendered inside Lineupkeep without inspectable URI/security information is especially problematic. I cannot honestly label this product policy-compliant just because `webdriver` is absent, nor assert that every genuine remote desktop violates policy. **Classification: technically plausible, policy unresolved; require a provider determination before treating it as a supported Google path.** [G2]

Masking automation signals while keeping the automated architecture, using “undetected” drivers, spoofing browser identity, challenge solvers, stolen profiles, or rotating proxies specifically to defeat the refusal is circumvention, not this experiment. Do not present successful evasion as a supported login integration.

Product drawbacks remain: another remote desktop on a phone, no local Yahoo/Google cookie reuse, limited password-manager/device-auth integration, bandwidth and cold starts. Engineering must cover a full browser/display stack, secure browser chrome, mobile input, capture, isolation, upgrades and disposal. Existing min-zero estimates do not establish its cost. Under a future separately authorized test, compare the ordinary browser on the same cloud egress with a normal local-browser baseline; change browser and network separately, and stop on refusal rather than tune a bypass.

**Verdict:** worth understanding, not a promised fix or preferred product. It requires more engineering and unresolved policy work to preserve a UX the owner dislikes.

#### B3. Give the same Yahoo account a Yahoo password

Yahoo's own help says accounts created with a Facebook or Google ID can use Sign-in Helper and create a password. Its reset instructions explicitly cover desktop and mobile web. This is a Yahoo-supported account operation, **not spoofing Google or evading Google's browser detector**, because the user would authenticate to Yahoo directly instead. [Y9, Y10]

The honest proposed flow is: in their own ordinary browser, the person opens Yahoo's account recovery/security flow, verifies ownership, sets a unique Yahoo password, returns to Lineupkeep, and uses that password on Yahoo's page in the hosted browser. Lineupkeep must neither ask for the Google password nor collect/store the Yahoo password in its own form.

Caveats that matter to the product:

- The restore article specifically discusses older Google/Facebook-ID accounts with access trouble. It is **not proof that every currently federated Google-identity account has the same password-creation path**. Test the owner's existing account; avoid creating a different Yahoo account with no teams.
- This adds an independently usable account secret and recovery surface. It may affect security settings or other sessions; do not promise otherwise. Yahoo says Account Key may need disabling before setting a password. Do not instruct everyone to weaken their existing security configuration. [Y10]
- Ownership verification, a password-creation detour, app switching and then re-entry into a remote browser are significant conversion friction. Reconnect still needs the Yahoo password and possibly further verification. “One time” does not mean “one tap.”
- Some people deliberately choose Google sign-in to avoid a second password. Declining this change is reasonable, not user error.
- Google is avoided in the capture step, but Yahoo may still challenge or reject a datacenter/proxy login. Cookie capture and backend automation retain the Yahoo terms issue. [Y5, Y12]

**Verdict:** the least bad immediately testable no-install cookie path for some Google-identity accounts, not a broad consumer-onboarding solution. It only becomes a product candidate if the owner explicitly accepts both the account change and the remaining hosted UX.

#### B4. Yahoo's other authentication methods

- **Existing Yahoo Account Key:** Yahoo describes approving a login notification in a signed-in Yahoo mobile app. Approval could authenticate the hosted Yahoo session without a password or Google interaction. But it requires the Yahoo app/account configuration and Yahoo says Account Key can no longer be set up for all accounts. Eligibility and compatibility with Google-identity accounts are unverified. Useful for an existing subset, not a general signup flow. [Y11]
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

**Verdict:** rejected correctly for this audience. “Mobile browsers have no extensions” is too broad; “extensions cannot cover the required ordinary mobile-browser audience without installs and Apple work” is the relevant conclusion.

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

- **Desktop once, phone thereafter:** technically useful once any valid session is stored. A phone can show a one-use, owner-bound pairing code or QR and later observe completion. The desktop still needs an actual capture mechanism; Yahoo login in a plain desktop tab alone is not one. Reconnect repeats the dependency when the session expires. This is a desktop-assisted product, not mobile-first onboarding. Existing helper device authorization is a **Lineupkeep** grant, not proof Yahoo implements the same device flow. [R4]
- **“Connect later from desktop”:** an honest optional escape hatch. Save progress and clearly say nothing is automated until connection succeeds. It supports later mobile use, not the initial mobile conversion requirement. Do not describe the deferred signup as a successful connection.
- **Second-device approval:** Account Key/OTP can authenticate a session if Yahoo offers it. Standard passkey QR has the proximity limitation above. Pairing two Lineupkeep clients routes our authorization, not Yahoo's cookie jar. [Y11, M7]
- **Screen sharing with support or a concierge:** a remote helper still needs privileged extraction; pixels alone do not reveal HttpOnly values. It adds a human trust boundary, staffing and weak scaling. Taking over a person's logged-in browser is a much broader permission than Fantasy access. Not suitable for registration.
- **Owner-operated service identity/co-manager:** can remove customer capture entirely for eligible teams; section A3 explains why this deserves consideration but cannot be assumed scalable or universal.
- **New Yahoo account, aliases or team transfers:** a new account does not inherit the old account's leagues. Transfers/invitations change authority per team and may require league actions. Do not silently substitute account creation for linking the existing account.
- **Read-only OAuth, public-league reads, imports/screenshots, recommendation links or reminders:** legitimate scope reductions. They cannot provide private unattended lineup writes without additional authority. Public reads do not authorize managing a team; email notifications do not grant a writable session.
- **User-side scheduled automation:** browser/phone background execution is not a reliable server substitute and still requires an installed, privileged agent or provider cooperation. It revives the helper/native-extension decision rather than avoiding it.

The search space has a useful boundary: either Yahoo issues a delegated grant, a privileged component accesses a browser/session, we operate the browser in which Yahoo issues it, someone manually exports a secret, or we act through a separately delegated account. UI handoffs transport an existing grant; they do not create an additional source of authority. This is a protocol/security classification, not a claim to have disproved every future provider feature.

## 3. Comparison

“Mobile” means **can finish connection on the phone**, not merely use Lineupkeep afterwards. “Conditional” is not a passing acceptance result. Costs below are engineering judgments, not quotations. All cookie routes have the Yahoo permission issue **Y**: unapproved automation conflicts with published terms, regardless of capture method. “No capture” means it cannot supply the unattended-write product as specified.

| Option                                             | Mobile connection                           | Google-identity Yahoo                      | Install/account-change friction                | Security surface                                                  | Policy/ToS                                      | Engineering cost                      | Store/review gates                           | Maintenance                           |
| -------------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Authorized Yahoo OAuth with writes                 | Yes, expected                               | Yes, expected in real browser              | Yahoo consent; no account change               | Scoped tokens, callback/state, refresh/revocation                 | Best basis if grant covers actual use           | Medium integration and parity proof   | Yahoo approval; writes **unconfirmed**       | Low–medium                            |
| Yahoo read-only OAuth                              | Yes                                         | Expected                                   | Consent                                        | Read tokens only                                                  | Approved reads only                             | Medium                                | Yahoo approval                               | Low–medium; **no writes**             |
| Authorized partner with delegated writes           | Depends on partner                          | Depends                                    | Partner consent                                | Additional token custodian                                        | Must prove licensing/write rights               | Medium, plus vendor fees              | Yahoo/partner contract; no verified vendor   | Vendor dependency                     |
| Managed identity broker alone                      | Yes for identity                            | Yes for identity                           | Consent                                        | Extra identity processor                                          | No Fantasy authority created                    | Low–medium but **no capture**         | Broker configuration                         | Low; wrong capability                 |
| Current hosted headless/CDP                        | Browser display yes; usable mobile unproved | **No, observed refusal**                   | None installed; remote login                   | Input relay, broad session, ephemeral unsandboxed browser, egress | Y; Google browser conflict                      | Already built; mobile UX work remains | No app store                                 | High browser/login churn              |
| Reverse-proxy login/direct credential relay        | Page can display, reliable auth unproved    | Google secure-browser conflict             | No install; opaque credential relay            | Password/session interception and rewritten origins               | Y + Google policy; dishonest if disguised       | High, brittle and unacceptable        | No store; provider permission absent         | Very high login/security churn        |
| Genuine headed remote desktop, no login automation | Plausible; unproved                         | **Unknown**                                | No local install with web client               | Full desktop/browser, input relay, profile extraction             | Y; Google product classification unresolved     | High                                  | Provider policy clearance, not store         | High; display/input/browser/infra     |
| Yahoo password + existing hosted capture           | Possible; mobile input unproved             | Conditional on same-account password setup | **Account-security change**, then remote login | New password surface plus hosted risks                            | Yahoo-supported password operation; Y remains   | Low spike, then mobile UX             | No store; owner consent and Yahoo permission | Medium–high                           |
| Existing Account Key + hosted capture              | Conditional                                 | Unknown eligibility                        | Existing Yahoo app/setup; approval             | Approval phishing risk plus hosted session                        | Supported auth subset; Y remains                | Low spike                             | No Lineupkeep store app                      | Medium; limited population            |
| Yahoo codes/recovery + hosted capture              | Conditional on offered flow                 | Unknown                                    | Code/app switching; possibly password creation | Recovery proof plus hosted session                                | Provider-offered auth only; Y remains           | Low spike, uncertain coverage         | No store                                     | Medium–high                           |
| Passkey QR into cloud browser                      | **No standard remote proximity path**       | Not a solution as proposed                 | Passkey enrollment/device requirements         | Would need privileged authenticator relay                         | Do not defeat proximity protections; Y remains  | High; no established design           | OS/provider integration                      | High/unknown                          |
| Desktop Chromium extension                         | No, desktop only                            | Yes, if person signs in normally           | Extension and cookie permissions               | Browser session and update supply chain                           | Y; disclose session export                      | Medium                                | Browser-store review/distribution            | Medium–high                           |
| Firefox desktop/Android extension                  | Android subset, not iOS                     | Expected                                   | Add-on; possibly browser change/sign-in        | Same privileged cookie risks                                      | Y                                               | Medium                                | Mozilla signing/review                       | Medium–high                           |
| Safari macOS/iOS extension                         | Safari mobile only                          | Expected                                   | App install, enable, site grant                | Cookie-capable signed extension                                   | Y; consent/privacy requirements                 | High for this project                 | **Apple program/review, owner excludes**     | High                                  |
| Chrome Android/iOS; Firefox iOS extension          | **No supported route**                      | No capture                                 | Platform change would be required              | N/A                                                               | Not an option in those browsers                 | Not applicable                        | Platform capability absent                   | Not applicable                        |
| Other extension-capable mobile browser             | Limited subset                              | Expected, not tested                       | Often browser + extension install              | Privileged session export                                         | Y; API compatibility unproved                   | Medium–high                           | Browser-specific distribution                | High fragmentation                    |
| Local CLI or desktop native helper                 | No independent mobile onboarding            | Works per existing evidence                | **Install/tooling, owner excludes**            | Local browser, scoped upload, broad session                       | Y                                               | Already built                         | Desktop distribution, not mobile store       | Medium                                |
| iOS/Android app-owned WebView                      | Phone yes; Google flow no                   | Google disallows embedded auth             | Native install; perhaps Yahoo password         | App can observe login and own web-view cookies                    | Y + Google policy; platform privacy             | High                                  | App distribution/review; Apple excluded      | High, two platforms                   |
| System auth browser/Custom Tab                     | Yes for OAuth                               | Expected supported-browser auth            | Native install unless plain web redirect       | Browser keeps cookies; app gets callback                          | Good OAuth surface, **no cookie capture**       | Medium                                | Native stores if app used                    | Medium                                |
| Share sheet/Shortcut/bookmarklet/PWA               | UI yes, **no session export**               | Sign-in yes, capture no                    | Setup; native share extension needs app        | Page-script boundary; possible over-sharing                       | Y if automated actions; no HttpOnly access      | Low–medium; wrong capability          | Apple review if native extension             | Provider-page churn                   |
| Manual cookie/HAR/cURL export                      | Not ordinary mobile                         | Technically possible                       | Devtools/debugging/export steps                | Very high overcapture/leakage risk                                | Y                                               | Low backend, high support             | None unless exporter extension               | High support burden                   |
| Desktop capture + one-use mobile pairing           | **No, desktop required**                    | Depends on desktop method                  | Desktop and its capture tool                   | Secure handoff plus underlying capture                            | Y unless authorized OAuth                       | Low–medium                            | Underlying method's gates                    | Reconnect dependence                  |
| Co-manager service identity                        | Plausible mobile web; unproved              | No customer Google capture needed          | Per-team Yahoo invitation, broad team grant    | Shared identity has cross-customer blast radius                   | Y; no Public Prize Leagues; capacity unresolved | Medium–high; ownership redesign       | Yahoo authorization, no app store            | High account/team lifecycle           |
| Support screen sharing/concierge                   | Awkward; tooling-dependent                  | Depends on extraction                      | Support appointment/control tools              | Human sees/control surface; privileged export                     | Y; substantial consent/privacy risk             | Low prototype, high operating cost    | Tool/platform permissions                    | Very high staffing                    |
| VPN/root CA/rooted-device/OS extraction            | Not acceptable onboarding                   | Does not itself solve auth                 | Invasive install/privileges                    | TLS interception/device compromise                                | Not a legitimate ordinary capture design        | High                                  | OS privileges/distribution                   | Very high                             |
| Connect later; read-only/manual assistance         | Deferral or reduced scope only              | Can avoid capture                          | Later desktop visit or manual work             | Much smaller if no session retained                               | Use approved/public access only                 | Low–medium                            | Depends on data source                       | Low–medium; **not unattended writes** |

The no-install/no-account-change column is decisive: approved delegated OAuth is the only identified general-purpose architecture with ordinary mobile UX and a clear authorization model. Its **availability** remains the obstacle. A real remote desktop changes the capture environment, not that product tradeoff or the Yahoo terms.

## 4. Recommendation and what would change it

### Choose provider-authorized delegation, not another default capture project

Recommend one bounded decision: **seek explicit Yahoo write authorization now, and make its outcome the gate for general Yahoo enrollment.** Do not spend the next implementation slice on an extension, native wrapper or remote-desktop rewrite. Do not claim existing Google-identity linking is repaired.

Why this wins:

1. It is the only identified general route that preserves the person's actual mobile browser and Google identity without installing privileged software, changing account security or streaming a desktop into a phone.
2. It replaces copying a reusable web session with provider-issued delegation and a documented refresh/revocation lifecycle. It also removes Lineupkeep from password/Google-session custody during login.
3. Yahoo has a current application channel. The unresolved write wording is a cheap external fact to settle, not a reason to assert either “impossible forever” or “ready to build.”
4. The Yahoo permission issue is larger than capture. Even a flawless no-CDP login would leave unapproved automated access unresolved. A permission inquiry addresses the dependency that matters to every candidate.

**This is not a way to ship the complete product today.** If Yahoo refuses new write access and will not authorize another route, no verified option meets all the stated requirements. The honest next owner decision would be to change provider/scope, accept a restricted and awkward flow, or defer general Yahoo enrollment. This research does not choose that product change on the owner's behalf.

### Runner-up, and why it loses

**Optional Yahoo-password setup plus current hosted capture** is the least bad near-term technical experiment because it avoids Google in the hosted browser, uses Yahoo's published recovery/security process, needs no local install or Apple approval and reuses the existing capture machinery. It loses on consumer trust/conversion, unproved account eligibility and mobile input, and the already-rejected remote-browser UX. It still needs Yahoo authorization for ongoing automation.

Co-manager invitation is the strongest different **delegation** idea, but is behind this runner-up as an immediate test of the existing integration: not all league types support it, mobile and capacity are unverified, the role is overbroad, and shared credentials break important current ownership assumptions. Genuine no-CDP remote desktop is behind both as a product investment until policy and mobile usability are established. None is automatically authorized as fallback work.

### Evidence that would change the decision

- **Toward OAuth implementation:** Yahoo issues a Lineupkeep-specific grant/agreement covering public onboarding, required data, NFL/NHL roster assignments and unattended operation. Then a separately authorized acceptance proves mobile Google-identity consent, discovery, token refresh/revocation, one bounded roster write and independent readback. An application receipt or old roster-write documentation is insufficient.
- **Away from waiting for OAuth:** an explicit Yahoo denial of new write grants with no exception route. A suggested decision checkpoint is ten business days after inquiry, not a claimed provider SLA. Silence at that checkpoint means “still unavailable/unconfirmed,” not permission to scrape.
- **Toward a restricted password flow:** with explicit owner consent, the owner's Google-identity account acquires a Yahoo password without changing account identity or losing teams, and unassisted users complete connection/reconnection in ordinary iOS/Android browsers. Suggested pilot threshold: at least four of five consented testers complete without support in three minutes, excluding time spent waiting for provider email. This is a proposed product bar, not observed performance. Yahoo authorization remains required.
- **Toward co-management:** Yahoo authorizes a service co-manager use case, clarifies capacity and supported league types, and a mobile invitation/revocation trial proves team-level delegation without exposing another owner's teams. Public Prize coverage would still be a documented exclusion unless Yahoo changes it.
- **Toward headed remote desktop:** a provider determination that this specific login/capture model is allowed, and a human-operated, unmodified-browser trial succeeds repeatedly on the actual deployment network and on both mobile platforms without anti-detection tricks. Include usable keyboard/paste/verification and acceptable cold-start evidence. One lucky login is not enough.
- **Toward a new handoff feature:** primary provider/platform documentation of a mobile session-delegation API with the needed writes. A vendor demo or browser capability announcement without credential scope/permission is insufficient.

## 5. Concrete first step: resolve the write grant before writing code

**Spend at most half a day preparing a complete inquiry for the owner to approve and send through [Yahoo's access application](https://sports.yahoo.com/developer/access/).** No new client, browser experiment, account-security change or infrastructure is required. Do not submit a misleading read-only use case to gain access first.

Suggested use-case/notes text:

> Lineupkeep is an independent fantasy-team maintenance web application, initially serving one owner with five Yahoo NFL/NHL teams, with public registration planned. Users would authorize their own teams through Yahoo OAuth in their normal desktop or mobile browser. We want to read the user's leagues, teams, roster, eligibility/locks and required scoring/availability data, and perform unattended same-roster lineup assignments for enabled teams, with readback verification. We do not add, drop or trade players, access Yahoo Mail, retain user passwords or bypass premium entitlements. Provider tokens would be encrypted, owner-scoped and deleted on disconnect.
>
> Your access form says write access is unavailable, but also invites notes for unique read/write use cases, and your API docs describe roster PUTs. Can a new application obtain permission and credentials for these NFL/NHL lineup writes? If not, is an authorized service co-manager or partner route available? We will not represent read-only approval as permission for cookie-authenticated writes.

Request explicit answers on:

1. Whether **new** applications can receive roster-write authority, with the exact grant/operations and unattended-use permission, not only Yahoo identity or read access.
2. Which agreement, attribution, commercial-use, retention, quota and security requirements apply, and whether required data are available through that grant.
3. Whether Google's federated login remains supported through Yahoo's normal mobile-browser OAuth consent flow.
4. If writes cannot be granted, whether Yahoo authorizes any specified alternative; distinguish approval of a co-manager role from approval of automated access through it.

The application needs truthful product/contact information and a user estimate. The current one-owner/five-team fact is not a forecast of public demand; the owner should supply that estimate and any required organizational information. Verify actual privacy/terms URLs before filing, without claiming a registered domain or agreement that does not exist.

**Cheap-test outcome:** a written yes/conditional path with concrete onboarding requirements, an explicit no, or unresolved availability at the checkpoint. Only the first justifies budgeting an OAuth proof. No provider reply is manufactured by this document; nothing was submitted. If the owner needs an immediately executable technical test instead, the runner-up is a single, separately consented Yahoo password-eligibility and hosted-linking trial, with no passwords/cookies in recordings or research artifacts. It tests a restricted fallback, not the recommendation's availability.

## Evidence register

Public sources were fetched on 2026-10-28. Quotes above are from those fetched pages; current admission rules and documentation can change. Community anecdotes were not used to establish provider permission or platform capability. No signed-in developer console was inspected, no provider account was accessed and no live login, cookie export or roster operation was performed for this research.

### Repository evidence

- **R1:** [Dated provider findings](fantasy-manager/RESEARCH.md), especially “Live Yahoo read verification (2026-10-25),” “Live Yahoo native write verification,” “Live Yahoo explicit assignment write verification,” and changed-write/reserve readbacks. These establish the cookie path's observed behavior, not OAuth admission or provider authorization.
- **R2:** [Hosted browser infrastructure](fantasy-manager/HOSTED-BROWSER-INFRA-PLAN.md), [deployment runbook](deployment.md#cold-starts-and-cost), and [ADR 0010](fantasy-manager/adr/0010-address-based-egress.md). Cost is an estimate; cold/warm first-frame timings are recorded measurements, not universal SLAs.
- **R3:** [Hosted browser/capture](../packages/hosted-browser/src/browser.ts), [provider URL](../packages/hosted-browser/src/provider.ts), [web completion boundary](../apps/web/src/server/hostedLinking/hostedLinkingStream.ts), [remote transport](../apps/web/src/server/hostedLinking/remoteHostedBrowser.ts), [client controller](../apps/web/src/browser/connections/useHostedLinking.ts), [input surface](../apps/web/src/browser/shared-ui/BrowserFrame.tsx), [Yahoo adapter](../packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts), and [fake cookie attributes](../apps/web/src/server/hostedLinking/fakeProvider.ts).
- **R4:** [Helper capture](../apps/linking-helper/src/ProviderBrowser.ts), [provider configuration](../apps/linking-helper/src/providers.ts), [pairing/upload command](../apps/linking-helper/src/LinkCommand.ts), and [helper documentation](../apps/linking-helper/README.md).
- **R5:** [Owner walkthrough and prior alternatives](UI-REVIEW-2026-10-28.md). Historical OAuth and Google-path conclusions are not adopted as current facts where contradicted above.
- **R6:** jj history inspected at `572f9d21` (`nykskrpn`), `efa9c642` (`vmlmktsl`) and `e031537e` (`tyqywkqy`). No source implementation changed in this research.

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
