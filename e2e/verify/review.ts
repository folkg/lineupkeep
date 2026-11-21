#!/usr/bin/env node
import { Array as EffectArray } from "effect";

import { writeDeliveryVerdict } from "./evidence.ts";
import { writeReport } from "./report.ts";

const directory = process.argv[2];
if (directory === undefined) {
  throw new Error("Usage: bun run verify:review <printed-run-directory>");
}
const problems = await writeDeliveryVerdict(directory);
await writeReport(directory, problems);
if (problems.length === 0) {
  console.log(
    "Delivery gate passed: evidence is consistent and complete. Share report.html; see delivery.json.",
  );
} else {
  console.error(`Delivery gate failed:\n- ${EffectArray.join(problems, "\n- ")}`);
  console.error("report.html is marked NOT READY until these are resolved.");
  process.exitCode = 1;
}
