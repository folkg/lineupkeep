import { runBackend } from "@lineupkeep/web/server/backendEntry.ts";

import * as programs from "#verification-programs";

import { makeServiceHandler } from "./serviceHandler";

export const verificationRoute = makeServiceHandler(programs, (request, program) =>
  runBackend(request, "verification.service", program),
);
