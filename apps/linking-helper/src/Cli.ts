import { tmpdir } from "node:os";

import { Duration, Effect, Layer } from "effect";

import { AppTransportLive } from "./AppTransport.ts";
import { DeviceAuthorizationLive } from "./DeviceAuthorization.ts";
import type { DeviceAuthorization } from "./DeviceAuthorization.ts";
import { runLinkCommand } from "./LinkCommand.ts";
import type { LinkCommandOptions } from "./LinkCommand.ts";
import type { LinkingUpload } from "./LinkingUpload.ts";
import { LinkingUploadLive } from "./LinkingUpload.ts";
import type { ProviderBrowser } from "./ProviderBrowser.ts";
import { ProviderBrowserLive } from "./ProviderBrowser.ts";
import { Terminal, TerminalLive } from "./Terminal.ts";

export type CliCommand =
  | { readonly _tag: "Help"; readonly text: string }
  | { readonly _tag: "Invalid"; readonly message: string }
  | { readonly _tag: "Link"; readonly options: LinkCommandOptions };

export function parseCliArguments(
  argv: ReadonlyArray<string>,
  environment: Readonly<Record<string, string | undefined>>,
): CliCommand {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { _tag: "Help", text: helpText };
  }

  const [first, ...remaining] = argv;
  let arguments_: ReadonlyArray<string>;
  if (first === undefined || first.startsWith("-")) {
    arguments_ = argv;
  } else if (first === "link") {
    arguments_ = remaining;
  } else {
    return invalid(`Unknown command "${first}". Use "lineupkeep link".`);
  }

  let provider = "yahoo";
  let appUrlValue = environment["LINEUPKEEP_APP_URL"] ?? defaultAppUrl;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) {
      continue;
    }
    if (argument === "--provider" || argument === "--app-url") {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return invalid(`Missing value for ${argument}.`);
      }
      index += 1;
      if (argument === "--provider") {
        provider = value;
      } else {
        appUrlValue = value;
      }
      continue;
    }
    if (argument.startsWith("--provider=")) {
      provider = argument.slice("--provider=".length);
      continue;
    }
    if (argument.startsWith("--app-url=")) {
      appUrlValue = argument.slice("--app-url=".length);
      continue;
    }
    return invalid(`Unknown option "${argument}".`);
  }

  if (provider !== "yahoo") {
    return invalid(`Unsupported provider "${provider}". Only yahoo is supported.`);
  }
  const appUrl = parseAppUrl(appUrlValue);
  if (appUrl === undefined) {
    return invalid(
      `Invalid app URL "${appUrlValue}". Use an https origin, or http on localhost, 127.0.0.1, or [::1].`,
    );
  }
  return {
    _tag: "Link",
    options: {
      appUrl,
      provider: "yahoo",
      providerLoginUrl: new URL("https://football.fantasysports.yahoo.com/"),
      headless: false,
      loginTimeout: Duration.minutes(10),
      profileRoot: tmpdir(),
    },
  };
}

export const runCliCommand = (
  command: CliCommand,
): Effect.Effect<
  number,
  never,
  Terminal | DeviceAuthorization | ProviderBrowser | LinkingUpload
> => {
  switch (command._tag) {
    case "Help":
      return Effect.flatMap(Terminal, (terminal) => terminal.write(command.text)).pipe(
        Effect.as(0),
      );
    case "Invalid":
      return Effect.flatMap(Terminal, (terminal) => terminal.error(command.message)).pipe(
        Effect.as(2),
      );
    case "Link":
      return runLinkCommand(command.options);
  }
};

export const runCli = (
  argv: ReadonlyArray<string>,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<number> =>
  runCliCommand(parseCliArguments(argv, environment)).pipe(Effect.provide(LiveLayer));

const LiveLayer = Layer.mergeAll(
  TerminalLive,
  ProviderBrowserLive,
  Layer.mergeAll(DeviceAuthorizationLive, LinkingUploadLive).pipe(Layer.provide(AppTransportLive)),
);

const defaultAppUrl = "http://localhost:5173";

const helpText = `lineupkeep — local provider linking helper

Usage:
  lineupkeep link [--provider yahoo] [--app-url <url>]
  lineupkeep --help

Options:
  --provider   Provider to link. Only yahoo is supported.
  --app-url    Lineupkeep origin. Defaults to LINEUPKEEP_APP_URL or ${defaultAppUrl}.
  --help       Show this help.

The helper keeps the device code and access token in memory, never in arguments or output.
It opens Yahoo in a temporary Chromium profile and removes that profile when it finishes.`;

function invalid(message: string): CliCommand {
  return { _tag: "Invalid", message };
}

function parseAppUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") {
    return undefined;
  }
  if (url.search !== "" || url.hash !== "") {
    return undefined;
  }
  if (url.pathname !== "/") {
    return undefined;
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return undefined;
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
