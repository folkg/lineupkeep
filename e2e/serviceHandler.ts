import { getCurrentAuthSession } from "@sourdough/backend/auth/AuthSession";
import type { BackendServices } from "@sourdough/backend/runtime/BackendRuntime";
import type { RequestContext } from "@sourdough/backend/runtime/RequestContext";
import { Cause, Effect, Exit, Schema } from "effect";

import type { ServiceProgram } from "./serviceContract";
import { serviceCallEvidence } from "./verify/serviceEvidence";

export function makeServiceHandler(
  programs: Readonly<Record<string, ServiceProgram>>,
  run: ServiceRunner,
): (request: Request) => Promise<Response | undefined> {
  return async (request: Request): Promise<Response | undefined> => {
    if (new URL(request.url).pathname !== "/__verification/services") {
      return undefined;
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    let input: typeof Invocation.Type;
    try {
      input = Schema.decodeUnknownSync(Invocation)(await request.json());
    } catch {
      return new Response("Invalid service invocation", { status: 400 });
    }
    const program = Object.hasOwn(programs, input.program) ? programs[input.program] : undefined;
    if (program === undefined) {
      return new Response("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY: unknown service program", {
        status: 404,
      });
    }
    return run(
      request,
      Effect.gen(function* () {
        const session = yield* getCurrentAuthSession();
        if (session.status !== "authenticated") {
          return new Response("Sign in before invoking services", { status: 401 });
        }
        const span = yield* Effect.currentSpan;
        const exit = yield* Effect.exit(
          Effect.suspend(() => program(session.user, input.arguments)).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          ),
        );
        const status = Exit.isSuccess(exit) ? 200 : Cause.hasDies(exit.cause) ? 500 : 422;
        yield* Effect.annotateCurrentSpan({
          "verification.phase": input.phase,
          "verification.persona": input.persona,
          "app.outcome": status === 200 ? "success" : status === 500 ? "failure" : "rejected",
          "http.response.status_code": status,
        });
        return Response.json(
          serviceCallEvidence(
            input.phase,
            input.description,
            span.traceId,
            exit,
            request.headers.get("cookie") ?? "",
            input,
          ),
          { status },
        );
      }),
    );
  };
}

const Invocation = Schema.Struct({
  phase: Schema.Literals(["Setup", "Action", "Read"]),
  description: Schema.String,
  persona: Schema.String,
  program: Schema.String,
  arguments: Schema.Json,
});

type ServiceRunner = <E>(
  request: Request,
  program: Effect.Effect<Response, E, BackendServices | RequestContext>,
) => Promise<Response>;
