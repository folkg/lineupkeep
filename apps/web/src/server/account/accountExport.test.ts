import { assert, it } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthenticationSession } from "@lineupkeep/backend/auth/Auth";
import type { UserId } from "@lineupkeep/backend/auth/User";
import {
  AccountExport,
  AccountExportDocument,
  AccountExportPersistenceFailed,
} from "@lineupkeep/backend/privacy/AccountExport";
import {
  makeRequestContext,
  requestContextLayer,
} from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Layer, Schema } from "effect";

import { exportAccountData } from "./accountExport.ts";

const document: AccountExportDocument = {
  schemaVersion: 1,
  exportedAt: "2026-10-01T12:00:00.000Z",
  tables: [
    {
      table: "user",
      label: "Account",
      rows: [{ id: "signed-in-user", email: "person@example.test" }],
    },
  ],
  withheld: [],
};

const request = new Request("http://localhost/api/account/export", {
  headers: { "x-request-id": "request-account-export" },
});

it.effect("refuses to export for an anonymous request", () =>
  Effect.gen(function* () {
    const context = yield* makeRequestContext(request);
    const response = yield* exportAccountData.pipe(
      Effect.provide(
        Layer.mergeAll(
          authenticationLayer(undefined),
          exportLayer(() => Effect.succeed(document)),
          requestContextLayer(context),
        ),
      ),
    );

    assert.strictEqual(response.status, 401);
    assert.strictEqual(
      yield* Effect.promise(() => response.text()),
      "Sign in to export your data.",
    );
  }),
);

it.effect("returns the owner's export as a JSON attachment", () =>
  Effect.gen(function* () {
    const context = yield* makeRequestContext(request);
    const owners: Array<string> = [];
    const response = yield* exportAccountData.pipe(
      Effect.provide(
        Layer.mergeAll(
          authenticationLayer(session),
          exportLayer((owner) =>
            Effect.sync(() => {
              owners.push(owner);
              return document;
            }),
          ),
          requestContextLayer(context),
        ),
      ),
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /^attachment; filename="lineupkeep-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const body = yield* Effect.promise(() => response.text());
    assert.deepStrictEqual(
      yield* Schema.decodeEffect(Schema.fromJsonString(AccountExportDocument))(body),
      document,
    );
    assert.deepStrictEqual(owners, ["signed-in-user"]);
  }),
);

it.effect("answers with a readable refusal when the export cannot be prepared", () =>
  Effect.gen(function* () {
    const context = yield* makeRequestContext(request);
    const response = yield* exportAccountData.pipe(
      Effect.provide(
        Layer.mergeAll(
          authenticationLayer(session),
          exportLayer(() =>
            AccountExportPersistenceFailed.make({ cause: new Error("database unavailable") }),
          ),
          requestContextLayer(context),
        ),
      ),
    );

    assert.strictEqual(response.status, 503);
    assert.strictEqual(
      yield* Effect.promise(() => response.text()),
      "We could not prepare your export. Try again.",
    );
  }),
);

const session: AuthenticationSession = {
  session: { id: "signed-in-session" },
  user: { id: "signed-in-user", email: "person@example.test", name: "Person" },
};

function authenticationLayer(
  current: AuthenticationSession | undefined,
): Layer.Layer<AuthService, never, never> {
  return Layer.succeed(AuthService)(
    AuthService.of({
      signInMethods: { google: false },
      oauthResource: "https://example.com/mcp",
      onboardingScopes: [{ name: "connections:read", description: "Read connections." }],
      resolveAccessToken: () => Effect.succeed({ status: "invalid" as const }),
      getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
      consent: () => Effect.succeed("https://client.test/callback"),
      handle: () => Effect.succeed(new Response()),
      getSession: () => Effect.succeed(current),
    }),
  );
}

function exportLayer(
  exportData: (
    userId: UserId,
  ) => Effect.Effect<AccountExportDocument, AccountExportPersistenceFailed>,
): Layer.Layer<AccountExport, never, never> {
  return Layer.succeed(AccountExport)(AccountExport.of({ exportData }));
}
