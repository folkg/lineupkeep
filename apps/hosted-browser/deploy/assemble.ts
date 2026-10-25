import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const output = new URL("../.output/", import.meta.url);
const catalog = await readCatalog(new URL("../../../package.json", import.meta.url));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const build = spawnSync(
  "bun",
  [
    "build",
    new URL("../src/main.ts", import.meta.url).pathname,
    "--target=node",
    "--format=esm",
    "--outfile",
    new URL("server.mjs", output).pathname,
    "--external",
    "playwright",
    "--external",
    "ws",
  ],
  { stdio: "inherit" },
);
if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

await writeFile(
  new URL("package.json", output),
  `${JSON.stringify(
    {
      name: "lineupkeep-hosted-browser-service",
      private: true,
      type: "module",
      dependencies: {
        playwright: version(catalog, "playwright"),
        ws: version(catalog, "ws"),
      },
    },
    null,
    2,
  )}\n`,
);

async function readCatalog(manifestUrl: URL): Promise<Readonly<Record<string, string>>> {
  const manifest: unknown = JSON.parse(await readFile(manifestUrl, "utf8"));
  if (!isRecord(manifest) || !isRecord(manifest["catalog"])) {
    throw new Error("The workspace manifest has no dependency catalog");
  }
  const catalog: Record<string, string> = {};
  for (const [name, value] of Object.entries(manifest["catalog"])) {
    if (typeof value !== "string") {
      throw new Error(`The dependency catalog entry "${name}" is not a version string`);
    }
    catalog[name] = value;
  }
  return catalog;
}

function version(catalog: Readonly<Record<string, string>>, name: string): string {
  const value = catalog[name];
  if (value === undefined) {
    throw new Error(`The dependency catalog has no "${name}" entry`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
