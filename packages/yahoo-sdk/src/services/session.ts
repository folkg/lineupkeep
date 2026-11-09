import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeSession } from "#yahoo/internal/team.ts";

export const ValidateRequest = Schema.Struct({});
export type ValidateRequest = typeof ValidateRequest.Type;

export const validate: API.OperationMethod<
  ValidateRequest,
  void,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "validate_session",
  input: ValidateRequest,
  output: Schema.Void,
  request: () => ({
    host: "read",
    method: "GET",
    path: "/fantasy/v2/users;use_login=1",
  }),
  decode: (payload) => decodeSession(payload),
});
