import {
  linkingHelperClient,
  linkingHelperScope,
} from "@lineupkeep/backend/auth/AuthorizationScopes";
import type { ProviderKey } from "@lineupkeep/backend/connections/Connection";
import { Duration, Effect } from "effect";

import { DeviceAuthorization } from "./DeviceAuthorization.ts";
import type { DeviceFlowFailure } from "./DeviceAuthorization.ts";
import { LinkingUpload } from "./LinkingUpload.ts";
import type { LinkingUploadFailure } from "./LinkingUpload.ts";
import { ProviderBrowser } from "./ProviderBrowser.ts";
import type { ProviderLoginFailure } from "./ProviderBrowser.ts";
import { Terminal } from "./Terminal.ts";

export type LinkCommandOptions = {
  readonly appUrl: URL;
  readonly provider: ProviderKey;
  readonly providerLabel: string;
  readonly providerLoginUrl: URL;
  readonly sessionCookies: ReadonlyArray<string>;
  readonly headless: boolean;
  readonly loginTimeout: Duration.Duration;
  readonly profileRoot: string;
};

export const runLinkCommand = (
  options: LinkCommandOptions,
): Effect.Effect<number, never, Terminal | DeviceAuthorization | ProviderBrowser | LinkingUpload> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal;
    const device = yield* DeviceAuthorization;
    const browser = yield* ProviderBrowser;
    const uploader = yield* LinkingUpload;

    const program = Effect.gen(function* () {
      yield* terminal.write("Lineupkeep local helper");
      yield* terminal.write(`Linking ${options.providerLabel} with ${options.appUrl.origin}`);

      const grant = yield* device.start({
        appUrl: options.appUrl,
        clientId: linkingHelperClient.clientId,
        scope: linkingHelperScope.name,
        resource: new URL("/mcp", options.appUrl).href,
      });
      yield* terminal.write(`Open ${grant.verificationUri.href}`);
      yield* terminal.write(`Enter pairing code ${grant.userCode}`);
      yield* terminal.write(
        `The code expires in ${Math.round(grant.expiresInSeconds / 60)} minutes.`,
      );
      yield* terminal.write(
        `Opening ${options.providerLabel} in a temporary browser profile. Lineupkeep never sees your password.`,
      );

      const session = yield* browser.signIn({
        loginUrl: options.providerLoginUrl,
        sessionCookies: options.sessionCookies,
        headless: options.headless,
        timeout: options.loginTimeout,
        profileRoot: options.profileRoot,
      });
      yield* terminal.write(
        `${options.providerLabel} sign-in received. Waiting for approval in Lineupkeep.`,
      );

      const token = yield* device.awaitApproval(grant);
      yield* terminal.write(`Helper approved. Uploading the ${options.providerLabel} session.`);
      yield* uploader.upload({
        appUrl: options.appUrl,
        token,
        userCode: grant.userCode,
        provider: options.provider,
        session,
      });
      yield* terminal.write(`${options.providerLabel} is linked. You can close this window.`);
    });

    const outcome = yield* program.pipe(Effect.result);
    if (outcome._tag === "Failure") {
      yield* terminal.error(describeFailure(outcome.failure, options));
      return 1;
    }
    return 0;
  });

function describeFailure(
  error: DeviceFlowFailure | ProviderLoginFailure | LinkingUploadFailure,
  options: LinkCommandOptions,
): string {
  switch (error._tag) {
    case "linking_helper.device_denied":
      return "Lineupkeep denied the helper request. Run `lineupkeep link` again to create a new pairing code.";
    case "linking_helper.device_expired":
      return "The pairing code expired before it was approved. Run `lineupkeep link` again.";
    case "linking_helper.device_rejected":
      return "Lineupkeep did not accept the pairing request. Check that the app and helper versions match, then try again.";
    case "linking_helper.device_unreachable":
      return `Could not reach Lineupkeep at ${options.appUrl.origin}. Check that the app is running and the address is correct.`;
    case "linking_helper.device_invalid_response":
      return "Lineupkeep returned an unexpected pairing response. Try again, or update the helper if the problem continues.";
    case "linking_helper.provider_browser_unavailable":
      return "Could not open the temporary browser. Run `bunx playwright install chromium` and try again.";
    case "linking_helper.provider_login_failed":
      return `The ${options.providerLabel} sign-in page could not be opened. Check your connection and try again.`;
    case "linking_helper.provider_login_closed":
      return `The ${options.providerLabel} sign-in window closed before sign-in finished. Run the helper again.`;
    case "linking_helper.provider_login_timed_out":
      return `${options.providerLabel} sign-in was not completed in time. Run the helper again.`;
    case "linking_helper.upload_unauthorized":
      return "Lineupkeep rejected the helper's authorization. Run `lineupkeep link` again.";
    case "linking_helper.upload_pairing_not_found":
      return "Lineupkeep has no active pairing for this code. Enter the code on the Connections page and approve the helper, or start a new pairing if it was cancelled.";
    case "linking_helper.upload_expired":
      return "The pairing expired before the provider session was uploaded. Run `lineupkeep link` again.";
    case "linking_helper.upload_rejected":
      return "The pairing was cancelled or is no longer accepting a session. Start again from the Connections page.";
    case "linking_helper.upload_provider_rejected":
      return `${options.providerLabel} did not accept the sign-in session. Run the helper again and complete the ${options.providerLabel} sign-in.`;
    case "linking_helper.upload_provider_unavailable":
      return `${options.providerLabel} could not confirm the session right now. Try again later.`;
    case "linking_helper.upload_unavailable":
      return "Lineupkeep could not store the connection right now. Try again later.";
    case "linking_helper.upload_unreachable":
      return "Could not reach Lineupkeep to upload the provider session. Check the connection and try again.";
    case "linking_helper.upload_invalid_response":
      return `Lineupkeep returned an unexpected upload response. If the app shows the provider as connected, the link succeeded; otherwise run the helper again.`;
  }
}
