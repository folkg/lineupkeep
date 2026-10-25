import { providerOrigins } from "@lineupkeep/hosted-browser/provider";

import { createHostedBrowserService } from "./server.ts";

const descriptorKey = process.env["HOSTED_BROWSER_DESCRIPTOR_KEY"];
if (descriptorKey === undefined || descriptorKey === "") {
  throw new Error("HOSTED_BROWSER_DESCRIPTOR_KEY is required");
}
const port = Number.parseInt(process.env["PORT"] ?? "", 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer");
}

const service = createHostedBrowserService({
  descriptorKey,
  allowedOrigins: providerOrigins,
  chromiumSandbox: false,
});
const bound = await service.listen(port);
console.log(JSON.stringify({ event: "hosted_browser.ready", port: bound }));

let stopping = false;
const stop = (): void => {
  if (stopping) {
    return;
  }
  stopping = true;
  setTimeout(() => process.exit(1), 9_000);
  void service.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
