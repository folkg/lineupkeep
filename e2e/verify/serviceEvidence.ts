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

function encodeResult(value: unknown): { readonly result: unknown } | { readonly note: string } {
  try {
    const json = JSON.stringify(value, (_key, entry: unknown) => {
      if (
        entry === undefined ||
        typeof entry === "function" ||
        typeof entry === "symbol" ||
        (typeof entry === "number" && !Number.isFinite(entry))
      ) {
        throw new Error("Not JSON data");
      }
      return entry;
    });
    return { result: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(json) };
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
