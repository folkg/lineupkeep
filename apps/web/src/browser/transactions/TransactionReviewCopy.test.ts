import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const copyModules = ["TransactionReviewPage.tsx", "transactionFailure.ts"];

const machineryWord =
  /\b(server|backend|provider|endpoint|payload|pipeline|service|worker|handler)s?\b/iu;

it("keeps our machinery words out of the review's copy", () => {
  for (const module of copyModules) {
    const source = readFileSync(new URL(module, import.meta.url), "utf8");
    expect(source, `${module} names the league, not our machinery`).not.toMatch(machineryWord);
  }
});
