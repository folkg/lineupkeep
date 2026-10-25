import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

export function describeSource(root: string): SourceDescription {
  const vcs = versionControl(root);
  switch (vcs) {
    case "git":
      return {
        vcs,
        revision: command(root, "git", "rev-parse", "HEAD"),
        workingTree: command(root, "git", "status", "--short"),
        patch: command(root, "git", "diff", "--binary", "HEAD"),
      };
    case "jj":
      return {
        vcs,
        revision: command(root, "jj", "log", "--no-graph", "-r", "@-", "-T", 'commit_id ++ "\\n"'),
        workingTree: command(root, "jj", "diff", "--summary"),
        patch: command(root, "jj", "diff", "--git"),
      };
  }
}

export function sourceFingerprint(root: string, selected: ReadonlyArray<string>): string {
  const files =
    versionControl(root) === "git"
      ? command(root, "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
      : command(root, "jj", "file", "list", "-T", 'path ++ "\\0"');
  const scratch = scratchTasks(selected).flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name))),
  );
  const hash = createHash("sha256");
  for (const path of [...new Set([...files.split("\0"), ...scratch, ...selected])]
    .filter(Boolean)
    .toSorted()) {
    hash.update(`${path}\0`);
    const file = join(root, path);
    hash.update(existsSync(file) ? readFileSync(file) : "\0deleted\0");
  }
  return hash.digest("hex");
}

export function scratchTasks(selected: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    ...new Set(
      selected
        .filter((path) => path.startsWith("e2e/scratch/"))
        .map((path) => path.split("/").slice(0, 3).join("/")),
    ),
  ];
}

function versionControl(root: string): SourceDescription["vcs"] {
  const checkout = realpathSync(root);
  if (rootOf(root, "jj", "root") === checkout) {
    return "jj";
  }
  if (rootOf(root, "git", "rev-parse", "--show-toplevel") === checkout) {
    return "git";
  }
  throw new Error(`${root} is neither a git working tree nor a jj workspace.`);
}

function rootOf(
  root: string,
  executable: string,
  ...arguments_: Array<string>
): string | undefined {
  try {
    return realpathSync(command(root, executable, ...arguments_));
  } catch {
    return undefined;
  }
}

function command(root: string, executable: string, ...arguments_: Array<string>): string {
  return execFileSync(executable, arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  }).trimEnd();
}

export type SourceDescription = {
  readonly vcs: "git" | "jj";
  readonly revision: string;
  readonly workingTree: string;
  readonly patch: string;
};
