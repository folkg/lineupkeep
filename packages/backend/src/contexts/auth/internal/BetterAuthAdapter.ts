import { cimd } from "@better-auth/cimd";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { DB } from "@better-auth/drizzle-adapter/relations-v2";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { mcp } from "@better-auth/mcp";
import { productName } from "@lineupkeep/brand/product";
import { getSessionCookie } from "better-auth/cookies";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import {
  Cause,
  Config,
  Data,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import type { Scope } from "effect";

import { appEnvironmentConfig } from "#config/AppEnvironment.ts";
import { AuthenticationInvalidResponse, AuthenticationUnavailable } from "#contexts/auth/Auth.ts";
import type { AuthenticationSession, AccessTokenResolution } from "#contexts/auth/Auth.ts";
import {
  AuthorizationScopes,
  currentScopeName,
  retiredScopeAliases,
  retiredScopeNames,
} from "#contexts/auth/AuthorizationScopes.ts";
import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";
import { UserId } from "#contexts/auth/User.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";
import type { EmailDeliveryFailed, EmailMessage } from "#email/EmailDelivery.ts";
import { onboardingScopes } from "#runtime/ApplicationScopes.ts";
import { BackgroundWork } from "#runtime/BackgroundWork.ts";
import { PublicInternet, PublicInternetUnavailable } from "#runtime/PublicInternet.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import * as authSchema from "./AuthTables.ts";
import { OAuthClientRepository } from "./OAuthClientRepository.ts";
import * as oauthSchema from "./OAuthTables.ts";
import { SignInCodeQuotaRepository } from "./SignInCodeQuotaRepository.ts";

export class BetterAuthAdapter extends Context.Service<BetterAuthAdapter>()(
  "@lineupkeep/backend/contexts/auth/internal/BetterAuthAdapter",
  {
    make: Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const background = yield* BackgroundWork;
      const internet = yield* PublicInternet;
      const emailDelivery = yield* EmailDelivery;
      const quota = yield* SignInCodeQuotaRepository;
      const oauthClients = yield* OAuthClientRepository;
      const baseUrl = yield* authBaseUrlConfig;
      const secret = yield* authSecretConfig;
      const environment = yield* appEnvironmentConfig;
      const clientAddress = yield* clientAddressConfig;
      const google = yield* googleConfig;
      const scopes = yield* AuthorizationScopes;
      const advertisedScopeNames = scopes.map((scope) => scope.name);
      const acceptedScopeNames = [
        ...advertisedScopeNames,
        ...retiredScopeNames.filter((name) =>
          advertisedScopeNames.includes(retiredScopeAliases[name] ?? name),
        ),
      ];
      const currentScope = (name: string): string => {
        const target = currentScopeName(name);
        return target !== name && advertisedScopeNames.includes(target) ? target : name;
      };
      const oauthResource = new URL("/mcp", baseUrl).href;

      const rateLimitEnabled = environment !== "development";

      const requestedCodes = new WeakMap<Request, SignInCode>();
      const metadataRequests = new WeakMap<Request, (request: Request) => Promise<Response>>();
      const authOptions: AuthFactoryOptions = {
        database,

        fetchMetadata: (input, init) => {
          const request = getCurrentAuthEndpointContext().request;
          const run = request === undefined ? undefined : metadataRequests.get(request);
          if (run === undefined) {
            return Promise.reject(
              new Error("Client metadata requires an active authentication request"),
            );
          }
          return run(new Request(input, { ...init, redirect: "manual" }));
        },
        baseUrl: baseUrl.href,
        oauthResource,
        scopes,
        acceptedScopeNames,
        secret: Redacted.value(secret),
        rateLimitEnabled,
        clientAddress,
        google: Option.getOrUndefined(google),
        runInBackground: background.extend,
        requestSignInCode: (request, code) => requestedCodes.set(request, code),
      };
      const loadAuth = yield* Effect.cached(
        Effect.gen(function* () {
          const auth = yield* initializeAuth(authOptions);
          yield* oauthClients.widenDynamicRegistrations(scopes);
          return auth;
        }),
      );

      const runAuthHandler = Effect.fnUntraced(function* (request: Request) {
        const auth = yield* loadAuth;
        const run = Effect.runPromiseWith(yield* Effect.context<Scope.Scope>());
        metadataRequests.set(request, (metadata) => clientMetadataRequest(run, internet, metadata));
        return yield* Effect.tryPromise({
          try: () => auth.handler(request),
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              metadataRequests.delete(request);
            }),
          ),
        );
      }, Effect.scoped);

      const refuseExcessCodes = Effect.fn("AuthService.refuseExcessCodes")(function* (
        request: Request,
      ) {
        const body = yield* Effect.tryPromise({
          try: () => request.clone().json(),
          catch: () => "unreadable" as const,
        }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SignInCodeRequestBody)), Effect.option);
        if (Option.isNone(body)) {
          return undefined;
        }
        const decision = yield* quota.consume(body.value.email, signInCodesPerAddress);
        if (decision.allowed) {
          return undefined;
        }
        yield* Effect.annotateCurrentSpan("auth.sign_in_code.outcome", "address_limited");
        return tooManyCodesResponse(decision.retryAfter);
      });

      const deliverSignInCode = (
        code: SignInCode,
        response: Response,
      ): Effect.Effect<Response, never, never> =>
        emailDelivery.send(signInCodeEmail(code)).pipe(
          Effect.tap(() => Effect.annotateCurrentSpan("auth.sign_in_code.outcome", "sent")),
          Effect.as(response),
          Effect.catchTag("EmailDeliveryFailed", (failure) =>
            Effect.annotateCurrentSpan(
              "auth.sign_in_code.outcome",
              `delivery_${failure.reason}`,
            ).pipe(Effect.as(deliveryFailedResponse(failure))),
          ),
        );

      const handle = Effect.fn("AuthService.handle")(function* (request: Request) {
        if (rateLimitEnabled && isSignInCodeRequest(request)) {
          const refusal = yield* refuseExcessCodes(request);
          if (refusal !== undefined) {
            return refusal;
          }
        }

        const response = yield* runAuthHandler(request);

        const code = requestedCodes.get(request);
        if (code === undefined) {
          return response;
        }
        requestedCodes.delete(request);
        return yield* deliverSignInCode(code, response);
      });

      const getSession = Effect.fn("AuthService.getSession")(function* (headers: Headers) {
        if (getSessionCookie(headers) === null) {
          return undefined;
        }
        const auth = yield* loadAuth;
        return yield* Effect.tryPromise({
          try: () => auth.api.getSession({ headers }),
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        }).pipe(
          Effect.flatMap((session) => {
            if (session === null) {
              return Effect.void.pipe(Effect.as(undefined));
            }

            return Schema.decodeEffect(BetterAuthSession)(session).pipe(
              Effect.mapError((cause) => AuthenticationInvalidResponse.make({ cause })),
            );
          }),
          Effect.map((session) =>
            session === undefined ? undefined : toAuthenticationSession(session),
          ),
        );
      });

      const resolveAccessToken = Effect.fn("AuthService.resolveAccessToken")(function* (
        token: string,
        requiredScopes: ReadonlyArray<string>,
        expectedClientId?: string,
      ): Effect.fn.Return<AccessTokenResolution, AuthenticationUnavailable> {
        const auth = yield* loadAuth;
        const { payload } = yield* Effect.tryPromise({
          try: () =>
            auth.api.verifyJWT({ body: { token, issuer: new URL("/api/auth", baseUrl).href } }),
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        });
        const claims = Schema.decodeUnknownOption(AccessTokenClaims)(payload);
        if (
          Option.isNone(claims) ||
          claims.value.cnf !== undefined ||
          (expectedClientId !== undefined && claims.value.client_id !== expectedClientId)
        ) {
          return { status: "invalid" };
        }
        const granted = claims.value.scope.split(" ").filter(Boolean).map(currentScope);
        if (!requiredScopes.map(currentScope).every((scope) => granted.includes(scope))) {
          return { status: "insufficient_scope" };
        }
        return { status: "authenticated", userId: claims.value.sub };
      });
      const getConsentRequest = Effect.fn("AuthService.getConsentRequest")(function* (
        headers: Headers,
        query: string,
      ) {
        const params = new URLSearchParams(query);
        const clientId = params.get("client_id");
        const signature = params.get("sig");
        if (clientId === null || clientId === "" || signature === null || signature === "") {
          return { status: "invalid" } as const;
        }
        const metadataHost = URL.canParse(clientId) ? clientMetadataHost(clientId) : undefined;
        if (metadataHost === undefined && !OpaqueClientId.test(clientId)) {
          return { status: "invalid" } as const;
        }

        const requestHeaders = new Headers(headers);

        requestHeaders.delete("cookie");
        requestHeaders.set("content-type", "application/json");
        const body = yield* Schema.encodeEffect(ConsentLookup)({
          client_id: clientId,
          oauth_query: query,
        }).pipe(Effect.mapError((cause) => AuthenticationUnavailable.make({ cause })));
        const response = yield* runAuthHandler(
          new Request(new URL("/api/auth/oauth2/public-client-prelogin", baseUrl), {
            method: "POST",
            headers: requestHeaders,
            body,
          }),
        );
        if (response.status >= 500) {
          return yield* AuthenticationUnavailable.make({
            cause: new Error("Consent request unavailable"),
          });
        }
        if (!response.ok) {
          return { status: "invalid" } as const;
        }
        const client = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        }).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                client_id: Schema.String,
                client_name: Schema.optional(Schema.String),
              }),
            ),
          ),
          Effect.mapError((cause) => AuthenticationInvalidResponse.make({ cause })),
        );
        const requested = new Set(
          (params.get("scope") ?? "").split(" ").filter(Boolean).map(currentScope),
        );
        if ([...requested].some((name) => !scopes.some((scope) => scope.name === name))) {
          return { status: "invalid" } as const;
        }
        return {
          status: "valid",
          client: {
            id: client.client_id,
            name: client.client_name ?? null,
            host: metadataHost ?? client.client_name ?? "an unverified client",
          },
          scopes: scopes.filter((scope) => requested.has(scope.name)),
        } as const;
      });
      const consent = Effect.fn("AuthService.consent")(function* (
        headers: Headers,
        query: string,
        accept: boolean,
      ) {
        const body = yield* Schema.encodeEffect(ConsentDecision)({
          accept,
          oauth_query: query,
        }).pipe(Effect.mapError((cause) => AuthenticationUnavailable.make({ cause })));
        const consentHeaders = new Headers(headers);
        consentHeaders.set("content-type", "application/json");
        consentHeaders.set("accept", "application/json");

        const response = yield* runAuthHandler(
          new Request(new URL("/api/auth/oauth2/consent", baseUrl), {
            method: "POST",
            headers: consentHeaders,
            body,
          }),
        );
        if (!response.ok) {
          return yield* AuthenticationUnavailable.make({
            cause: new Error("Consent was not confirmed"),
          });
        }
        const result = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => AuthenticationUnavailable.make({ cause }),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(ConsentRedirect)),
          Effect.mapError((cause) => AuthenticationUnavailable.make({ cause })),
        );
        return result.url;
      });

      return {
        signInMethods: { google: Option.isSome(google) },
        oauthResource,
        onboardingScopes,
        handle,
        getSession,
        resolveAccessToken,
        getConsentRequest,
        consent,
      } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function initializeAuth(
  options: AuthFactoryOptions,
): Effect.Effect<ApplicationAuth, AuthenticationUnavailable> {
  return Effect.gen(function* () {
    const auth = createAuth(options);

    yield* Effect.tryPromise({
      try: () => auth.$context,
      catch: (cause) => AuthenticationUnavailable.make({ cause }),
    });
    return auth;
  }).pipe(
    Effect.tapError((error) =>
      Schema.is(ResourceSeedConflict)(error.cause)
        ? Effect.annotateCurrentSpan("auth.initialization.seed_conflict", true)
        : Effect.void,
    ),
    Effect.retry({ times: 1, while: (error) => Schema.is(ResourceSeedConflict)(error.cause) }),
  );
}

function clientMetadataRequest(
  run: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>,
  internet: PublicInternet["Service"],
  request: Request,
): Promise<Response> {
  return run(Effect.exit(internet.request(request))).then((exit) => {
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    const failure = Cause.squash(exit.cause);
    throw Schema.is(PublicInternetUnavailable)(failure) && failure.reason === "blocked_redirect"
      ? new ClientMetadataRedirectRefused()
      : failure;
  });
}

class ClientMetadataRedirectRefused extends Data.TaggedError("ClientMetadataRedirectRefused") {}

function createAuth(options: AuthFactoryOptions): ApplicationAuth {
  return betterAuth<ApplicationAuthOptions>({
    appName: productName,
    baseURL: options.baseUrl,
    secret: options.secret,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema: { ...authSchema, ...oauthSchema },
    }),
    socialProviders:
      options.google === undefined
        ? {}
        : {
            google: {
              clientId: options.google.clientId,
              clientSecret: Redacted.value(options.google.clientSecret),

              prompt: "select_account",
            },
          },
    account: {
      accountLinking: { enabled: true },
    },
    plugins: [
      jwt({
        jwt: {
          issuer: new URL("/api/auth", options.baseUrl).href,
          audience: options.oauthResource,
        },
        disableSettingJwtHeader: true,
      }),
      mcp({
        loginPage: "/auth",
        consentPage: "/consent",
        resource: options.oauthResource,
        resourceSeedMode: "insertOnly",
        scopes: [...options.acceptedScopeNames],
        clientRegistrationDefaultScopes: options.scopes.map((scope) => scope.name),
        advertisedMetadata: { scopes_supported: options.scopes.map((scope) => scope.name) },
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        allowPublicClientPrelogin: true,
        accessTokenExpiresIn: Duration.toSeconds(accessTokenLifetime),
        refreshTokenExpiresIn: Duration.toSeconds(refreshTokenLifetime),
        refreshTokenReuseInterval: Duration.toSeconds(refreshTokenReuseWindow),
      }),
      cimd({
        metadataProfile: "mcp-2026-07-28",
        fetchClientMetadataResource: options.fetchMetadata,
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: Duration.toSeconds(signInCodeLifetime),
        allowedAttempts: 3,

        storeOTP: "hashed",

        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: ({ email, otp, type }, context) => {
          if (type !== "sign-in") {
            return Promise.resolve();
          }
          const request = context?.request;
          if (request === undefined) {
            return Promise.reject(new Error("Sign-in codes are requested only over HTTP"));
          }
          options.requestSignInCode(request, { email, code: otp });
          return Promise.resolve();
        },
      }),
    ],

    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    rateLimit: { enabled: options.rateLimitEnabled, storage: "database" },
    advanced: {
      ipAddress: options.clientAddress,
      backgroundTasks: { handler: options.runInBackground },
    },
  });
}

function signInCodeEmail(code: SignInCode): EmailMessage {
  const minutes = Duration.toMinutes(signInCodeLifetime);
  return {
    to: code.email,
    subject: `${code.code} is your ${productName} sign-in code`,
    text: [
      `Your ${productName} sign-in code is ${code.code}.`,
      "",
      `Enter it where you asked to sign in. It works once and expires in ${minutes} minutes.`,
      "",
      "If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.",
    ].join("\n"),
    purpose: "auth.sign_in_code",
  };
}

function isSignInCodeRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    new URL(request.url).pathname.endsWith("/email-otp/send-verification-otp")
  );
}

function tooManyCodesResponse(retryAfter: Duration.Duration): Response {
  return Response.json(
    { code: "TOO_MANY_CODES", message: "Too many sign-in codes were requested for this address." },
    {
      status: 429,
      headers: { "X-Retry-After": String(Math.ceil(Duration.toSeconds(retryAfter))) },
    },
  );
}

function deliveryFailedResponse(failure: EmailDeliveryFailed): Response {
  return failure.reason === "rejected"
    ? Response.json(
        { code: "EMAIL_REJECTED", message: "The sign-in code could not be sent to this address." },
        { status: 422 },
      )
    : Response.json(
        { code: "EMAIL_UNAVAILABLE", message: "The sign-in code could not be sent." },
        { status: 503 },
      );
}

function toAuthenticationSession(session: BetterAuthSessionValue): AuthenticationSession {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
  };
}

const signInCodeLifetime = Duration.minutes(10);

const accessTokenLifetime = Duration.minutes(5);

const refreshTokenLifetime = Duration.days(30);

const refreshTokenReuseWindow = Duration.seconds(30);

const signInCodesPerAddress = { window: Duration.hours(1), max: 5 };

const SignInCodeRequestBody = Schema.Struct({ email: Schema.String });

const AuthBaseUrl = Schema.URL.pipe(
  Schema.check(
    Schema.makeFilter(
      (url: URL) =>
        url.protocol === "http:" ||
        url.protocol === "https:" ||
        "BETTER_AUTH_URL must use HTTP or HTTPS",
    ),
  ),
);

const AuthSecret = Schema.String.pipe(
  Schema.check(Schema.isMinLength(32)),
  Schema.brand("AuthSecret"),
);

const authBaseUrlConfig = Config.URL("BETTER_AUTH_URL").pipe(
  Config.mapEffect((url) =>
    Schema.decodeEffect(AuthBaseUrl)(url).pipe(
      Effect.mapError((error) => new Config.ConfigError(error)),
    ),
  ),
);

const authSecretConfig = Config.Redacted("BETTER_AUTH_SECRET").pipe(
  Config.mapEffect((value) =>
    Schema.decodeEffect(AuthSecret)(Redacted.value(value)).pipe(
      Effect.map((secret) => Redacted.make(secret)),
      Effect.mapError((error) => new Config.ConfigError(error)),
    ),
  ),
);

const googleConfig = Config.all({
  clientId: Config.option(Config.String("GOOGLE_CLIENT_ID")),
  clientSecret: Config.option(Config.Redacted("GOOGLE_CLIENT_SECRET")),
}).pipe(
  Config.mapEffect(({ clientId, clientSecret }) => {
    if (Option.isSome(clientId) && Option.isSome(clientSecret)) {
      return Effect.succeed(
        Option.some({ clientId: clientId.value, clientSecret: clientSecret.value }),
      );
    }
    if (Option.isNone(clientId) && Option.isNone(clientSecret)) {
      return Effect.succeed(Option.none<GoogleCredentials>());
    }
    return Effect.fail(
      new Config.ConfigError(
        new ConfigProvider.SourceError({
          message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
        }),
      ),
    );
  }),
);

const clientAddressConfig = Config.all({
  environment: appEnvironmentConfig,
  headers: Config.option(Config.String("AUTH_CLIENT_IP_HEADERS")),
  trustedProxies: Config.option(Config.String("AUTH_TRUSTED_PROXIES")),
}).pipe(
  Config.mapEffect(({ environment, headers, trustedProxies }) => {
    const ipAddressHeaders = Option.map(headers, splitList).pipe(Option.filter(isNonEmpty));
    if (environment === "production" && Option.isNone(ipAddressHeaders)) {
      return Effect.fail(
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message:
              "AUTH_CLIENT_IP_HEADERS is required in production, for example cf-connecting-ip, x-real-ip, or x-forwarded-for",
          }),
        ),
      );
    }
    return Effect.succeed({
      ipAddressHeaders: Option.getOrUndefined(ipAddressHeaders),
      trustedProxies: Option.getOrUndefined(Option.map(trustedProxies, splitList)),
    });
  }),
);

function splitList(value: string): Array<string> {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isNonEmpty(values: ReadonlyArray<string>): boolean {
  return values.length > 0;
}

const BetterAuthSession = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    name: Schema.String,
  }),
});

const ResourceSeedConflict = Schema.Struct({
  cause: Schema.Union([
    Schema.Struct({
      code: Schema.Literal("23505"),
      constraint: Schema.Literal("oauth_resource_identifier_key"),
    }),
    Schema.Struct({
      code: Schema.Literal("23505"),
      constraint_name: Schema.Literal("oauth_resource_identifier_key"),
    }),
  ]),
});

const OpaqueClientId = /^[A-Za-z0-9._~-]{1,128}$/u;

function clientMetadataHost(clientId: string): string | undefined {
  const identifier = new URL(clientId);
  return identifier.protocol === "https:" &&
    identifier.username === "" &&
    identifier.password === ""
    ? identifier.host
    : undefined;
}

const ConsentLookup = Schema.fromJsonString(
  Schema.Struct({ client_id: Schema.String, oauth_query: Schema.String }),
);

const ConsentDecision = Schema.fromJsonString(
  Schema.Struct({ accept: Schema.Boolean, oauth_query: Schema.String }),
);

const ConsentRedirect = Schema.Struct({
  url: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

const AccessTokenClaims = Schema.Struct({
  sub: UserId,
  scope: Schema.String,
  exp: Schema.Finite,
  client_id: Schema.optional(Schema.String),
  cnf: Schema.optional(Schema.Unknown),
});

type ApplicationAuthOptions = import("better-auth").BetterAuthOptions & {
  plugins: [
    ReturnType<typeof jwt>,
    ReturnType<typeof mcp>,
    ReturnType<typeof cimd>,
    ReturnType<typeof emailOTP>,
  ];
};
type ApplicationAuth = ReturnType<typeof betterAuth<ApplicationAuthOptions>>;

type AuthFactoryOptions = {
  readonly fetchMetadata: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly database: DB;
  readonly baseUrl: string;
  readonly secret: string;
  readonly rateLimitEnabled: boolean;
  readonly clientAddress: ClientAddressOptions;
  readonly google: GoogleCredentials | undefined;
  readonly runInBackground: (promise: Promise<unknown>) => void;
  readonly requestSignInCode: (request: Request, code: SignInCode) => void;
  readonly oauthResource: string;
  readonly scopes: ReadonlyArray<AuthorizationScope>;
  readonly acceptedScopeNames: ReadonlyArray<string>;
};

type ClientAddressOptions = {
  readonly ipAddressHeaders: Array<string> | undefined;
  readonly trustedProxies: Array<string> | undefined;
};

type GoogleCredentials = {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
};

type SignInCode = {
  readonly email: string;
  readonly code: string;
};

type BetterAuthSessionValue = typeof BetterAuthSession.Type;
