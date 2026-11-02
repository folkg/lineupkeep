import { Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { AccountExport } from "#contexts/privacy/AccountExport.ts";

import { AccountDataRepository } from "./AccountDataRepository.ts";

export const AccountExportLive = Layer.effect(
  AccountExport,
  Effect.gen(function* () {
    const repository = yield* AccountDataRepository;

    const exportData = Effect.fn("AccountExport.exportData")(function* (userId: UserId) {
      const document = yield* repository.exportData(userId);
      yield* Effect.annotateCurrentSpan({
        "account_export.tables": document.tables.length,
        "account_export.rows": document.tables.reduce(
          (total, table) => total + table.rows.length,
          0,
        ),
        "account_export.withheld_fields": document.withheld.length,
      });
      return document;
    });

    return AccountExport.of({ exportData });
  }),
);
