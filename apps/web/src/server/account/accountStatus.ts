import type { AccountExportStatus } from "@lineupkeep/backend/privacy/AccountExport";
import { accountExportFreshnessWindow } from "@lineupkeep/backend/privacy/AccountExport";
import { DateTime, Duration } from "effect";

import type { AccountExportStatusView } from "#contracts/account/accountContract.ts";

export function accountExportStatusView(status: AccountExportStatus): AccountExportStatusView {
  return {
    usable: status.usable,
    freshForMinutes: Math.round(Duration.toMillis(accountExportFreshnessWindow) / 60_000),
    latest:
      status.latest === undefined
        ? undefined
        : {
            takenAt: DateTime.formatIso(status.latest.takenAt),
            records: status.latest.records,
            areas: status.latest.areas,
          },
  };
}
