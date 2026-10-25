import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins/jwt";
import { isNotNull } from "drizzle-orm";
import {
  Clock,
  ConfigProvider,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Tracer,
} from "effect";
import { vi } from "vitest";

import { AuthorizationScopes } from "#contexts/auth/AuthorizationScopes.ts";
import { decodeUserId } from "#contexts/auth/User.ts";
import { EmailDelivery, EmailDeliveryFailed } from "#email/EmailDelivery.ts";
import { EmailDeliveryTest, EmailOutbox } from "#email/internal/EmailDeliveryTest.ts";
import { BackgroundWork } from "#runtime/BackgroundWork.ts";
import { publicInternetProcess } from "#runtime/public-internet/transport/node/PublicInternetProcess.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { AuthDatabaseStatements, AuthDatabaseTest } from "./AuthDatabaseTest.ts";
import { user } from "./AuthTables.ts";
import * as authSchema from "./AuthTables.ts";
import { BetterAuthAdapter } from "./BetterAuthAdapter.ts";
import * as oauthSchema from "./OAuthTables.ts";
import { oauthClient, oauthRefreshToken } from "./OAuthTables.ts";
import { SignInCodeQuotaRepository } from "./SignInCodeQuotaRepository.ts";

const databaseTestTimeout = 30_000;

it.effect(
  "offers sign-in methods and resolves anonymous sessions without database statements",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const statements = yield* AuthDatabaseStatements;

      const session = yield* adapter.getSession(new Headers({ cookie: "unrelated=value" }));

      assert.strictEqual(session, undefined);
      assert.deepStrictEqual(statements, []);
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "rejects missing consent requests without initializing Auth storage",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const statements = yield* AuthDatabaseStatements;

      for (const query of [
        "",
        "client_id=",
        "client_id=not-a-url&sig=forged",
        "client_id=http%3A%2F%2Fclient.test%2Fmeta&sig=forged",
      ]) {
        assert.deepStrictEqual(yield* adapter.getConsentRequest(new Headers(), query), {
          status: "invalid",
        });
      }
      assert.deepStrictEqual(statements, []);
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "initializes concurrent Auth instances against one unseeded resource",
  () =>
    Effect.gen(function* () {
      const first = yield* BetterAuthAdapter;
      const second = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      const third = yield* Effect.provide(BetterAuthAdapter, instanceLayer);

      const replies = yield* Effect.all(
        [
          first.handle(sendCodeRequest("first@example.test", "10.0.0.1")),
          second.handle(sendCodeRequest("second@example.test", "10.0.0.2")),
          third.handle(sendCodeRequest("third@example.test", "10.0.0.3")),
        ],
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        replies.map((response) => response.status),
        [200, 200, 200],
      );
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "requires a client address header in production",
  () =>
    Effect.gen(function* () {
      const { AUTH_CLIENT_IP_HEADERS: _omitted, ...withoutClientAddress } = baseConfig;
      const layer = adapterLayer({ ...withoutClientAddress, APP_ENV: "production" });

      const exit = yield* Effect.exit(Effect.provide(BetterAuthAdapter, layer));

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(Exit.isFailure(exit) ? exit.cause : ""), "AUTH_CLIENT_IP_HEADERS");
    }),
  databaseTestTimeout,
);

it.effect(
  "emails a sign-in code that signs a new person in with a verified address",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;

      const sent = yield* adapter.handle(sendCodeRequest("new.reader@example.test"));
      const code = yield* latestCode("new.reader@example.test");
      const signedIn = yield* adapter.handle(signInRequest("new.reader@example.test", code));

      const session = yield* adapter.getSession(new Headers({ cookie: cookieHeader(signedIn) }));
      const users = yield* Effect.promise(() => database.select().from(user));
      assert.strictEqual(sent.status, 200);
      assert.strictEqual(signedIn.status, 200);
      assert.strictEqual(session?.user.email, "new.reader@example.test");
      assert.deepStrictEqual(
        users.map(({ email, emailVerified, name }) => ({ email, emailVerified, name })),
        [{ email: "new.reader@example.test", emailVerified: true, name: "" }],
      );
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "sends a sign-in code without revealing it outside the message",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const outbox = yield* EmailOutbox;

      const response = yield* adapter.handle(sendCodeRequest("reader@example.test"));

      const [message] = yield* outbox.messages;
      const code = codeIn(message?.text ?? "");
      assert.strictEqual(message?.to, "reader@example.test");
      assert.strictEqual(message?.subject, `${code} is your Lineupkeep sign-in code`);
      assert.include(message?.text ?? "", "expires in 10 minutes");
      assert.notInclude(yield* Effect.promise(() => response.text()), code);
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "rejects a wrong code and voids the code after three wrong attempts",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      yield* adapter.handle(sendCodeRequest("reader@example.test"));
      const code = yield* latestCode("reader@example.test");
      const wrong = code === "000000" ? "111111" : "000000";
      const attempt = (
        otp: string,
        address: string,
      ): Effect.Effect<
        {
          status: number;
          code: string | undefined;
        },
        import("#contexts/auth/Auth.ts").AuthenticationUnavailable,
        never
      > =>
        Effect.flatMap(adapter.handle(signInRequest("reader@example.test", otp, address)), errorOf);

      const results = [
        yield* attempt(wrong, "10.0.0.1"),
        yield* attempt(wrong, "10.0.0.2"),
        yield* attempt(wrong, "10.0.0.3"),
        yield* attempt(code, "10.0.0.4"),
      ];

      assert.deepStrictEqual(results, [
        { status: 400, code: "INVALID_OTP" },
        { status: 400, code: "INVALID_OTP" },
        { status: 400, code: "INVALID_OTP" },
        { status: 403, code: "TOO_MANY_ATTEMPTS" },
      ]);
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "limits codes for one address to five an hour, from any client",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const outbox = yield* EmailOutbox;
      const send = (
        address: string,
      ): Effect.Effect<number, import("#contexts/auth/Auth.ts").AuthenticationUnavailable, never> =>
        Effect.map(
          adapter.handle(sendCodeRequest("Target@Example.test", address)),
          (response) => response.status,
        );

      const statuses = [];
      for (const address of ["10.0.1.1", "10.0.1.2", "10.0.1.3", "10.0.1.4", "10.0.1.5"]) {
        statuses.push(yield* send(address));
      }
      const limited = yield* adapter.handle(sendCodeRequest("target@example.test", "10.0.1.6"));

      assert.deepStrictEqual(statuses, [200, 200, 200, 200, 200]);
      assert.strictEqual(limited.status, 429);
      assert.match(limited.headers.get("X-Retry-After") ?? "", /^\d+$/u);
      assert.strictEqual((yield* outbox.messages).length, 5);
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "enforces client rate limits recorded in the database shared by instances",
  () =>
    Effect.gen(function* () {
      const first = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      const second = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      const attempt = (
        adapter: typeof first,
      ): Effect.Effect<number, import("#contexts/auth/Auth.ts").AuthenticationUnavailable, never> =>
        Effect.map(
          adapter.handle(signInRequest("nobody@example.test", "123456", "10.0.0.7")),
          (response) => response.status,
        );

      const statuses = [
        yield* attempt(first),
        yield* attempt(second),
        yield* attempt(first),
        yield* attempt(second),
      ];

      assert.notStrictEqual(statuses[2], 429);
      assert.strictEqual(statuses[3], 429);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          AuthDatabaseTest,
          BackgroundWork.processLifetime,
          EmailDeliveryTest,
          publicInternetProcess,
        ),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "reports a code it could not deliver instead of claiming it was sent",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const response = yield* adapter.handle(sendCodeRequest("reader@example.test"));

      assert.deepStrictEqual(yield* errorOf(response), {
        status: 503,
        code: "EMAIL_UNAVAILABLE",
      });
    }).pipe(Effect.provide(adapterLayer(baseConfig, unavailableEmail))),
  databaseTestTimeout,
);

it.effect(
  "offers no password sign-up or sign-in",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const credentials = {
        email: "reader@example.test",
        password: "correct-horse-battery-staple",
      };

      const signUp = yield* adapter.handle(
        authRequest("/sign-up/email", { ...credentials, name: "Reader" }),
      );
      const signIn = yield* adapter.handle(authRequest("/sign-in/email", credentials));

      assert.deepStrictEqual(yield* errorOf(signUp), {
        status: 400,
        code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
      });
      assert.deepStrictEqual(yield* errorOf(signIn), {
        status: 400,
        code: "EMAIL_PASSWORD_DISABLED",
      });
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "offers Google sign-in only when its credentials are configured",
  () =>
    Effect.gen(function* () {
      const withoutGoogle = yield* Effect.provide(BetterAuthAdapter, adapterLayer(baseConfig));

      const withGoogle = yield* Effect.provide(BetterAuthAdapter, adapterLayer(googleConfig));

      assert.deepStrictEqual(withoutGoogle.signInMethods, { google: false });
      assert.deepStrictEqual(withGoogle.signInMethods, { google: true });
    }),
  databaseTestTimeout,
);

it.effect(
  "starts Google sign-in at Google with this deployment's callback",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const response = yield* adapter.handle(
        authRequest("/sign-in/social", { provider: "google", callbackURL: "/connections" }),
      );

      const body = yield* jsonOf(response, Schema.Struct({ url: Schema.String }));
      const authorization = new URL(body.url);
      assert.strictEqual(authorization.origin, "https://accounts.google.com");
      assert.strictEqual(authorization.searchParams.get("client_id"), "google-client-id");
      assert.strictEqual(
        authorization.searchParams.get("redirect_uri"),
        "http://localhost:5173/api/auth/callback/google",
      );
      assert.strictEqual(authorization.searchParams.get("scope"), "email profile openid");
      assert.strictEqual(authorization.searchParams.get("prompt"), "select_account");
    }).pipe(Effect.provide(adapterLayer(googleConfig))),
  databaseTestTimeout,
);

it.effect(
  "continues Google sign-in through the signed OAuth query and provider hooks",
  () =>
    Effect.gen(function* () {
      const keys = yield* Effect.promise(() =>
        crypto.subtle.generateKey(
          {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["sign", "verify"],
        ),
      );
      const jwk = yield* Effect.promise(() => crypto.subtle.exportKey("jwk", keys.publicKey));
      let googleToken = "";
      vi.stubGlobal("fetch", (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.href === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            Response.json({
              access_token: "google-test-access",
              id_token: googleToken,
              token_type: "Bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
          return Promise.resolve(
            Response.json({ keys: [{ ...jwk, kid: "google-test-key", alg: "RS256", use: "sig" }] }),
          );
        }
        return Promise.reject(new Error("Unexpected external endpoint in Google test"));
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllGlobals()));
      const adapter = yield* BetterAuthAdapter;
      const verifier = "1234567890123456789012345678901234567890123";
      const hash = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      );
      const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const query = new URLSearchParams({
        response_type: "code",
        client_id: "https://connections-client.test/client.json",
        redirect_uri: "http://127.0.0.1:19999/callback",
        resource: "http://localhost:5173/mcp",
        scope: "connections:read",
        state: "client-state",
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const authorization = yield* adapter.handle(
        new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`),
      );
      const login = new URL(
        authorization.headers.get("location") ?? "",
        baseConfig.BETTER_AUTH_URL,
      );
      assert.strictEqual(login.pathname, "/auth");

      const social = yield* adapter.handle(
        authRequest("/sign-in/social", {
          provider: "google",
          callbackURL: "/connections",
          oauth_query: login.search.slice(1),
        }),
      );
      const destination = new URL(
        (yield* jsonOf(social, Schema.Struct({ url: Schema.String }))).url,
      );
      const issuedAt = Math.floor((yield* Clock.Clock.defaultValue().currentTimeMillis) / 1000);
      const header = yield* tokenSegment({ alg: "RS256", kid: "google-test-key" });
      const claims = yield* tokenSegment({
        sub: "google-user",
        name: "Google Reader",
        email: "google-oauth@example.test",
        email_verified: true,
        iss: "https://accounts.google.com",
        aud: "google-client-id",
        iat: issuedAt,
        exp: issuedAt + 3600,
        nonce: destination.searchParams.get("nonce"),
      });
      const unsigned = `${header}.${claims}`;
      const signature = yield* Effect.promise(() =>
        crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          keys.privateKey,
          new TextEncoder().encode(unsigned),
        ),
      );
      googleToken = `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
      const callback = new URL("/api/auth/callback/google", baseConfig.BETTER_AUTH_URL);
      callback.search = new URLSearchParams({
        code: "google-code",
        state: destination.searchParams.get("state") ?? "",
      }).toString();
      const returned = yield* adapter.handle(
        new Request(callback, { headers: { cookie: cookieHeader(social), accept: "text/html" } }),
      );

      assert.strictEqual(returned.status, 302);
      const consent = new URL(returned.headers.get("location") ?? "", baseConfig.BETTER_AUTH_URL);
      assert.strictEqual(consent.pathname, "/consent");
      assert.strictEqual(consent.searchParams.get("state"), "client-state");
      assert.strictEqual(
        consent.searchParams.get("client_id"),
        "https://connections-client.test/client.json",
      );
      assert.isTrue(consent.searchParams.has("sig"));
      assert.strictEqual(
        (yield* adapter.getSession(new Headers({ cookie: cookieHeader(returned) })))?.user.email,
        "google-oauth@example.test",
      );
    }).pipe(Effect.provide(adapterLayer(googleConfig, EmailDeliveryTest, testMetadata))),
  databaseTestTimeout,
);

it.effect(
  "refuses to start with only half of the Google credentials",
  () =>
    Effect.gen(function* () {
      const layer = adapterLayer({ ...baseConfig, GOOGLE_CLIENT_ID: "google-client-id" });

      const exit = yield* Effect.exit(Effect.provide(BetterAuthAdapter, layer));

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(Exit.isFailure(exit) ? exit.cause : ""), "GOOGLE_CLIENT_SECRET");
    }),
  databaseTestTimeout,
);

it.effect(
  "resolves only unexpired local access tokens for the resource and required scopes",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      const signer = betterAuth({
        baseURL: baseConfig.BETTER_AUTH_URL,
        secret: baseConfig.BETTER_AUTH_SECRET,
        database: drizzleAdapter(database, {
          provider: "pg",
          schema: { ...authSchema, ...oauthSchema },
        }),
        plugins: [
          jwt({
            jwt: {
              issuer: "http://localhost:5173/api/auth",
              audience: "http://localhost:5173/mcp",
            },
          }),
        ],
      });
      const token = (
        claims: Record<string, unknown>,
      ): Effect.Effect<
        {
          token: string;
        },
        never,
        never
      > =>
        Effect.promise(() =>
          signer.api.signJWT({
            body: {
              payload: { sub: "reader", scope: "connections:read", exp: 4_000_000_000, ...claims },
            },
          }),
        );

      const valid = yield* token({});
      const wrongAudience = yield* token({ aud: "https://other.example/mcp" });
      const expired = yield* token({ exp: 1 });
      const wrongIssuer = yield* token({ iss: "https://other.example/api/auth" });
      const proofBound = yield* token({ cnf: { jkt: "proof-required" } });

      assert.deepStrictEqual(yield* adapter.resolveAccessToken(valid.token, ["connections:read"]), {
        status: "authenticated",
        userId: decodeUserId("reader"),
      });
      assert.deepStrictEqual(
        yield* adapter.resolveAccessToken(valid.token, ["connections:write"]),
        {
          status: "insufficient_scope",
        },
      );
      for (const invalid of [
        wrongAudience.token,
        expired.token,
        wrongIssuer.token,
        proofBound.token,
        "not.a.token",
      ]) {
        assert.deepStrictEqual(yield* adapter.resolveAccessToken(invalid, ["connections:read"]), {
          status: "invalid",
        });
      }
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "authorizes a cold metadata client concurrently across independent auth instances",
  () =>
    Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const first = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      const second = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      const query = new URLSearchParams({
        response_type: "code",
        client_id: "https://connections-client.test/client.json",
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: "connections:read",
        resource: "http://localhost:5173/mcp",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      });

      const responses = yield* Effect.all(
        [
          first.handle(
            new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}&state=first`),
          ),
          second.handle(
            new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}&state=second`),
          ),
        ],
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(
        responses.map((response) => response.status),
        [302, 302],
      );
      const returned = responses.map(
        (response) => new URL(response.headers.get("location") ?? "", baseConfig.BETTER_AUTH_URL),
      );
      assert.deepStrictEqual(
        returned.map((url) => url.pathname),
        ["/auth", "/auth"],
      );
      assert.deepStrictEqual(
        returned.map((url) => url.searchParams.get("state")),
        ["first", "second"],
      );
      const clients = yield* Effect.promise(() => database.select().from(oauthClient));
      const metadataClients = clients.filter(
        (client) => client.clientId === "https://connections-client.test/client.json",
      );
      assert.strictEqual(metadataClients.length, 1);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          AuthDatabaseTest,
          BackgroundWork.processLifetime,
          EmailDeliveryTest,
          testMetadata,
        ),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "approves a signed authorization query and exchanges its code with PKCE",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      yield* adapter.handle(sendCodeRequest("oauth@example.test"));
      const signedIn = yield* adapter.handle(
        signInRequest("oauth@example.test", yield* latestCode("oauth@example.test")),
      );
      const headers = new Headers({ cookie: cookieHeader(signedIn) });
      const verifier = "1234567890123456789012345678901234567890123";
      const hash = yield* Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      );
      const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const query = new URLSearchParams({
        response_type: "code",
        client_id: "https://connections-client.test/client.json",
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: "connections:read connections:write offline_access",
        resource: "http://localhost:5173/mcp",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "oauth-state",
      });
      const spans: Array<Tracer.Span> = [];
      const response = yield* adapter
        .handle(
          new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`, { headers }),
        )
        .pipe(
          Effect.withTracer(
            Tracer.make({
              span: (options) => {
                const span = new Tracer.NativeSpan(options);
                spans.push(span);
                return span;
              },
            }),
          ),
        );
      const location = new URL(response.headers.get("location") ?? "", baseConfig.BETTER_AUTH_URL);

      const client = yield* adapter.getConsentRequest(headers, location.search.slice(1));
      assert.deepStrictEqual(client, {
        status: "valid",
        client: {
          id: "https://connections-client.test/client.json",
          name: "Lineupkeep test client",
          host: "connections-client.test",
        },
        scopes: [
          ...testScopeDefinitions,
          {
            name: "offline_access",
            description:
              "Stay connected with renewable access until this authorization expires or is revoked.",
          },
        ],
      });
      const consent = yield* adapter.consent(headers, location.search.slice(1), true);
      const code = new URL(consent).searchParams.get("code");
      const exchanged = yield* adapter.handle(
        new Request("http://localhost:5173/api/auth/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "https://connections-client.test/client.json",
            redirect_uri: "http://127.0.0.1:19999/callback",
            resource: "http://localhost:5173/mcp",
            code_verifier: verifier,
            code: code ?? "",
          }),
        }),
      );

      const metadataSpan = spans.find((span) => span.name === "PublicInternet.request");
      const handlerSpan = spans.find((span) => span.name === "AuthService.handle");
      assert.isDefined(handlerSpan);
      assert.strictEqual(metadataSpan?.kind, "client");
      assert.strictEqual(
        Option.getOrUndefined(metadataSpan?.parent ?? Option.none())?.spanId,
        handlerSpan.spanId,
      );
      assert.strictEqual(metadataSpan?.attributes.get("http.response.status_code"), 200);
      const exported = spans
        .flatMap((span) => [span.name, ...[...span.attributes].flat().map(String)])
        .join("\n");
      assert.notInclude(exported, "oauth@example.test");
      assert.notInclude(exported, cookieHeader(signedIn));
      assert.notInclude(exported, location.searchParams.get("sig") ?? "missing-signature");
      assert.strictEqual(location.pathname, "/consent");
      assert.isNotNull(code);
      assert.strictEqual(exchanged.status, 200);
      const credentials = yield* jsonOf(
        exchanged,
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      );
      const refresh = (
        token: string,
      ): Effect.Effect<
        Response,
        import("#contexts/auth/Auth.ts").AuthenticationUnavailable,
        never
      > =>
        adapter.handle(
          new Request("http://localhost:5173/api/auth/oauth2/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: "https://connections-client.test/client.json",
              resource: "http://localhost:5173/mcp",
              refresh_token: token,
            }),
          }),
        );
      const rotatedResponse = yield* refresh(credentials.refresh_token);
      assert.strictEqual(rotatedResponse.status, 200);
      const rotated = yield* jsonOf(
        rotatedResponse,
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      );
      assert.notStrictEqual(rotated.refresh_token, credentials.refresh_token);
      assert.propertyVal(
        yield* adapter.resolveAccessToken(rotated.access_token, ["connections:write"]),
        "status",
        "authenticated",
      );
      const replay = yield* jsonOf(
        yield* refresh(credentials.refresh_token),
        Schema.Struct({ refresh_token: Schema.String }),
      );
      assert.strictEqual(replay.refresh_token, rotated.refresh_token);
      const signedOut = yield* adapter.handle(
        authRequest("/sign-out", {}, { cookie: cookieHeader(signedIn) }),
      );
      assert.strictEqual(signedOut.status, 200);
      const offline = yield* jsonOf(
        yield* refresh(rotated.refresh_token),
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      );
      assert.propertyVal(
        yield* adapter.resolveAccessToken(offline.access_token, ["connections:read"]),
        "status",
        "authenticated",
      );
      const revoked = yield* adapter.handle(
        new Request("http://localhost:5173/api/auth/oauth2/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: "https://connections-client.test/client.json",
            token: offline.refresh_token,
            token_type_hint: "refresh_token",
          }),
        }),
      );
      assert.strictEqual(revoked.status, 200);
      assert.strictEqual((yield* refresh(offline.refresh_token)).status, 400);
      assert.propertyVal(
        yield* adapter.resolveAccessToken(offline.access_token, ["connections:read"]),
        "status",
        "authenticated",
      );

      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database
          .update(oauthRefreshToken)
          .set({ rotationReplayExpiresAt: DateTime.toDateUtc(DateTime.makeUnsafe(0)) })
          .where(isNotNull(oauthRefreshToken.revoked)),
      );
      assert.strictEqual((yield* refresh(credentials.refresh_token)).status, 400);
      const identity = yield* adapter.resolveAccessToken(credentials.access_token, [
        "connections:write",
      ]);
      assert.propertyVal(identity, "status", "authenticated");
      assert.propertyVal(identity, "userId", (yield* adapter.getSession(headers))?.user.id);
    }).pipe(
      Effect.provide(
        adapterLayer(
          baseConfig,
          EmailDeliveryTest,
          PublicInternet.fromTransport((request) =>
            Promise.resolve(
              Response.json({
                client_id: request.url,
                client_name: "Lineupkeep test client",
                redirect_uris: ["http://127.0.0.1:19999/callback"],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none",
              }),
            ),
          ),
        ),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "keeps CIMD's 5 KiB limit stricter than the general HTTP response cap",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const authorization = new URL("http://localhost:5173/api/auth/oauth2/authorize");
      authorization.search = new URLSearchParams({
        client_id: "https://large-client.test/client.json",
        redirect_uri: "http://127.0.0.1:19999/callback",
        response_type: "code",
        scope: "connections:read",
        resource: "http://localhost:5173/mcp",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }).toString();

      const response = yield* adapter.handle(new Request(authorization));
      const body = yield* Effect.promise(() => response.text());

      assert.strictEqual(response.status, 400);
      assert.include(body, "5KB size limit");
    }).pipe(
      Effect.provide(
        adapterLayer(
          baseConfig,
          EmailDeliveryTest,
          PublicInternet.fromTransport((request) =>
            Promise.resolve(
              Response.json({
                client_id: request.url,
                client_name: "x".repeat(6_000),
                redirect_uris: ["http://127.0.0.1:19999/callback"],
                token_endpoint_auth_method: "none",
              }),
            ),
          ),
        ),
      ),
    ),
  databaseTestTimeout,
);

const testMetadata = PublicInternet.fromTransport((request) =>
  Promise.resolve(
    Response.json({
      client_id: request.url,
      client_name: "Lineupkeep test client",
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  ),
);

const testScopeDefinitions = [
  { name: "connections:read", description: "Read test documents." },
  { name: "connections:write", description: "Change test documents." },
] as const;
const testScopes = Layer.succeed(AuthorizationScopes)(testScopeDefinitions);

const baseConfig = {
  DATABASE_URL: "postgres://test:test@localhost:1/lineupkeep_test",
  BETTER_AUTH_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
  APP_ENV: "test",
  AUTH_CLIENT_IP_HEADERS: "x-forwarded-for",
};

const googleConfig = {
  ...baseConfig,
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

const unavailableEmail = Layer.merge(
  EmailDeliveryTest,
  Layer.succeed(EmailDelivery)({
    send: () => Effect.fail(EmailDeliveryFailed.make({ reason: "unavailable" })),
  }),
);

function adapterLayer(
  config: Record<string, string>,
  email: Layer.Layer<EmailDelivery | EmailOutbox> = EmailDeliveryTest,
  internet: Layer.Layer<PublicInternet> = publicInternetProcess,
): Layer.Layer<
  | AuthDatabase
  | AuthDatabaseStatements
  | BackgroundWork
  | BetterAuthAdapter
  | import("effect/Crypto").Crypto
  | EmailDelivery
  | EmailOutbox
  | PublicInternet
  | SignInCodeQuotaRepository,
  import("effect/Config").ConfigError,
  never
> {
  return BetterAuthAdapter.layer.pipe(
    Layer.provideMerge(SignInCodeQuotaRepository.layer),
    Layer.provide(testScopes),
    Layer.provideMerge(
      Layer.mergeAll(
        AuthDatabaseTest,
        BackgroundWork.processLifetime,
        email,
        NodeCrypto.layer,
        internet,
      ),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  );
}

const instanceLayer = Layer.fresh(BetterAuthAdapter.layer).pipe(
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(testScopes),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(baseConfig))),
);

function latestCode(email: string): Effect.Effect<string, never, EmailOutbox> {
  return Effect.map(EmailOutbox, (outbox) => outbox.messages).pipe(
    Effect.flatten,
    Effect.map((messages) =>
      codeIn(messages.findLast((message) => message.to === email)?.text ?? ""),
    ),
  );
}

function codeIn(text: string): string {
  return /\b(\d{6})\b/u.exec(text)?.[1] ?? "";
}

function sendCodeRequest(email: string, clientAddress = "10.0.0.1"): Request {
  return authRequest(
    "/email-otp/send-verification-otp",
    { email, type: "sign-in" },
    { "x-forwarded-for": clientAddress },
  );
}

function signInRequest(email: string, otp: string, clientAddress = "10.0.0.1"): Request {
  return authRequest("/sign-in/email-otp", { email, otp }, { "x-forwarded-for": clientAddress });
}

function tokenSegment(value: unknown): Effect.Effect<string, Schema.SchemaError, never> {
  return Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(
    Effect.map((json) => Buffer.from(json).toString("base64url")),
  );
}

function authRequest(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost:5173/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173", ...headers },
    body: JSON.stringify(body),
  });
}

function errorOf(response: Response): Effect.Effect<
  {
    status: number;
    code: string | undefined;
  },
  never,
  never
> {
  return Effect.map(jsonOf(response, ErrorBody), (body) => ({
    status: response.status,
    code: body.code,
  }));
}

function jsonOf<S extends Schema.Top & { readonly DecodingServices: never }>(
  response: Response,
  schema: S,
): Effect.Effect<S["Type"], never, S["DecodingServices"]> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.orDie,
  );
}

const ErrorBody = Schema.Struct({ code: Schema.optional(Schema.String) });

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
