import { assertDeployableComposition } from "#deploy/verifyComposition.ts";

await assertDeployableComposition(new URL("../../.output/server/", import.meta.url));
console.log("Node build output contains no E2E test composition.");
