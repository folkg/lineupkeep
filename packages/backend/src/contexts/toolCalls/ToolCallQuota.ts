import { Context, Duration, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

export type ToolCallClass = "read" | "write" | "destructive";

export const toolCallLimits: Record<ToolCallClass, ToolCallLimit> = {
  read: { window: Duration.minutes(1), ownerMax: 180, clientMax: 60 },
  write: { window: Duration.hours(1), ownerMax: 60, clientMax: 20 },
  destructive: { window: Duration.hours(1), ownerMax: 18, clientMax: 6 },
};

export class ToolCallQuota extends Context.Service<ToolCallQuota, ToolCallQuotaShape>()(
  "@lineupkeep/backend/contexts/toolCalls/ToolCallQuota",
) {}

export type ToolCallQuotaShape = {
  readonly consume: (call: ToolCall) => Effect.Effect<ToolCallDecision, ToolCallQuotaUnavailable>;
};

export type ToolCall = {
  readonly userId: UserId;
  readonly clientId: string | undefined;
  readonly callClass: ToolCallClass;
};

export type ToolCallDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly callClass: ToolCallClass;
      readonly bucket: "owner" | "client";
      readonly limit: ToolCallLimit;
      readonly retryAfter: Duration.Duration;
    };

export type ToolCallLimit = {
  readonly window: Duration.Duration;
  readonly ownerMax: number;
  readonly clientMax: number;
};

export class ToolCallQuotaUnavailable extends Schema.TaggedError<
  ToolCallQuotaUnavailable,
  { readonly brand: unique symbol }
>()("ToolCallQuotaUnavailable", {
  cause: Schema.Defect(),
}) {}
