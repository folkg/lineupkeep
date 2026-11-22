import { jsonString } from "@lineupkeep/collections";

import type { TelemetryReportData } from "#contracts/telemetry/telemetryContract.ts";

import type { TelemetryTransport } from "./telemetry";
export const telemetryRemote: TelemetryTransport = {
  report: (data: TelemetryReportData) => {
    navigator.sendBeacon(
      "/api/telemetry",
      new Blob([jsonString(data)], { type: "application/json" }),
    );
  },
};
