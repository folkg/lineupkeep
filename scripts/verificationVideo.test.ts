import { expect, it } from "vitest";

import { videoDirection } from "#e2e/verify/renderVideo.ts";

import { shots } from "./verificationTest.ts";

it("rejects annotations outside the actual video's duration", () => {
  const direction = shots([{ start: 0, end: 2, claims: ["C1"], artifacts: [] }]);

  expect(() => videoDirection(direction, 1, ["C1"], () => true)).toThrow(
    "Scene timing must fit the raw video",
  );
});

it("rejects overlapping video annotations", () => {
  const direction = shots([
    { start: 0, end: 2, claims: ["C1"], artifacts: [] },
    { start: 1, end: 3, claims: ["C1"], artifacts: [] },
  ]);

  expect(() => videoDirection(direction, 3, ["C1"], () => true)).toThrow("without overlaps");
});

it("rejects a scene that cites a criterion the claim matrix does not define", () => {
  const direction = shots([{ start: 0, end: 1, claims: ["C9"], artifacts: [] }]);

  expect(() => videoDirection(direction, 1, ["C1"], () => true)).toThrow("C9");
});

it("rejects a scene that cites neither a criterion nor an artifact", () => {
  const direction = shots([{ start: 0, end: 1, claims: [], artifacts: [] }]);

  expect(() => videoDirection(direction, 1, ["C1"], () => true)).toThrow(
    "must cite a criterion or an artifact",
  );
});

it("accepts ordered annotations grounded in criteria and artifacts", () => {
  const direction = shots([{ start: 0, end: 1, claims: ["C1"], artifacts: ["draft.png"] }]);

  const validated = videoDirection(direction, 1, ["C1"], () => true);

  expect(validated).toEqual(direction);
});
