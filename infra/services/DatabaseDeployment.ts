import type { Output } from "alchemy/Output";
import { Context } from "effect";
import type { Redacted } from "effect";

export class DatabaseDeployment extends Context.Service<DatabaseDeployment, DatabaseOutputs>()(
  "@sourdough/infra/DatabaseDeployment",
) {}

export type DatabaseOutputs = {
  readonly runtimeUrl: Output<Redacted.Redacted<string>>;
  readonly directUrl: Output<Redacted.Redacted<string>>;
};
