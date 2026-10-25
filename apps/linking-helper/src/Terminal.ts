import { Context, Effect, Layer } from "effect";

export class Terminal extends Context.Service<Terminal, TerminalShape>()(
  "@lineupkeep/linking-helper/Terminal",
) {}

export type TerminalShape = {
  readonly write: (message: string) => Effect.Effect<void>;
  readonly error: (message: string) => Effect.Effect<void>;
};

export const TerminalLive = Layer.succeed(Terminal)({
  write: (message) => Effect.sync(() => process.stdout.write(`${message}\n`)),
  error: (message) => Effect.sync(() => process.stderr.write(`${message}\n`)),
});
