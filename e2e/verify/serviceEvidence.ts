import jsonTools from "@lineupkeep/backend/runtime/JsonText";
import { Effect } from "effect";
import { Cause, Exit, Predicate, Schema } from "effect";

import { redactEvidence } from "./redaction.ts";

export function serviceCallEvidence(
  phase: ServicePhase,
  description: string,
  traceId: string,
  exit: Exit.Exit<unknown, unknown>,
  cookie: string,
  invocation: { readonly persona: string; readonly program: string; readonly arguments: unknown },
): unknown {
  const credentials = [
    cookie,
    ...cookie.split(";").map((part) => part.slice(part.indexOf("=") + 1).trim()),
  ];
  return redactEvidence(
    {
      phase,
      description,
      traceId,
      execution: "application",
      ...invocation,
      outcome: Exit.isSuccess(exit)
        ? { status: "succeeded", ...encodeResult(exit.value) }
        : { status: "failed", failure: describeFailure(Cause.squash(exit.cause)) },
    },
    credentials,
  );
}

export function serviceCallName(sequence: number, description: string): string {
  return `${callPrefix}${sequence}: ${description}`;
}

export function isServiceCallAttachment(attachment: { readonly name: string }): boolean {
  return attachment.name.startsWith(callPrefix);
}

function isJsonData(value: unknown, seen = new Set<object>()): boolean {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return false;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return false;
  }
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Array.isArray(value)
    ? value.every((entry) => isJsonData(entry, seen))
    : Object.values(value).every((entry) => isJsonData(entry, seen));
}

function encodeResult(value: unknown): { readonly result: unknown } | { readonly note: string } {
  try {
    if (!isJsonData(value)) {
      return { note: "Result is not JSON-encodable." };
    }
    const json = jsonTools.jsonString(value);
    return {
      result: Effect.runSync(
        Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(json),
      ),
    };
  } catch {
    return { note: "Result is not JSON-encodable." };
  }
}

function describeFailure(error: unknown): { readonly tag: string; readonly message: string } {
  const details = Predicate.isFunction(error) ? undefined : error;
  return {
    tag:
      Predicate.hasProperty(details, "_tag") && Predicate.isString(details._tag)
        ? details._tag
        : "Error",
    message:
      Predicate.hasProperty(details, "message") && Predicate.isString(details.message)
        ? details.message
        : String(error),
  };
}

const callPrefix = "Service call ";
const Phase = Schema.Literals(["Setup", "Action", "Read"]);
export type ServicePhase = typeof Phase.Type;
const ServiceCall = Schema.Struct({
  phase: Phase,
  description: Schema.String,
  traceId: Schema.String,
  execution: Schema.Literal("application"),
  persona: Schema.String,
  program: Schema.String,
  arguments: Schema.Json,
  outcome: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("succeeded"),
      result: Schema.Json,
    }),
    Schema.Struct({
      status: Schema.Literal("succeeded"),
      note: Schema.String,
    }),
    Schema.Struct({
      status: Schema.Literal("failed"),
      failure: Schema.Struct({ tag: Schema.String, message: Schema.String }),
    }),
  ]),
});
export const ServiceCallJson = Schema.fromJsonString(ServiceCall);
