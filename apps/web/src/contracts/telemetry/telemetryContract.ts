export type TelemetryReportData =
  | {
      readonly kind: "client_error";
      readonly message: string;
      readonly thrownIn?: string;
      readonly caughtBy?: string;
      readonly pathname: string;
      readonly clientTraceId?: string;
    }
  | {
      readonly kind: "slow_interaction";
      readonly name: string;
      readonly target?: string;
      readonly settledMs: number;
      readonly holds: ReadonlyArray<TelemetryHold>;
    }
  | {
      readonly kind: "slow_call";
      readonly id: string;
      readonly durationMs: number;
      readonly method: "GET" | "POST";
      readonly outcome: "ok" | "error";
      readonly status?: number;
    };

export type TelemetryHold = {
  readonly blockers: string;
  readonly holdMs: number;
  readonly acknowledged: boolean;
};

export type TelemetryAccepted = {
  readonly ref: string;
};
