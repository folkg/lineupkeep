import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { EffectString } from "@lineupkeep/collections";
import { Array as EffectArray } from "effect";
import { expect, it } from "vitest";

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

const sourceRoots = [
  "apps/web/src",
  "apps/hosted-browser/src",
  "packages/backend/src",
  "packages/backend/scripts",
  "packages/brand/src",
  "packages/hosted-browser/src",
  "packages/lineup-solver/src",
  "packages/yahoo-sdk/src",
  "e2e",
  "infra",
  "scripts",
  "tools",
];
const documents = [
  "docs/fantasy-manager/GLOSSARY.md",
  "docs/fantasy-manager/MCP.md",
  "docs/fantasy-manager/ARCHITECTURE.md",
];
const excluded = new Set([
  "packages/backend/src/database/MigrationOrdering.test.ts",
  "packages/backend/src/database/RemovedTransactionStorage.test.ts",
]);
const excludedPrefixes = ["e2e/scratch/"];
const removedTerms: ReadonlyArray<RegExp> = [
  /transaction_proposal_/i,
  /transactionProposal/i,
  /ProposalSet/i,
  /ProposalItemId\b/,
  /ListProposalSets/,
  /isClosedSet/,
  /reviewPath/,
  /transactions\.\$setId/,
  /proposal set/i,
  /\btransaction sets?\b/i,
  /\breview pages?\b/i,
  /\bset[ _]ids?\b/i,
  /\bset history\b/i,
  /\breview links?\b/i,
  /\bset lifetime\b/i,
];

it("keeps the removed proposal-set storage out of code, tests, and the contracts", () => {
  const files = EffectArray.filter(
    [
      ...EffectArray.flatMap(sourceRoots, (root) => {
        const flatMapped1 = globSync(`${root}/**/*.{ts,tsx}`, { cwd: process.cwd() });
        return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
      }),
      ...globSync("*.ts", { cwd: process.cwd() }),
      ...documents,
    ],
    (file) =>
      !excluded.has(file) &&
      !EffectArray.some(excludedPrefixes, (prefix) => EffectString.startsWith(file, prefix)),
  );
  const findings: Array<string> = [];
  for (const file of files) {
    const contents = readFileSync(join(process.cwd(), file), "utf8");
    for (const term of removedTerms) {
      const match = term.exec(contents);
      if (match !== null) {
        findings.push(`${file}: ${match[0]}`);
      }
    }
  }
  expect(findings).toEqual([]);
});
