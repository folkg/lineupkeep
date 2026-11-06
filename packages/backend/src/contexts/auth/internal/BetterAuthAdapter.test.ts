import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins/jwt";
import { eq, isNotNull } from "drizzle-orm";
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

import type { AuthServiceShape } from "#contexts/auth/Auth.ts";
import { AuthorizationScopes, offlineAccess } from "#contexts/auth/AuthorizationScopes.ts";
import { retiredScopeAliases } from "#contexts/auth/AuthorizationScopes.ts";
import { SignInSessions } from "#contexts/auth/SignInSessions.ts";
import { decodeUserId, type UserId } from "#contexts/auth/User.ts";
import { EmailDelivery, EmailDeliveryFailed } from "#email/EmailDelivery.ts";
import { EmailDeliveryTest, EmailOutbox } from "#email/internal/EmailDeliveryTest.ts";
import { advertisedScopes, resourceScopes } from "#runtime/ApplicationScopes.ts";
import { BackgroundWork } from "#runtime/BackgroundWork.ts";
import { publicInternetProcess } from "#runtime/public-internet/transport/node/PublicInternetProcess.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { AuthDatabaseStatements, AuthDatabaseTest } from "./AuthDatabaseTest.ts";
import { user } from "./AuthTables.ts";
import * as authSchema from "./AuthTables.ts";
import { BetterAuthAdapter } from "./BetterAuthAdapter.ts";
import { OAuthClientRepository } from "./OAuthClientRepository.ts";
import * as oauthSchema from "./OAuthTables.ts";
import { oauthClient, oauthRefreshToken, jwks } from "./OAuthTables.ts";
import { SignInCodeQuotaRepository } from "./SignInCodeQuotaRepository.ts";
import { SignInSessionRepository } from "./SignInSessionRepository.ts";
import { SignInSessionsLive } from "./SignInSessionsLive.ts";

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
        "client_id=not%20a%20url&sig=forged",
        "client_id=http%3A%2F%2Fclient.test%2Fmeta&sig=forged",
        `client_id=${"a".repeat(129)}&sig=forged`,
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
  "refuses an ended session on the next request",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const sessions = yield* SignInSessions;

      yield* adapter.handle(sendCodeRequest("ended.reader@example.test"));
      const code = yield* latestCode("ended.reader@example.test");
      const signedIn = yield* adapter.handle(signInRequest("ended.reader@example.test", code));
      const headers = new Headers({ cookie: cookieHeader(signedIn) });
      const signedInSession = yield* adapter.getSession(headers);
      assert.isDefined(signedInSession);

      const userId = decodeUserId(signedInSession.user.id);
      const listed = yield* sessions.list(userId);
      const [listedSession] = listed;
      assert.isDefined(listedSession);
      yield* sessions.end(userId, [listedSession.id]);

      assert.isUndefined(yield* adapter.getSession(headers));
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
      assert.strictEqual(message?.subject, `${code} is your Lineupgrade sign-in code`);
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
  "names a sender that may not reach the address instead of blaming the address",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const response = yield* adapter.handle(sendCodeRequest("reader@example.test"));

      assert.deepStrictEqual(yield* errorOf(response), {
        status: 422,
        code: "EMAIL_RECIPIENT_NOT_ALLOWED",
      });
    }).pipe(Effect.provide(adapterLayer(baseConfig, senderRefusedEmail))),
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
  "resolves only unexpired local access tokens and refuses a token for a deleted user",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database.insert(user).values({
          id: "reader",
          name: "Reader",
          email: "reader@example.test",
        }),
      );
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

      yield* Effect.promise(() => database.delete(user).where(eq(user.id, "reader")));
      assert.deepStrictEqual(yield* adapter.resolveAccessToken(valid.token, ["connections:read"]), {
        status: "invalid",
      });
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
  "names a refused client-metadata redirect instead of a network failure",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const response = yield* adapter.handle(metadataClientAuthorization());

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(yield* jsonOf(response, ErrorDescription), {
        error: "invalid_client",
        error_description:
          "Metadata document fetch was refused: redirects are not followed by policy",
      });
    }).pipe(
      Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, redirectingMetadata, testScopes)),
    ),
  databaseTestTimeout,
);

it.effect(
  "reports an unreachable client-metadata document as a network failure",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const response = yield* adapter.handle(metadataClientAuthorization());

      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(yield* jsonOf(response, ErrorDescription), {
        error: "invalid_client",
        error_description: "Failed to fetch metadata document (network error)",
      });
    }).pipe(
      Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, unreachableMetadata, testScopes)),
    ),
  databaseTestTimeout,
);

it.effect(
  "publishes one scope set to the authorization server and the resource scopes to the protected resource",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const authorizationServer = yield* jsonOf(
        yield* adapter.handle(
          new Request("http://localhost:5173/.well-known/oauth-authorization-server/api/auth"),
        ),
        Schema.Struct({ scopes_supported: Schema.Array(Schema.String) }),
      );
      const protectedResource = yield* jsonOf(
        yield* adapter.handle(
          new Request("http://localhost:5173/.well-known/oauth-protected-resource/mcp"),
        ),
        Schema.Struct({ scopes_supported: Schema.Array(Schema.String) }),
      );

      assert.deepStrictEqual(
        authorizationServer.scopes_supported,
        advertisedScopes.map((scope) => scope.name),
      );
      assert.deepStrictEqual(
        protectedResource.scopes_supported,
        resourceScopes.map((scope) => scope.name),
      );
      assert.deepStrictEqual(
        authorizationServer.scopes_supported.filter(
          (scope) => !protectedResource.scopes_supported.includes(scope),
        ),
        ["offline_access"],
      );
      for (const retired of Object.keys(retiredScopeAliases)) {
        assert.notInclude(authorizationServer.scopes_supported, retired);
        assert.notInclude(protectedResource.scopes_supported, retired);
      }
    }).pipe(
      Effect.provide(
        adapterLayer(baseConfig, EmailDeliveryTest, publicInternetProcess, realScopes),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "resolves a token minted with a retired scope name to the scope that replaced it",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      yield* Effect.promise(() =>
        database.insert(user).values({
          id: "reader",
          name: "Reader",
          email: "reader@example.test",
        }),
      );
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
      const token = (scope: string): Effect.Effect<{ readonly token: string }> =>
        Effect.promise(() =>
          signer.api.signJWT({
            body: { payload: { sub: "reader", scope, exp: 4_000_000_000 } },
          }),
        );

      const retired = yield* token("connections:read");
      const current = yield* token("fantasy:read");
      const manageOnly = yield* token("feedback:manage");

      assert.deepStrictEqual(yield* adapter.resolveAccessToken(retired.token, ["fantasy:read"]), {
        status: "authenticated",
        userId: decodeUserId("reader"),
      });
      assert.deepStrictEqual(yield* adapter.resolveAccessToken(current.token, ["fantasy:read"]), {
        status: "authenticated",
        userId: decodeUserId("reader"),
      });
      assert.deepStrictEqual(
        yield* adapter.resolveAccessToken(manageOnly.token, ["fantasy:read"]),
        {
          status: "insufficient_scope",
        },
      );
      assert.deepStrictEqual(yield* adapter.resolveAccessToken(retired.token, ["teams:manage"]), {
        status: "insufficient_scope",
      });
    }).pipe(
      Effect.provide(
        adapterLayer(baseConfig, EmailDeliveryTest, publicInternetProcess, realScopes),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "registers a dynamic client that asks for a retired scope and grants it as the scope that replaced it",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;

      const retired = yield* adapter.handle(
        dynamicRegistrationRequest("Retired scope client", "connections:read"),
      );
      const unknown = yield* adapter.handle(
        dynamicRegistrationRequest("Unknown scope client", "connections:write"),
      );

      assert.strictEqual(retired.status, 201);
      assert.strictEqual(unknown.status, 400);
      const refusal = yield* jsonOf(unknown, ErrorDescription);
      assert.strictEqual(refusal.error, "invalid_scope");
      assert.include(refusal.error_description, "connections:write");

      const registered = yield* jsonOf(retired, Schema.Struct({ client_id: Schema.String }));
      yield* adapter.handle(sendCodeRequest("retired.scope@example.test"));
      const signedIn = yield* adapter.handle(
        signInRequest(
          "retired.scope@example.test",
          yield* latestCode("retired.scope@example.test"),
        ),
      );
      const headers = new Headers({ cookie: cookieHeader(signedIn) });
      const session = yield* adapter.getSession(headers);
      if (session === undefined) {
        throw new Error("Sign-in did not produce a session");
      }
      const query = new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: "connections:read offline_access",
        resource: mcpResource,
        code_challenge: yield* pkceChallenge(pkceVerifier),
        code_challenge_method: "S256",
        state: "retired-scope",
      });
      const authorization = yield* adapter.handle(
        new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`, { headers }),
      );
      const location = new URL(
        authorization.headers.get("location") ?? "",
        baseConfig.BETTER_AUTH_URL,
      );
      const consentRequest = yield* adapter.getConsentRequest(headers, location.search.slice(1));
      assert.deepStrictEqual(
        consentRequest.status === "valid" ? consentRequest.scopes.map((scope) => scope.name) : [],
        ["fantasy:read", offlineAccess.name],
      );

      const consent = yield* adapter.consent(headers, location.search.slice(1), true);
      const credentials = yield* jsonOf(
        yield* adapter.handle(
          new Request("http://localhost:5173/api/auth/oauth2/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              client_id: registered.client_id,
              redirect_uri: "http://127.0.0.1:19999/callback",
              resource: mcpResource,
              code_verifier: pkceVerifier,
              code: new URL(consent).searchParams.get("code") ?? "",
            }),
          }),
        ),
        Schema.Struct({ access_token: Schema.String, scope: Schema.String }),
      );

      assert.strictEqual(credentials.scope, "connections:read offline_access");
      assert.deepStrictEqual(
        yield* adapter.resolveAccessToken(credentials.access_token, ["fantasy:read"]),
        {
          status: "authenticated",
          userId: decodeUserId(session.user.id),
          clientId: registered.client_id,
        },
      );
    }).pipe(
      Effect.provide(
        adapterLayer(baseConfig, EmailDeliveryTest, publicInternetProcess, realScopes),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "refuses a dynamic registration once 100 unapproved registrations are live",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      const registeredAt = yield* DateTime.nowAsDate;
      yield* Effect.promise(() =>
        database.insert(oauthClient).values(
          Array.from({ length: 99 }, (_, index) => ({
            id: `waiting-${String(index)}`,
            clientId: `waiting-client-${String(index)}`,
            redirectUris: ["http://127.0.0.1:19999/callback"],
            createdAt: registeredAt,
            updatedAt: registeredAt,
          })),
        ),
      );

      const accepted = yield* adapter.handle(dynamicRegistrationRequest("accepted"));
      const refused = yield* adapter.handle(dynamicRegistrationRequest("refused"));

      assert.strictEqual(accepted.status, 201);
      assert.strictEqual(refused.status, 429);
      const body = yield* jsonOf(
        refused,
        Schema.Struct({ error: Schema.String, error_description: Schema.String }),
      );
      assert.strictEqual(body.error, "temporarily_unavailable");
      assert.include(body.error_description, "100");
    }).pipe(Effect.provide(adapterLayer(baseConfig))),
  databaseTestTimeout,
);

it.effect(
  "lets a dynamic registration holding a retired scope step up to a scope advertised after it registered",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const database = yield* AuthDatabase;
      const registration = yield* adapter.handle(dynamicRegistrationRequest("Early registration"));
      const registered = yield* jsonOf(registration, Schema.Struct({ client_id: Schema.String }));
      const current = advertisedScopes.map((scope) => scope.name);
      const [registeredClient] = yield* Effect.promise(() =>
        database.select().from(oauthClient).where(eq(oauthClient.clientId, registered.client_id)),
      );
      const laterScope = { name: "later:read", description: "Read a scope added later." };
      const advertised = [...current, laterScope.name];

      const restarted = yield* Effect.provide(
        BetterAuthAdapter,
        Layer.fresh(BetterAuthAdapter.layer).pipe(
          Layer.provide(SignInCodeQuotaRepository.layer),
          Layer.provide(OAuthClientRepository.layer),
          Layer.provide(Layer.succeed(AuthorizationScopes)([...advertisedScopes, laterScope])),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(baseConfig))),
        ),
      );
      const query = new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: advertised.join(" "),
        resource: mcpResource,
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      });
      const authorization = yield* restarted.handle(
        new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`),
      );
      const [widened] = yield* Effect.promise(() =>
        database.select().from(oauthClient).where(eq(oauthClient.clientId, registered.client_id)),
      );

      assert.strictEqual(registration.status, 201);
      assert.deepStrictEqual(registeredClient?.scopes, [...current, "connections:read"]);
      assert.strictEqual(
        new URL(authorization.headers.get("location") ?? "", baseConfig.BETTER_AUTH_URL).pathname,
        "/auth",
      );
      assert.deepStrictEqual(widened?.scopes, [...advertised, "connections:read"]);
    }).pipe(
      Effect.provide(
        adapterLayer(baseConfig, EmailDeliveryTest, publicInternetProcess, realScopes),
      ),
    ),
  databaseTestTimeout,
);

it.effect(
  "does not present an unverified client name as the address it is connecting to",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      yield* adapter.handle(sendCodeRequest("named@example.test"));
      const signedIn = yield* adapter.handle(
        signInRequest("named@example.test", yield* latestCode("named@example.test")),
      );
      const headers = new Headers({ cookie: cookieHeader(signedIn) });
      const registration = yield* adapter.handle(
        new Request("http://localhost:5173/api/auth/oauth2/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
            client_name: "Lineupgrade Support",
            redirect_uris: ["http://127.0.0.1:19999/callback"],
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            application_type: "native",
          }),
        }),
      );
      const registered = yield* jsonOf(registration, Schema.Struct({ client_id: Schema.String }));
      const query = new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: "connections:read offline_access",
        resource: "http://localhost:5173/mcp",
        code_challenge: yield* pkceChallenge(pkceVerifier),
        code_challenge_method: "S256",
        state: "oauth-state",
      });
      const authorization = yield* adapter.handle(
        new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`, { headers }),
      );
      const location = new URL(
        authorization.headers.get("location") ?? "",
        baseConfig.BETTER_AUTH_URL,
      );
      const consent = yield* adapter.getConsentRequest(new Headers(), location.search.slice(1));

      assert.strictEqual(registration.status, 201);
      assert.strictEqual(consent.status, "valid");
      assert.deepStrictEqual(consent.status === "valid" ? consent.client : undefined, {
        id: registered.client_id,
        name: "Lineupgrade Support",
        host: "an unverified client",
      });
    }).pipe(Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata))),
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
      const signedInUser = yield* adapter.getSession(headers);
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
          name: "Lineupgrade test client",
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
      assert.propertyVal(identity, "userId", signedInUser?.user.id);
      assert.propertyVal(identity, "clientId", "https://connections-client.test/client.json");
    }).pipe(
      Effect.provide(
        adapterLayer(
          baseConfig,
          EmailDeliveryTest,
          PublicInternet.fromTransport((request) =>
            Promise.resolve(
              Response.json({
                client_id: request.url,
                client_name: "Lineupgrade test client",
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
  "keeps an issued access token and rotating refresh grant valid in a fresh auth instance",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      yield* adapter.handle(sendCodeRequest("restart@example.test"));
      const signedIn = yield* adapter.handle(
        signInRequest("restart@example.test", yield* latestCode("restart@example.test")),
      );
      const headers = new Headers({ cookie: cookieHeader(signedIn) });
      const challenge = yield* pkceChallenge(pkceVerifier);
      const query = new URLSearchParams({
        response_type: "code",
        client_id: "https://connections-client.test/client.json",
        redirect_uri: "http://127.0.0.1:19999/callback",
        scope: "connections:read offline_access",
        resource: "http://localhost:5173/mcp",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "restart",
      });
      const authorization = yield* adapter.handle(
        new Request(`http://localhost:5173/api/auth/oauth2/authorize?${query}`, { headers }),
      );
      const location = new URL(
        authorization.headers.get("location") ?? "",
        baseConfig.BETTER_AUTH_URL,
      );
      const consent = yield* adapter.consent(headers, location.search.slice(1), true);
      const code = new URL(consent).searchParams.get("code") ?? "";
      const credentials = yield* jsonOf(
        yield* adapter.handle(codeExchangeRequest(code, pkceVerifier)),
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      );

      const payload = jwtPayload(credentials.access_token);
      assert.strictEqual(payload.exp - payload.iat, 300);
      const database = yield* AuthDatabase;
      const [refreshRow] = yield* Effect.promise(() => database.select().from(oauthRefreshToken));
      assert.isDefined(refreshRow);
      assert.strictEqual(
        (refreshRow.expiresAt.getTime() - refreshRow.createdAt.getTime()) / 1000,
        30 * 24 * 60 * 60,
      );
      assert.include(refreshRow.scopes, offlineAccess.name);
      const storedKeys = yield* Effect.promise(() => database.select().from(jwks));
      assert.strictEqual(storedKeys.length, 1);
      assert.strictEqual(storedKeys[0]?.id, jwtHeader(credentials.access_token).kid);
      assert.isAbove(storedKeys[0]?.privateKey.length ?? 0, 0);

      const restarted = yield* Effect.provide(BetterAuthAdapter, instanceLayer);
      assert.propertyVal(
        yield* restarted.resolveAccessToken(credentials.access_token, ["connections:read"]),
        "status",
        "authenticated",
      );
      const refreshed = yield* jsonOf(
        yield* restarted.handle(refreshTokenRequest(credentials.refresh_token)),
        Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String }),
      );
      assert.notStrictEqual(refreshed.refresh_token, credentials.refresh_token);
      assert.propertyVal(
        yield* restarted.resolveAccessToken(refreshed.access_token, ["connections:read"]),
        "status",
        "authenticated",
      );
      const rotatedRow = (yield* Effect.promise(() =>
        database.select().from(oauthRefreshToken),
      )).find((row) => row.revoked === null);
      assert.isDefined(rotatedRow);
      assert.strictEqual(
        (rotatedRow.expiresAt.getTime() - rotatedRow.createdAt.getTime()) / 1000,
        30 * 24 * 60 * 60,
      );
      const keysAfterRestart = yield* Effect.promise(() => database.select().from(jwks));
      assert.deepStrictEqual(
        keysAfterRestart.map((key) => key.id),
        storedKeys.map((key) => key.id),
      );
    }).pipe(Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata))),
  databaseTestTimeout,
);

it.effect(
  "replays a rotated grant for a retry later than thirty seconds",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const startedAt = DateTime.makeUnsafe("2026-11-05T08:10:00Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(DateTime.toDateUtc(startedAt));
      const grant = yield* issueGrant(adapter, "retry@example.test", mcpResource);

      const rotated = yield* jsonOf(
        yield* adapter.handle(refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource)),
        IssuedCredentials,
      );
      vi.setSystemTime(
        DateTime.toDateUtc(DateTime.makeUnsafe(startedAt.epochMilliseconds + 31_000)),
      );

      const replay = yield* adapter.handle(
        refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource),
      );

      assert.strictEqual(replay.status, 200);
      const replayed = yield* jsonOf(replay, IssuedCredentials);
      assert.strictEqual(replayed.refresh_token, rotated.refresh_token);
      assert.propertyVal(
        yield* adapter.resolveAccessToken(replayed.access_token, ["connections:read"]),
        "status",
        "authenticated",
      );
    }).pipe(
      Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
      Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata)),
    ),
  databaseTestTimeout,
);

it.effect(
  "refuses a replay after the reuse window and revokes the whole grant family",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const startedAt = DateTime.makeUnsafe("2026-11-05T08:10:00Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(DateTime.toDateUtc(startedAt));
      const grant = yield* issueGrant(adapter, "spent@example.test", mcpResource);
      const rotated = yield* jsonOf(
        yield* adapter.handle(refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource)),
        IssuedCredentials,
      );
      vi.setSystemTime(
        DateTime.toDateUtc(DateTime.makeUnsafe(startedAt.epochMilliseconds + 301_000)),
      );

      const spent = yield* adapter.handle(
        refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource),
      );
      const family = yield* adapter.handle(
        refreshGrantRequest(rotated.refresh_token, grant.clientId, mcpResource),
      );

      assert.strictEqual(spent.status, 400);
      assert.deepStrictEqual(yield* jsonOf(spent, ErrorDescription), {
        error: "invalid_grant",
        error_description: "invalid refresh token",
      });
      assert.strictEqual(family.status, 400);
      assert.deepStrictEqual(yield* jsonOf(family, ErrorDescription), {
        error: "invalid_grant",
        error_description: "session not found",
      });
    }).pipe(
      Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
      Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata)),
    ),
  databaseTestTimeout,
);

it.effect(
  "records the OAuth refusal on a spent token exchange without token or account material",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const startedAt = DateTime.makeUnsafe("2026-11-05T08:10:00Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(DateTime.toDateUtc(startedAt));
      const grant = yield* issueGrant(adapter, "refusal-log@example.test", mcpResource);
      const rotated = yield* jsonOf(
        yield* adapter.handle(refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource)),
        IssuedCredentials,
      );
      vi.setSystemTime(
        DateTime.toDateUtc(DateTime.makeUnsafe(startedAt.epochMilliseconds + 301_000)),
      );
      const spans: Array<Tracer.Span> = [];

      const refused = yield* adapter
        .handle(refreshGrantRequest(grant.refreshToken, grant.clientId, mcpResource))
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

      assert.strictEqual(refused.status, 400);
      const span = spans.find((candidate) => candidate.name === "AuthService.handle");
      assert.isDefined(span);
      assert.strictEqual(span.attributes.get("oauth.error"), "invalid_grant");
      assert.strictEqual(span.attributes.get("oauth.grant_type"), "refresh_token");
      assert.strictEqual(span.attributes.get("oauth.client_id"), grant.clientId);
      assert.strictEqual(span.attributes.get("oauth.refresh_token_presented"), true);
      const exported = spans
        .flatMap((candidate) => [candidate.name, ...[...candidate.attributes].flat().map(String)])
        .join("\n");
      assert.notInclude(exported, grant.refreshToken);
      assert.notInclude(exported, rotated.refresh_token);
      assert.notInclude(exported, rotated.access_token);
      assert.notInclude(exported, "refusal-log@example.test");
    }).pipe(
      Effect.ensuring(Effect.sync(() => vi.useRealTimers())),
      Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata)),
    ),
  databaseTestTimeout,
);

it.effect(
  "mints an access token the resource server accepts when the client omits the resource indicator",
  () =>
    Effect.gen(function* () {
      const adapter = yield* BetterAuthAdapter;
      const grant = yield* issueGrant(adapter, "no-resource@example.test", undefined);

      assert.deepStrictEqual(
        yield* adapter.resolveAccessToken(grant.accessToken, ["connections:read"]),
        {
          status: "authenticated",
          userId: grant.userId,
          clientId: grant.clientId,
        },
      );
      const renewed = yield* jsonOf(
        yield* adapter.handle(refreshGrantRequest(grant.refreshToken, grant.clientId, undefined)),
        IssuedCredentials,
      );
      assert.deepStrictEqual(
        yield* adapter.resolveAccessToken(renewed.access_token, ["connections:read"]),
        {
          status: "authenticated",
          userId: grant.userId,
          clientId: grant.clientId,
        },
      );
    }).pipe(Effect.provide(adapterLayer(baseConfig, EmailDeliveryTest, testMetadata))),
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

const redirectingMetadata = PublicInternet.fromTransport(() =>
  Promise.resolve(
    new Response(null, {
      status: 302,
      headers: { location: "https://elsewhere.test/client.json" },
    }),
  ),
);

const unreachableMetadata = PublicInternet.fromTransport(() =>
  Promise.reject(new Error("connection refused")),
);

const testMetadata = PublicInternet.fromTransport((request) =>
  Promise.resolve(
    Response.json({
      client_id: request.url,
      client_name: "Lineupgrade test client",
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
const testScopes = Layer.succeed(AuthorizationScopes)([...testScopeDefinitions, offlineAccess]);
const realScopes = Layer.succeed(AuthorizationScopes)(advertisedScopes);

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

const senderRefusedEmail = Layer.merge(
  EmailDeliveryTest,
  Layer.succeed(EmailDelivery)({
    send: () =>
      Effect.fail(
        EmailDeliveryFailed.make({
          reason: "rejected",
          detail: "You can only send testing emails to your own email address.",
          recipientPolicy: true,
        }),
      ),
    sendMany: () => Effect.succeed([]),
  }),
);

const unavailableEmail = Layer.merge(
  EmailDeliveryTest,
  Layer.succeed(EmailDelivery)({
    send: () => Effect.fail(EmailDeliveryFailed.make({ reason: "unavailable" })),
    sendMany: () => Effect.succeed([]),
  }),
);

function adapterLayer(
  config: Record<string, string>,
  email: Layer.Layer<EmailDelivery | EmailOutbox> = EmailDeliveryTest,
  internet: Layer.Layer<PublicInternet> = publicInternetProcess,
  scopes: Layer.Layer<AuthorizationScopes> = testScopes,
): Layer.Layer<
  | AuthDatabase
  | AuthDatabaseStatements
  | BackgroundWork
  | BetterAuthAdapter
  | import("effect/Crypto").Crypto
  | EmailDelivery
  | EmailOutbox
  | PublicInternet
  | SignInCodeQuotaRepository
  | SignInSessions,
  import("effect/Config").ConfigError,
  never
> {
  return BetterAuthAdapter.layer.pipe(
    Layer.provideMerge(SignInCodeQuotaRepository.layer),
    Layer.provide(OAuthClientRepository.layer),
    Layer.provideMerge(SignInSessionsLive.pipe(Layer.provide(SignInSessionRepository.layer))),
    Layer.provide(scopes),
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
  Layer.provide(OAuthClientRepository.layer),
  Layer.provide(testScopes),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(baseConfig))),
);

function metadataClientAuthorization(): Request {
  return new Request(
    `http://localhost:5173/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "https://connections-client.test/client.json",
      redirect_uri: "http://127.0.0.1:19999/callback",
      scope: "connections:read",
      resource: "http://localhost:5173/mcp",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    })}`,
  );
}

function dynamicRegistrationRequest(clientName: string, scope?: string): Request {
  return new Request("http://localhost:5173/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      ...(scope === undefined ? {} : { scope }),
    }),
  });
}

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

const pkceVerifier = "1234567890123456789012345678901234567890123";

function pkceChallenge(verifier: string): Effect.Effect<string> {
  return Effect.promise(async () => {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  });
}

function codeExchangeRequest(code: string, verifier: string): Request {
  return new Request("http://localhost:5173/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "https://connections-client.test/client.json",
      redirect_uri: "http://127.0.0.1:19999/callback",
      resource: "http://localhost:5173/mcp",
      code_verifier: verifier,
      code,
    }),
  });
}

function refreshTokenRequest(token: string): Request {
  return new Request("http://localhost:5173/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "https://connections-client.test/client.json",
      resource: "http://localhost:5173/mcp",
      refresh_token: token,
    }),
  });
}

function issueGrant(
  adapter: Pick<AuthServiceShape, "consent" | "getSession" | "handle">,
  email: string,
  resource: string | undefined,
): Effect.Effect<
  IssuedGrant,
  | import("#contexts/auth/Auth.ts").AuthenticationUnavailable
  | import("#contexts/auth/Auth.ts").AuthenticationInvalidResponse,
  EmailOutbox
> {
  return Effect.gen(function* () {
    yield* adapter.handle(sendCodeRequest(email));
    const signedIn = yield* adapter.handle(signInRequest(email, yield* latestCode(email)));
    const headers = new Headers({ cookie: cookieHeader(signedIn) });
    const session = yield* adapter.getSession(headers);
    if (session === undefined) {
      throw new Error("Sign-in did not produce a session");
    }
    const registration = yield* adapter.handle(grantRegistrationRequest(email));
    const registered = yield* jsonOf(registration, Schema.Struct({ client_id: Schema.String }));

    const authorization = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: "http://127.0.0.1:19999/callback",
      scope: "connections:read offline_access",
      code_challenge: yield* pkceChallenge(pkceVerifier),
      code_challenge_method: "S256",
      state: "grant",
    });
    if (resource !== undefined) {
      authorization.set("resource", resource);
    }
    const redirect = yield* adapter.handle(
      new Request(`http://localhost:5173/api/auth/oauth2/authorize?${authorization}`, { headers }),
    );
    const location = new URL(redirect.headers.get("location") ?? "", baseConfig.BETTER_AUTH_URL);
    const consent = yield* adapter.consent(headers, location.search.slice(1), true);

    const exchange = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      redirect_uri: "http://127.0.0.1:19999/callback",
      code_verifier: pkceVerifier,
      code: new URL(consent).searchParams.get("code") ?? "",
    });
    if (resource !== undefined) {
      exchange.set("resource", resource);
    }
    const credentials = yield* jsonOf(
      yield* adapter.handle(
        new Request("http://localhost:5173/api/auth/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: exchange,
        }),
      ),
      IssuedCredentials,
    );

    return {
      accessToken: credentials.access_token,
      clientId: registered.client_id,
      refreshToken: credentials.refresh_token,
      userId: decodeUserId(session.user.id),
    } as const;
  });
}

function grantRegistrationRequest(clientName: string): Request {
  return new Request("http://localhost:5173/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: ["http://127.0.0.1:19999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });
}

function refreshGrantRequest(
  refreshToken: string,
  clientId: string,
  resource: string | undefined,
): Request {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });
  if (resource !== undefined) {
    body.set("resource", resource);
  }
  return new Request("http://localhost:5173/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

const mcpResource = "http://localhost:5173/mcp";

const IssuedCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});

const JwtPayload = Schema.Struct({ iat: Schema.Finite, exp: Schema.Finite });
const JwtHeader = Schema.Struct({ kid: Schema.String });

function jwtPayload(token: string): typeof JwtPayload.Type {
  return Schema.decodeUnknownSync(JwtPayload)(jwtSegment(token, 1));
}

function jwtHeader(token: string): typeof JwtHeader.Type {
  return Schema.decodeUnknownSync(JwtHeader)(jwtSegment(token, 0));
}

function jwtSegment(token: string, index: 0 | 1): unknown {
  return JSON.parse(Buffer.from(token.split(".")[index] ?? "", "base64url").toString());
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
const ErrorDescription = Schema.Struct({
  error: Schema.String,
  error_description: Schema.String,
});

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

type IssuedGrant = {
  readonly accessToken: string;
  readonly clientId: string;
  readonly refreshToken: string;
  readonly userId: UserId;
};
