# Address-based egress for hosted linking

## Context

The hosted browser used a static allowlist of Yahoo origins plus a Chromium resolver rule that made every
other hostname fail to resolve. That combination could not complete a sign-in for a Yahoo account whose
identity is a Google account. Yahoo's "Sign in with Google" opens a separate browsing target on Google's
identity origins; the browser closed every new page and the egress policy aborted the navigation. The user
saw a blank page that never resolved.

The allowlist also put the maintenance burden on us. Every provider login change, identity-provider
addition, asset host, or new provider needed a code and deployment change. When one was missed, the
failure was silent. The owner's direction was to remove the static host allowlist and keep the
provider-independent protections.

The threat model is:

- SSRF from the browser into our own network. The browser runs inside a Cloud Run service, so a page must
  never reach the GCP metadata endpoint, loopback, private ranges, link-local addresses, CGNAT, or our
  internal services.
- The service used as a free headless browser. This is bounded by the owner-bound one-use ticket, the
  session lifetime, one active session per owner, and a per-owner session start limit.
- Session theft. A host allowlist does not protect the provider session; the same-origin policy prevents
  another origin reading the provider's cookies. Capture after the provider accepts the sign-in, provider
  validation, and profile destruction are the protections.
- A provider changing its login chain. A blocked destination must be a specific, recorded, visible
  refusal rather than a blank page.

## Decision

**Egress is decided by resolved address, not by hostname.**

Each hosted browser session starts a local HTTP forward proxy. Chromium is configured to use that proxy
for all HTTP, HTTPS, WebSocket, and secure WebSocket traffic. Chromium's own resolver stays blackholed, so
the proxy is the only name-resolution and connection path. The proxy:

1. Accepts `CONNECT host:port` for TLS and WebSocket destinations, and absolute-form HTTP requests.
2. Resolves the destination hostname on every connection, or uses the literal address when the
   destination is an IP.
3. Refuses the destination if any resolved address is not a public internet address.
4. Dials the verified address directly and tunnels or forwards the traffic. It never re-resolves the
   hostname after the check.

Chromium is started with the proxy, without the implicit loopback bypass, with QUIC disabled, with
non-proxied WebRTC UDP disabled, with DNS prefetching disabled, and with `--host-resolver-rules=MAP *
~NOTFOUND, EXCLUDE 127.0.0.1` so only the proxy's loopback socket can be resolved. Service workers remain
blocked.

The refused address classes are:

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
  `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`,
  `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, and `240.0.0.0/4`.
- IPv6: anything outside `2000::/3`, plus the non-global parts of that range (`2001::/32`,
  `2001:2::/48`, `2001:10::/28`, `2001:20::/28`, `2001:db8::/32`, `2002::/16`, and `3fff::/20`).
- IPv4-mapped IPv6 addresses are classified by the embedded IPv4 address.

**This is robust to DNS rebinding because the check and the connection are the same decision.** A public
name can resolve to a private address; the proxy sees that answer and refuses it. If a name resolves to
both a public and a private address, the whole destination is refused. If a later request gets a
different answer, it is checked again. The browser cannot make an independent DNS query or a direct
connection, because its resolver is blackholed, its proxy bypass is disabled, QUIC and non-proxied WebRTC
are off, and the proxy is the only listener it can reach.

**A development fixture is the only loopback exception.** Local development and tests use a stand-in
provider on loopback. The local Playwright browser accepts exactly one explicitly supplied fixture origin
when the environment is not production. The fixture origin must use a loopback host and is matched by
host and port. The deployed hosted-browser service receives no fixture origin, so every loopback
destination is refused there.

**Popups are first-class browsing targets.** The browser no longer closes new pages. The context tracks
every page in activation order, streams whichever target is active, and applies input to the active
target. A new page, including a `window.open` identity-provider popup, becomes active. When it closes, the
stream and input return to the most recently active page that is still open, usually the provider page.
Dialogs and downloads are dismissed on every target. Closing the session closes the context, so no popup
or target can outlive it.

**Refusals are loud.** A refused HTTP request gets a readable 403 page naming the host and the reason. A
refused tunnel gets a 403 response. The browser sends a `Refused` control message to the client with the
host and reason, and the hosted-browser service records the unique refusals in its
`hosted_browser.session` outcome. The Connections surface shows the host and the reason instead of a
blank frame.

**The remaining protections are provider-independent.** Keep the one-use owner-bound ticket, the
HMAC-signed short-lived descriptor, the one-active-session lock, the ephemeral profile destroyed on
capture, cancel, expiry, fault, or shutdown, dialog dismissal, download cancellation, bounded frames and
input, and capture of `T`/`Y` only from cookies that would be sent to the provider login URL. Provider
validation remains authoritative before a connection is stored. Remove the provider origin allowlist and
the host list in the descriptor entirely.

**The per-owner session limit is unchanged and now carries more of the abuse cost.** An owner may start
five hosted sessions in ten minutes and may have one active hosted session at a time. It is enforced in
the backend `HostedLinking.start` path, by `countStartsSince` over the owner's session records and the
unique `hosted_linking_session_locks` row. The browser service also allows only one live browser per
instance, with Cloud Run concurrency 1 and a maximum of two instances.

## Consequences

- A Yahoo account with a Google identity can complete hosted linking. Google's identity origins and any
  future provider or identity-chain host are reachable without a code change.
- The browser can reach any public internet destination. That widens the service's reach and the
  consequences of a malicious page or a Chromium compromise. Abuse is bounded by the ticket, session
  lifetime, one active session per owner, the five-start limit, and per-instance concurrency, not by a
  host list.
- The service is still not a general proxy: it is a per-owner, one-use, short-lived browser session with
  an address-filtered network path. It is not a network-level egress boundary. No VPC connector, Cloud
  NAT, or dedicated egress proxy is provisioned, so a future network-level control would be defense in
  depth, not a replacement for this policy.
- The local forward proxy and its address classifier are application code that must be kept current.
  The refused ranges and the proxy behavior have regression tests, including metadata, loopback, RFC1918,
  link-local, CGNAT, a public destination, a public name resolving to a private address, and a name whose
  answer changes between connections.
- Popup handling adds concurrent pages to an ephemeral profile. Each target is closed with the context,
  and input and frames follow the active target rather than a fixed first page.
- A provider that requires a non-HTTP protocol, a browser extension, or a client certificate that the
  proxy cannot carry will still fail. The difference is that the refusal names the host and reason.

## Residual risk

- **Public reach.** The browser can reach any public address. A malicious page could use CPU, bandwidth,
  or public services for the duration of the session. The one-use owner ticket, ten-minute expiry, one
  active session, five starts per ten minutes, and per-instance concurrency are the cost ceiling.
- **Application-level boundary.** The proxy is inside the same process as Chromium. A Chromium
  compromise or a proxy implementation defect could bypass the policy. Chromium is pinned and updated
  deliberately; the container is single-tenant, non-root, and immutable, but its namespace sandbox is
  unavailable in Cloud Run.
- **DNS trust.** The proxy trusts the system resolver's answers. It validates every returned address and
  dials the validated address, so a hostile answer cannot redirect the connection to a private address.
  Search-domain or resolver behavior can still make a legitimate provider name unresolvable.
- **Capture scope.** Capture reads only cookies that would be sent to the provider login URL, and the web
  provider still validates them before storing a connection. A hostile page that can set cookies for the
  provider's domain is outside the browser's isolation model; the provider's own origin policy owns that
  boundary.
- **No network isolation.** The policy does not prove that a public address is not routed to an internal
  service through unusual cloud routing. The refused ranges cover the documented metadata, loopback,
  private, link-local, and CGNAT destinations.
- **Google's supported-browser gate.** Google refuses sign-ins from browsers it classifies as
  software-controlled or embedded, even when a person is operating them. The hosted browser is a
  remote-controlled Chromium, so a Google-identity Yahoo sign-in can be refused after Google's page
  loads. This is an external policy boundary, not an egress defect. Do not work around it by spoofing
  browser signals without an explicit owner decision and a policy review.

## Revisit when

- The host is used for anything other than a short interactive sign-in.
- Abuse evidence shows the per-owner limits are not a sufficient cost ceiling.
- A network-level egress boundary becomes affordable and is approved; it should be added as defense in
  depth, not used to reintroduce a host allowlist.
- A provider needs a protocol the proxy cannot carry, or a refusal class needs to change.
- Chromium updates or a proxy defect put the address check in doubt.

## Alternatives rejected

- **Keep the Yahoo allowlist and add Google's origins.** It fixes one provider's current chain and keeps
  the maintenance and silent-breakage problem.
- **Use a hostname deny list.** A public name can resolve to a private address, and the list still needs
  maintenance for every internal name.
- **Keep Chromium's resolver blackhole and add exact exclusions.** The rule can express "these names
  resolve" but not "public but not private" without enumerating the public internet.
- **Use a browser-level request interceptor instead of a proxy.** Chromium's network stack can still make
  connections that the interceptor does not mediate, and the check would still need a resolution and
  connection step.
- **Provision a VPC connector and Cloud NAT or a managed egress proxy.** It would add a recurring charge
  above the owner's budget. It is a useful future defense in depth, not a replacement for the address
  policy.
- **Keep closing popups and hand Google-identity users to the local helper.** The helper has been
  removed, there is no alternate capture path, and the primary path must work for the owner's own
  account.
