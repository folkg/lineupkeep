import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { describeSource, sourceFingerprint } from "#e2e/verify/source.ts";

it("fingerprints a git checkout's content, including untracked and deleted files", async () => {
  await using checkout = await gitCheckout({ "tracked.txt": "one", "deleted.txt": "gone soon" });
  const initial = sourceFingerprint(checkout.root, []);

  await writeFile(join(checkout.root, "untracked.txt"), "new");
  const withUntracked = sourceFingerprint(checkout.root, []);
  await rm(join(checkout.root, "deleted.txt"));
  const withDeletion = sourceFingerprint(checkout.root, []);

  expect(new Set([initial, withUntracked, withDeletion]).size).toBe(3);
  expect(sourceFingerprint(checkout.root, [])).toBe(withDeletion);
  expect(describeSource(checkout.root).vcs).toBe("git");
});

it("fingerprints files whose names git would quote", async () => {
  await using checkout = await gitCheckout({ "café.ts": "export const value = 1;" });
  const before = sourceFingerprint(checkout.root, []);

  await writeFile(join(checkout.root, "café.ts"), "export const value = 2;");

  expect(sourceFingerprint(checkout.root, [])).not.toBe(before);
});

it.skipIf(!installed("jj"))("fingerprints a jj workspace without git by content", async () => {
  await using checkout = await jjCheckout({ "café.ts": "export const value = 1;", 'a"b.ts': "x" });
  const before = sourceFingerprint(checkout.root, []);

  await writeFile(join(checkout.root, "café.ts"), "export const value = 2;");

  expect(sourceFingerprint(checkout.root, [])).not.toBe(before);
  expect(describeSource(checkout.root).vcs).toBe("jj");
});

async function gitCheckout(files: Readonly<Record<string, string>>): Promise<{
  root: string;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "verification-source-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(root, path), content);
  }
  const git = (...arguments_: Array<string>): NonSharedBuffer =>
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.test", ...arguments_],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "initial");
  const cleanup = resources.move();
  return { root, [Symbol.asyncDispose]: () => cleanup.disposeAsync() };
}

async function jjCheckout(files: Readonly<Record<string, string>>): Promise<{
  root: string;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  await using resources = new AsyncDisposableStack();
  const root = await mkdtemp(join(tmpdir(), "verification-jj-"));
  resources.defer(() => rm(root, { recursive: true, force: true }));
  execFileSync("jj", ["git", "init", "--no-colocate"], { cwd: root, stdio: "ignore" });
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(root, path), content);
  }
  const cleanup = resources.move();
  return { root, [Symbol.asyncDispose]: () => cleanup.disposeAsync() };
}

function installed(executable: string): boolean {
  try {
    execFileSync(executable, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
