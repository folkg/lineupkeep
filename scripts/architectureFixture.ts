import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cruise } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
export async function checkArchitecture(
  files: Readonly<Record<string, string>>,
): Promise<CommandResult> {
  const fixture = createFixture(files);
  try {
    const options = await extractDepcruiseOptions(join(repositoryRoot, ".dependency-cruiser.ts"));
    const result = await cruise(
      [
        "packages/backend/src",
        "packages/brand/src",
        "packages/lineup-solver/src",
        "packages/lineup-scoring/src",
        "packages/lineup-policy/src",
        "apps/web/src",
        "e2e",
        "infra",
        "tools",
        "scripts",
      ],
      { ...options, baseDir: fixture, outputType: "err-long" },
    );
    if (typeof result.output !== "string") {
      throw new Error("Expected dependency-cruiser diagnostics as text");
    }
    return { status: result.exitCode, output: result.output };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

export async function checkLint(
  files: Readonly<Record<string, string>>,
  fix = false,
): Promise<CommandResult & { readonly sources: Readonly<Record<string, string>> }> {
  return withFixture(files, async (cwd) => ({
    ...(await runTool(cwd, join(repositoryRoot, "node_modules/oxlint/bin/oxlint"), [
      ...(fix ? ["--fix"] : []),
      "--config",
      "oxlint.config.ts",
      "--tsconfig",
      "tsconfig.json",
      "--disable-nested-config",
      "--threads",
      "1",
      ...Object.keys(files),
    ])),
    sources: Object.fromEntries(
      Object.keys(files).map((path) => [path, readFileSync(join(cwd, path), "utf8")]),
    ),
  }));
}

export async function checkUnusedExports(
  files: Readonly<Record<string, string>>,
  production: boolean,
): Promise<CommandResult> {
  return withFixture(files, async (cwd) => {
    copyFileSync(join(repositoryRoot, "knip.ts"), join(cwd, "knip.ts"));
    return runTool(cwd, join(repositoryRoot, "node_modules/knip/bin/knip.js"), [
      "--include",
      "exports,types",
      "--no-config-hints",
      ...(production ? ["--production"] : []),
    ]);
  });
}

export async function checkMigrationDiscovery(
  files: Readonly<Record<string, string>>,
): Promise<CommandResult> {
  return withFixture(files, async (cwd) => {
    copyFileSync(
      join(repositoryRoot, "packages/backend/drizzle.config.ts"),
      join(cwd, "packages/backend/drizzle.config.ts"),
    );
    const script = join(cwd, "discover.mjs");
    writeFileSync(
      script,
      `
      import { globSync } from "node:fs";
      process.env.DATABASE_URL = "postgresql://fixture:fixture@localhost/fixture";
      const { default: config } = await import("./packages/backend/drizzle.config.ts");
      console.log(JSON.stringify(globSync(config.schema).sort()));
    `,
    );
    return runTool(cwd, script, []);
  });
}

export async function checkTableOwnership(
  files: Readonly<Record<string, string>>,
): Promise<CommandResult> {
  return withFixture(files, async (cwd) => {
    const scripts = "packages/backend/scripts";
    mkdirSync(join(cwd, scripts), { recursive: true });
    for (const file of ["check-table-ownership.ts", "tableOwnership.ts"]) {
      copyFileSync(join(repositoryRoot, scripts, file), join(cwd, scripts, file));
    }
    return runTool(cwd, join(cwd, scripts, "check-table-ownership.ts"), []);
  });
}

async function withFixture<Result>(
  files: Readonly<Record<string, string>>,
  check: (cwd: string) => Promise<Result>,
): Promise<Result> {
  const fixture = createFixture(files);
  try {
    return await check(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function createFixture(files: Readonly<Record<string, string>>): string {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "lineupkeep-architecture-")));
  try {
    for (const workspace of [
      "packages/backend",
      "packages/brand",
      "packages/lineup-solver",
      "packages/lineup-scoring",
      "packages/lineup-policy",
      "apps/web",
    ]) {
      mkdirSync(join(fixture, workspace, "src"), { recursive: true });
      symlinkSync(
        join(repositoryRoot, workspace, "node_modules"),
        join(fixture, workspace, "node_modules"),
        "dir",
      );
    }
    copyFileSync(join(repositoryRoot, "package.json"), join(fixture, "package.json"));
    mkdirSync(join(fixture, "e2e"));
    mkdirSync(join(fixture, "infra"));
    mkdirSync(join(fixture, "tools"));
    mkdirSync(join(fixture, "node_modules", "@lineupkeep"), { recursive: true });
    for (const entry of readdirSync(join(repositoryRoot, "node_modules"))) {
      if (entry !== "@lineupkeep") {
        symlinkSync(
          join(repositoryRoot, "node_modules", entry),
          join(fixture, "node_modules", entry),
        );
      }
    }
    mkdirSync(join(fixture, "tools"), { recursive: true });
    for (const [name, workspace] of [
      ["backend", "packages/backend"],
      ["brand", "packages/brand"],
      ["lineup-solver", "packages/lineup-solver"],
      ["lineup-scoring", "packages/lineup-scoring"],
      ["lineup-policy", "packages/lineup-policy"],
      ["web", "apps/web"],
      ["infra", "infra"],
      ["tools", "tools"],
    ] as const) {
      copyFileSync(
        join(repositoryRoot, workspace, "package.json"),
        join(fixture, workspace, "package.json"),
      );
      symlinkSync(
        join(fixture, workspace),
        join(fixture, "node_modules", "@lineupkeep", name),
        "dir",
      );
    }
    copyFileSync(join(repositoryRoot, "oxlint.config.ts"), join(fixture, "oxlint.config.ts"));
    mkdirSync(join(fixture, "scripts"));
    copyFileSync(
      join(repositoryRoot, "scripts/lintPlugin.ts"),
      join(fixture, "scripts/lintPlugin.ts"),
    );
    writeFileSync(
      join(fixture, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          jsx: "preserve",
          jsxImportSource: "@solidjs/web",
          module: "Preserve",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ["packages/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx"],
      }),
    );
    for (const [path, source] of Object.entries(files)) {
      const destination = join(fixture, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source);
    }
    return fixture;
  } catch (error) {
    rmSync(fixture, { recursive: true, force: true });
    throw error;
  }
}

function runTool(cwd: string, tool: string, args: ReadonlyArray<string>): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tool, ...args], {
      cwd,
      timeout: 30_000,
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

type CommandResult = {
  readonly status: number | null;
  readonly output: string;
};
