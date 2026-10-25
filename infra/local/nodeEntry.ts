import { writeFileSync } from "node:fs";
import { url } from "node:inspector";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = process.env["VERIFICATION_DIR"];
const inspector = url();
const entry = process.env["NODE_PRODUCTION_ENTRY"];
if (entry === undefined) {
  throw new Error("Production startup requires an entry");
}
if (directory !== undefined) {
  if (inspector === undefined) {
    throw new Error("Profiled production startup requires an inspector");
  }
  writeFileSync(
    join(directory, "inspector.json"),
    JSON.stringify({ url: inspector, pid: process.pid }),
  );
  console.log(`Owned Node inspector: ${inspector}`);
}
await import(pathToFileURL(resolve(entry)).href);
