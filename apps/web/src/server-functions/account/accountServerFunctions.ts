import type {
  AccountErasureExportRequired,
  AccountErasurePersistenceFailed,
} from "@lineupkeep/backend/privacy/AccountErasure";
import { AccountErasure } from "@lineupkeep/backend/privacy/AccountErasure";
import { AccountExport } from "@lineupkeep/backend/privacy/AccountExport";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type {
  AccountErasureErrorType,
  AccountExportStatusErrorType,
} from "#contracts/account/accountContract.ts";
import { isErasureConfirmation } from "#contracts/account/accountContract.ts";
import { accountExportStatusView } from "#server/account/accountStatus.ts";
import { runUseCase } from "#server/backendEntry.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export const eraseAccountServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly confirmation: string }) =>
    Schema.decodeResult(
      Schema.Struct({
        confirmation: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
      }),
    )(raw),
  )
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "account.erase",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => confirmationMismatch),
          );
          if (!isErasureConfirmation(input.confirmation)) {
            return yield* Effect.fail(confirmationMismatch);
          }
          const summary = yield* AccountErasure.use((erasure) => erasure.erase(userId));
          yield* Effect.annotateCurrentSpan({
            "account_erasure.classes": summary.removed.length,
            "account_erasure.rows": summary.removed.reduce(
              (total, entry) => total + entry.count,
              0,
            ),
          });
          return summary;
        }),
      mapAccountErasureError,
    ),
  );

export const getAccountExportStatusServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "account.export_status",
    (userId) =>
      AccountExport.use((exporter) => exporter.status(userId)).pipe(
        Effect.map(accountExportStatusView),
      ),
    mapAccountExportError,
  ),
);

const confirmationMismatch = { _tag: "ErasureConfirmationMismatch" } as const;

function mapAccountErasureError(
  error:
    | typeof confirmationMismatch
    | AccountErasurePersistenceFailed
    | AccountErasureExportRequired,
): ExpectedFailure<AccountErasureErrorType> {
  switch (error._tag) {
    case "ErasureConfirmationMismatch":
      return { type: "account.confirmation_mismatch", outcome: "rejected" };
    case "account_erasure.export_required":
      return { type: "account.export_required", outcome: "rejected" };
    case "account_erasure.persistence_failed":
      return { type: "account.persistence_failed", outcome: "failure" };
  }
}

function mapAccountExportError(): ExpectedFailure<AccountExportStatusErrorType> {
  return { type: "account.persistence_failed", outcome: "failure" };
}
