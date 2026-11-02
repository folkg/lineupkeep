import { getCurrentAuthSession } from "@lineupkeep/backend/auth/AuthSession";
import { AccountExport, AccountExportDocument } from "@lineupkeep/backend/privacy/AccountExport";
import { DateTime, Effect, Schema } from "effect";

import { runBackend } from "#server/backendEntry.ts";

export function handleAccountExportRequest(request: Request): Promise<Response> {
  return runBackend(request, "account.export", exportAccountData);
}

export const exportAccountData = Effect.gen(function* () {
  const session = yield* getCurrentAuthSession();
  if (session.status === "anonymous") {
    return new Response("Sign in to export your data.", {
      status: 401,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }
  const document = yield* AccountExport.use((exporter) => exporter.exportData(session.user.id));
  const day = DateTime.formatIsoDate(yield* DateTime.now);
  const body = yield* Schema.encodeEffect(
    Schema.fromJsonString(AccountExportDocument, { space: 2 }),
  )(document).pipe(Effect.orDie);
  return new Response(`${body}\n`, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="lineupkeep-export-${day}.json"`,
      "content-type": "application/json; charset=utf-8",
    },
  });
}).pipe(
  Effect.catchTag("account_export.persistence_failed", () =>
    Effect.succeed(
      new Response("We could not prepare your export. Try again.", {
        status: 503,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      }),
    ),
  ),
);
