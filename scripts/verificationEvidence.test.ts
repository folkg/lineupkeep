import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  sceneAlignmentProblems,
  type Claims,
  type Results,
  claimProblems,
  declarationProblems,
  deliveryProblems,
  actingPersonas,
  checkpointPersonaName,
} from "#e2e/verify/evidence.ts";

import {
  shots,
  claims,
  criterion,
  runDirectory,
  declare,
  passingAttempt,
  passingResults,
} from "./verificationTest.ts";

it("accepts video labels for MCP-bearing steps with an asserted browser checkpoint", () => {
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        steps: passingAttempt.steps.map((step) => ({
          ...step,
          mcpExchanges: ["MCP exchange 1: tools/call"],
          hasCheckpoint: true,
        })),
      },
    ],
  };

  const problems = sceneAlignmentProblems(
    shots([{ start: 6, end: 9, claims: ["C1"], artifacts: [] }]),
    claims([criterion()]),
    results,
  );

  expect(problems).toEqual([]);
});

it("rejects service-only steps as browser scene proof", () => {
  const results = {
    ...passingResults,
    attempts: [
      {
        ...passingAttempt,
        steps: passingAttempt.steps.map((step) => ({
          ...step,
          serviceCalls: ["Service call 1: read"],
          hasCheckpoint: false,
        })),
      },
    ],
  };

  const problems = sceneAlignmentProblems(
    shots([{ start: 3, end: 4, claims: ["C1"], artifacts: [] }]),
    claims([criterion()]),
    results,
  );

  expect(problems.join(" ")).toContain("not in this video");
});

it("accepts a claim matrix whose passes cite passing assertion steps", () => {
  const problems = claimProblems(claims([criterion()]), passingResults, () => true);

  expect(problems).toEqual([]);
});

it("rejects a pass that cites a step from a failed test", () => {
  const results: Results = {
    verdict: "failed",
    attempts: [{ ...passingAttempt, status: "failed" }],
  };

  const problems = claimProblems(claims([criterion()]), results, () => true);

  expect(problems).toContainEqual(
    expect.stringContaining("record failed or blocked in claims.json"),
  );
});

it("rejects a pass supported only by setup", () => {
  const setup = criterion({ assertions: [{ test: "adds a note", step: "Setup: sign in" }] });

  const problems = claimProblems(claims([setup]), passingResults, () => true);

  expect(problems).toContainEqual(expect.stringContaining("cite a completed assertion step"));
});

it("rejects an MCP citation whose exchange artifact is missing", () => {
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        steps: passingAttempt.steps.map((step) => ({
          ...step,
          mcpExchanges: ["MCP exchange 1: tools/call"],
        })),
      },
    ],
  };

  const problems = claimProblems(claims([criterion()]), results, () => true);

  expect(problems).toContainEqual(
    expect.stringContaining("rerun through the MCP or services fixture"),
  );
});

it("refuses to label MCP-only assertions in a browser video", () => {
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        steps: passingAttempt.steps.map((step) => ({
          ...step,
          mcpExchanges: ["MCP exchange 1: tools/call"],
        })),
      },
    ],
  };

  const problems = sceneAlignmentProblems(
    shots([{ start: 6, end: 9, claims: ["C1"], artifacts: [] }]),
    claims([criterion()]),
    results,
  );

  expect(problems).toContainEqual(
    expect.stringContaining("record a browser checkpoint in the assertion step"),
  );
});

it("rejects a pass that cites an assertion step the run never executed", () => {
  const invented = criterion({ assertions: [{ test: "adds a note", step: "Undo: restores" }] });

  const problems = claimProblems(claims([invented]), passingResults, () => true);

  expect(problems).toContainEqual(
    expect.stringContaining("cite an executed test or assertion step"),
  );
});

it("requires a failed test to be disclosed by a failed or blocked criterion", () => {
  const results: Results = {
    verdict: "failed",
    attempts: [passingAttempt, { ...passingAttempt, title: "edits a note", status: "failed" }],
  };

  const problems = claimProblems(claims([criterion()]), results, () => true);

  expect(problems).toContainEqual(expect.stringContaining('"edits a note" ended failed'));
});

it("reports cited artifacts that the run did not produce", () => {
  const cited = criterion({ artifacts: ["test-results/persisted.png"] });

  const problems = claimProblems(claims([cited]), passingResults, () => false);

  expect(problems).toContainEqual(
    expect.stringContaining("use a run-relative artifact from results.json"),
  );
});

it("requires the claim matrix to state its limitations", () => {
  const problems = claimProblems(
    { ...claims([criterion()]), limitations: [] },
    passingResults,
    () => true,
  );

  expect(problems).toContainEqual(expect.stringContaining("list untested environments"));
});

it("blocks delivery when a requested video was never rendered", async () => {
  await using run = await runDirectory({ ...claims([criterion()]), video: "requested" });

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([
    "A video was requested, but walkthrough.mp4 has not been rendered; run bun run verify:video <run-dir> and review its frames to supply the requested visual proof.",
  ]);
});

it("blocks delivery when cleanup was incomplete", async () => {
  await using run = await runDirectory(claims([criterion()]), {
    "cleanup.json": { cleanupComplete: false },
  });

  const problems = await deliveryProblems(run.directory);

  expect(problems).toContainEqual(
    expect.stringContaining("bun run verify --recover before delivery"),
  );
});

it("blocks delivery when the source changed during the run", async () => {
  await using run = await runDirectory(claims([criterion()]), {
    "source-check.json": { changedDuringRun: true },
  });

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([
    "The source changed during the run, so evidence has no stable source identity; rerun bun run verify without editing until cleanup completes.",
  ]);
});

it("blocks delivery when criteria were not declared before the run", async () => {
  await using run = await runDirectory(claims([criterion()]));
  await writeFile(
    join(run.directory, "run.json"),
    JSON.stringify({ runId: "run", criteriaDeclared: false }),
  );

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([expect.stringContaining("bun run verify --criteria <file>")]);
});

it("blocks delivery when criteria were changed after the run started", async () => {
  const matrix = claims([criterion()]);
  await using run = await runDirectory(matrix);
  const reworded = claims([criterion({ statement: "Something easier" })]);
  await writeFile(join(run.directory, "criteria.json"), JSON.stringify(declare(reworded)));
  await writeFile(join(run.directory, "claims.json"), JSON.stringify(reworded));

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([
    "criteria.json differs from the declaration recorded when the run started, so the proof target is no longer fixed; rerun bun run verify --criteria <file> with the intended criteria.",
  ]);
});

it("blocks delivery when required evidence is invalid rather than skipping its checks", async () => {
  await using run = await runDirectory(claims([criterion()]));
  await writeFile(join(run.directory, "criteria.json"), "not JSON");

  const problems = await deliveryProblems(run.directory);

  expect(problems).toContainEqual(
    expect.stringContaining("Regenerate runner-owned evidence or correct review-authored JSON"),
  );
});

it("rejects claims that reshape the declared criteria", () => {
  const declared = declare(claims([criterion()]));
  const reshaped = claims([
    criterion({ statement: "An added note appears" }),
    criterion({ id: "C2", statement: "Something that happened to pass" }),
  ]);

  const problems = declarationProblems(declared, reshaped);

  expect(problems).toEqual([
    "Criterion C1's statement differs from its declaration, changing the proof target; copy its statement from criteria.json or rerun with the intended criteria.",
    "Criterion C2 was not declared before the run, so it is not prior-intent proof; remove it from claims.json or declare it in a fresh bun run verify --criteria <file> run.",
  ]);
});

it("rejects a scene that labels a criterion away from its asserted step", () => {
  const direction = shots([{ start: 0, end: 3, claims: ["C1"], artifacts: [] }]);

  const problems = sceneAlignmentProblems(direction, claims([criterion()]), passingResults);

  expect(problems).toEqual([
    expect.stringContaining("align the scene with those steps in shots.json"),
  ]);
});

it("rejects a scene that labels a criterion it only touches at its edge", () => {
  const direction = shots([{ start: 3, end: 6.4, claims: ["C1"], artifacts: [] }]);

  const problems = sceneAlignmentProblems(direction, claims([criterion()]), passingResults);

  expect(problems).toEqual([
    expect.stringContaining("align the scene with those steps in shots.json"),
  ]);
});

it("accepts a scene that labels a criterion while its asserted step is on screen", () => {
  const direction = shots([{ start: 5.8, end: 9.5, claims: ["C1"], artifacts: [] }]);

  const problems = sceneAlignmentProblems(direction, claims([criterion()]), passingResults);

  expect(problems).toEqual([]);
});

it("rejects service setup citations and missing cited service evidence", () => {
  const action = {
    ...passingAttempt.steps[1],
    title: "Action (services): create",
    status: "completed",
    durationMs: 100,
    serviceCalls: ["Service call 1: create"],
  };
  const setup = { ...action, title: "Setup (services): create" };

  const results = (step: typeof action): Results => ({
    verdict: "passed",
    attempts: [{ ...passingAttempt, steps: [step], attachments: [] }],
  });
  expect(
    claimProblems(
      claims([criterion({ assertions: [{ test: passingAttempt.title, step: action.title }] })]),
      results(action),
      () => true,
    ).join(" "),
  ).toContain("missing service call");
  expect(
    claimProblems(
      claims([criterion({ assertions: [{ test: passingAttempt.title, step: setup.title }] })]),
      results(setup),
      () => true,
    ).join(" "),
  ).toContain("not proof");
});

it("blocks delivery when a video's direction changed after it was rendered", async () => {
  await using run = await renderedRun();
  await writeFile(
    join(run.directory, "shots.json"),
    JSON.stringify(shots([{ start: 6.1, end: 8.9, claims: ["C1"], artifacts: [] }])),
  );

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([
    "shots.json changed after walkthrough.mp4 was rendered; render and review again.",
  ]);
});

it("blocks delivery when the rendered review frames are missing", async () => {
  await using run = await renderedRun();
  await rm(join(run.directory, "review-frames"), { recursive: true });

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([
    "Review frame scene-01-middle.png is missing or differs from the one rendered, so visual approval cannot be verified; rerender with bun run verify:video <run-dir> and review the resulting frames.",
  ]);
});

it("accepts a video rendered and reviewed from the current evidence", async () => {
  await using run = await renderedRun();

  const problems = await deliveryProblems(run.directory);

  expect(problems).toEqual([]);
});

it("refuses to label criteria in a test that recorded several page videos", () => {
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        attachments: [
          { name: "video", path: "test-results/video.webm" },
          { name: "video", path: "test-results/popup.webm" },
        ],
      },
    ],
  };
  const direction = shots([{ start: 6, end: 9, claims: ["C1"], artifacts: [] }]);

  const problems = sceneAlignmentProblems(direction, claims([criterion()]), results);

  expect(problems).toEqual([
    expect.stringContaining("scenes may cite artifacts but not label criteria"),
  ]);
});

it("accepts a pass that cites a passing test whole", () => {
  const whole = criterion({ assertions: [{ test: "adds a note" }] });

  const problems = claimProblems(claims([whole]), passingResults, () => true);

  expect(problems).toEqual([]);
});

it("rejects a pass that cites a failed test whole", () => {
  const whole = criterion({ assertions: [{ test: "adds a note" }] });
  const results: Results = {
    verdict: "failed",
    attempts: [{ ...passingAttempt, status: "failed" }],
  };

  const problems = claimProblems(claims([whole]), results, () => true);

  expect(problems).toContainEqual(
    'Criterion C1 claims a pass, but the whole test "adds a note" did not pass; record failed or blocked in claims.json, or fix the behavior and rerun to obtain passing proof.',
  );
});

it.each<{ readonly entry: Partial<Claims["criteria"][number]>; readonly remedy: string }>([
  {
    entry: { statement: "" },
    remedy: "copy the declared statement and describe what the run showed",
  },
  {
    entry: { observation: "" },
    remedy: "copy the declared statement and describe what the run showed",
  },
  { entry: { assertions: [] }, remedy: "add a passing results.json assertion citation" },
  {
    entry: { status: "failed", assertions: [] },
    remedy: "cite the failed test or step from results.json",
  },
])("explains how to repair incomplete criterion proof: $remedy", ({ entry, remedy }) => {
  const problems = claimProblems(claims([criterion(entry)]), passingResults, () => true);

  expect(problems).toContainEqual(expect.stringContaining(remedy));
});

it("explains how to report an empty claim matrix", () => {
  const problems = claimProblems(claims([]), passingResults, () => true);

  expect(problems).toContainEqual(
    expect.stringContaining("copy the declared criteria from criteria.json"),
  );
});

it("explains how to disambiguate duplicate criterion IDs", () => {
  const problems = claimProblems(claims([criterion(), criterion()]), passingResults, () => true);

  expect(problems).toContainEqual(
    expect.stringContaining("keep one claims.json entry per declared criterion ID"),
  );
});

it("explains how to disclose an unsuccessful run verdict", () => {
  const problems = claimProblems(
    claims([criterion()]),
    { ...passingResults, verdict: "blocked" },
    () => true,
  );

  expect(problems).toContainEqual(
    expect.stringContaining("disclose the failed or blocked work in claims.json"),
  );
});

it("explains how to preserve the declared request and coverage", () => {
  const declared = declare(claims([criterion()]));
  const matrix = { ...claims([]), request: "A different request" };

  const problems = declarationProblems(declared, matrix);

  expect(problems).toContainEqual(expect.stringContaining("copy the request from criteria.json"));
  expect(problems).toContainEqual(
    expect.stringContaining("add it to claims.json as blocked or not-tested"),
  );
});

it("explains how to select a recorded video", () => {
  const problems = sceneAlignmentProblems(
    { ...shots([]), rawVideo: "other.webm" },
    claims([criterion()]),
    passingResults,
  );

  expect(problems).toContainEqual(
    expect.stringContaining("set shots.json rawVideo to a video attachment from results.json"),
  );
});

it("explains how to annotate another user's video without claiming primary-page proof", () => {
  const results: Results = {
    ...passingResults,
    attempts: [
      {
        ...passingAttempt,
        attachments: [
          ...passingAttempt.attachments,
          { name: "other-user-video", path: "other.webm" },
        ],
      },
    ],
  };

  const problems = sceneAlignmentProblems(
    { ...shots([{ start: 6, end: 9, claims: ["C1"], artifacts: [] }]), rawVideo: "other.webm" },
    claims([criterion()]),
    results,
  );

  expect(problems).toContainEqual(
    expect.stringContaining("scenes may cite artifacts but not label criteria"),
  );
});

it("explains how to produce missing required evidence", async () => {
  await using run = await runDirectory(claims([criterion()]));
  await rm(join(run.directory, "results.json"));

  const problems = await deliveryProblems(run.directory);

  expect(problems).toContainEqual(
    expect.stringContaining("produce it using the verify-app skill's run and review steps"),
  );
});

it.each([
  {
    file: "walkthrough.mp4",
    value: "different video",
    remedy: "rerun bun run verify:video <run-dir> and review the resulting frames",
  },
  {
    file: "media-check.json",
    value: {
      walkthroughSha256: createHash("sha256").update("rendered footage").digest("hex"),
      fullDecode: "passed",
      inputs: {},
      reviewFrames: [],
    },
    remedy: "video has no inspectable visual proof",
  },
  {
    file: "visual-review.json",
    value: {
      walkthroughSha256: "stale",
      reviewedFrames: [],
      approved: false,
      findings: "Caption hides proof",
    },
    remedy: "inspect the current review frames and record their render hash",
  },
])(
  "explains how to repair stale or unreviewed video evidence in $file",
  async ({ file, value, remedy }) => {
    await using run = await renderedRun();
    await writeFile(
      join(run.directory, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );

    const problems = await deliveryProblems(run.directory);

    expect(problems).toContainEqual(expect.stringContaining(remedy));
    if (file === "visual-review.json") {
      expect(problems).toContainEqual(
        expect.stringContaining("inspect each media-check.json review frame and record its name"),
      );
      expect(problems).toContainEqual(
        expect.stringContaining("Address these findings, rerender if needed"),
      );
    }
  },
);

it("explains how to disclose visual coverage gaps", async () => {
  await using run = await renderedRun();
  await writeFile(
    join(run.directory, "shots.json"),
    JSON.stringify({
      ...shots([]),
      notShown: [{ claim: "C1", reason: "" }],
    }),
  );

  const problems = await deliveryProblems(run.directory);

  expect(problems).toContainEqual(expect.stringContaining("fill in its notShown reason"));
});

it("explains how to label or disclose an omitted video criterion", async () => {
  await using run = await renderedRun();
  await writeFile(join(run.directory, "shots.json"), JSON.stringify(shots([])));

  const problems = await deliveryProblems(run.directory);

  expect(problems).toContainEqual(
    expect.stringContaining("label a scene or list it in notShown with a reason"),
  );
});

it("collects acting personas from service, MCP, and browser checkpoint evidence", () => {
  const attachments = [
    { name: "Service call 1: create", body: Buffer.from(JSON.stringify({ persona: "owner" })) },
    { name: "MCP exchange 1: tools/list", body: Buffer.from(JSON.stringify({ persona: "other" })) },
    {
      name: checkpointPersonaName("saved"),
      body: Buffer.from(JSON.stringify({ persona: "owner" })),
    },
    { name: "unrelated data", body: Buffer.from("{}") },
  ];

  expect(actingPersonas(attachments)).toEqual(["owner", "other"]);
});

async function renderedRun(): Promise<{
  directory: string;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const matrix = { ...claims([criterion()]), video: "requested" as const };
  const run = await runDirectory(matrix);
  const file = (name: string, content: string): Promise<void> =>
    writeFile(join(run.directory, name), content);
  const hash = (content: string): string => createHash("sha256").update(content).digest("hex");
  await mkdir(join(run.directory, "test-results"));
  await mkdir(join(run.directory, "review-frames"));
  const direction = JSON.stringify(shots([{ start: 6, end: 9, claims: ["C1"], artifacts: [] }]));
  await file("shots.json", direction);
  await file("test-results/video.webm", "raw footage");
  await file("walkthrough.mp4", "rendered footage");
  await file("review-frames/scene-01-middle.png", "frame");
  const read = (name: string): Promise<string> => readFile(join(run.directory, name), "utf8");
  await file(
    "media-check.json",
    JSON.stringify({
      walkthroughSha256: hash("rendered footage"),
      fullDecode: "passed",
      inputs: {
        "shots.json": hash(direction),
        "claims.json": hash(await read("claims.json")),
        "results.json": hash(await read("results.json")),
        "test-results/video.webm": hash("raw footage"),
      },
      reviewFrames: [{ name: "scene-01-middle.png", sha256: hash("frame") }],
    }),
  );
  await file(
    "visual-review.json",
    JSON.stringify({
      walkthroughSha256: hash("rendered footage"),
      reviewedFrames: ["scene-01-middle.png"],
      approved: true,
      findings: "Captions match the footage.",
    }),
  );
  return run;
}
