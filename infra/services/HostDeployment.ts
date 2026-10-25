import type { Output } from "alchemy/Output";
import { Context } from "effect";
import type { Redacted } from "effect";

export class HostDeployment extends Context.Service<HostDeployment, HostOutputs>()(
  "@lineupkeep/infra/HostDeployment",
) {}

export type HostOutputs = {
  readonly url: string | undefined | Output<string | undefined>;
  readonly healthUrl: string | undefined | Output<string | undefined>;
  readonly artifact: string | Output<string>;
};

export type HostEnvironment = Readonly<
  Record<string, string | Redacted.Redacted<string> | Output<string | Redacted.Redacted<string>>>
>;

export type LocalHostOptions = {
  readonly ownership?: { readonly name: string; readonly lockDirectory: string };
  readonly development?: boolean;
  readonly programs?: string;
  readonly inspector?: boolean;
};
