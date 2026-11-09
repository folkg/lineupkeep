import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooWriteError } from "#yahoo/errors.ts";
import { YahooCoverage, YahooLineupSlot, YahooPlayerKey, YahooTeamKey } from "#yahoo/keys.ts";
import { WriteReceipt } from "#yahoo/receipt.ts";
import { assignmentsBody, nativeActionBody, reserveMoveBody } from "#yahoo/xml.ts";

export const SetNativeRequest = Schema.Struct({
  teamKey: YahooTeamKey,
  coverage: YahooCoverage,
});
export type SetNativeRequest = typeof SetNativeRequest.Type;

export type SetNativeResponse = WriteReceipt;

export const setNative: API.OperationMethod<
  SetNativeRequest,
  SetNativeResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "apply_native_action",
  input: SetNativeRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "PUT",
    path: `/fantasy/v2/team/${input.teamKey}/roster`,
    body: nativeActionBody(input.coverage),
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});

const Assignment = Schema.Struct({
  playerKey: YahooPlayerKey,
  slot: YahooLineupSlot,
});

export const AssignRequest = Schema.Struct({
  teamKey: YahooTeamKey,
  coverage: YahooCoverage,
  assignments: Schema.Array(Assignment).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(
      Schema.makeFilter(
        (assignments: ReadonlyArray<{ readonly playerKey: string }>) =>
          new Set(assignments.map((assignment) => assignment.playerKey)).size ===
          assignments.length,
      ),
    ),
  ),
});
export type AssignRequest = typeof AssignRequest.Type;

export type AssignResponse = WriteReceipt;

export const assign: API.OperationMethod<
  AssignRequest,
  AssignResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "apply_explicit_assignments",
  input: AssignRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "PUT",
    path: `/fantasy/v2/team/${input.teamKey}/roster`,
    body: assignmentsBody(input.coverage, input.assignments),
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});

export const ReserveRequest = Schema.Struct({
  teamKey: YahooTeamKey,
  coverage: YahooCoverage,
  playerKey: YahooPlayerKey,
  slot: YahooLineupSlot,
});
export type ReserveRequest = typeof ReserveRequest.Type;

export type ReserveResponse = WriteReceipt;

export const reserve: API.OperationMethod<
  ReserveRequest,
  ReserveResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "apply_reserve_move",
  input: ReserveRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "PUT",
    path: `/fantasy/v2/team/${input.teamKey}/roster`,
    body: reserveMoveBody(input.coverage, input.playerKey, input.slot),
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});
