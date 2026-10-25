import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { Schema } from "effect";

import { isMcpExchangeAttachment, McpExchangeJson } from "./mcpEvidence.ts";
import { isServiceCallAttachment, ServiceCallJson } from "./serviceEvidence.ts";
export async function deliveryProblems(directory: string): Promise<ReadonlyArray<string>> {
  const problems: Array<string> = [];
  const read = requiredReader(directory, problems);
  const run = await read("run.json", RunJson);
  const results = await read("results.json", ResultsJson);
  const claims = await read("claims.json", ClaimsJson);
  const cleanup = await read("cleanup.json", CleanupJson);
  const source = await read("source-check.json", SourceCheckJson);
  if (cleanup !== undefined && !cleanup.cleanupComplete) {
    problems.push(
      "cleanup.json reports incomplete cleanup, so resources may still be owned; run bun run verify --recover before delivery.",
    );
  }
  if (source?.changedDuringRun === true) {
    problems.push(
      "The source changed during the run, so evidence has no stable source identity; rerun bun run verify without editing until cleanup completes.",
    );
  }
  if (run !== undefined && !run.criteriaDeclared) {
    problems.push(
      "Criteria were not declared before the run, so claims cannot be checked against prior intent; rerun with `bun run verify --criteria <file>`.",
    );
  } else if (run !== undefined) {
    const declared = await read("criteria.json", DeclaredCriteriaJson);
    if ((await fileSha256(directory, "criteria.json")) !== run.criteriaSha256) {
      problems.push(
        "criteria.json differs from the declaration recorded when the run started, so the proof target is no longer fixed; rerun bun run verify --criteria <file> with the intended criteria.",
      );
    }
    if (declared !== undefined && claims !== undefined) {
      for (const problem of declarationProblems(declared, claims)) {
        problems.push(problem);
      }
    }
  }
  for (const attempt of results?.attempts ?? []) {
    for (const attachment of attempt.attachments.filter(isMcpExchangeAttachment)) {
      await read(attachment.path, McpExchangeJson);
    }
    for (const attachment of attempt.attachments.filter(isServiceCallAttachment)) {
      const call = await read(attachment.path, ServiceCallJson);
      if (
        call !== undefined &&
        !attempt.steps.some(
          (step) =>
            step.title === `${call.phase} (services) [${call.persona}]: ${call.description}` &&
            step.serviceCalls?.includes(attachment.name) === true,
        )
      ) {
        problems.push(
          `${attachment.name} is not attached to its service phase step, so it cannot support that observation; rerun the call through the services fixture's phase helper.`,
        );
      }
    }
  }
  if (results !== undefined && claims !== undefined) {
    for (const problem of claimProblems(claims, results, (path) =>
      artifactExists(directory, path),
    )) {
      problems.push(problem);
    }
  }
  if (results !== undefined && claims?.video === "requested") {
    for (const problem of await videoProblems(directory, claims, results, read)) {
      problems.push(problem);
    }
  }
  return problems;
}

export function declarationProblems(
  declared: DeclaredCriteria,
  claims: Claims,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  if (claims.request !== declared.request) {
    problems.push(
      "claims.json restates the request differently from the declared criteria, changing the proof target; copy the request from criteria.json or rerun with the intended criteria.",
    );
  }
  for (const criterion of declared.criteria) {
    const claimed = claims.criteria.find((candidate) => candidate.id === criterion.id);
    if (claimed === undefined) {
      problems.push(
        `Declared criterion ${criterion.id} has no claim, leaving coverage undisclosed; add it to claims.json as blocked or not-tested if no proof ran.`,
      );
    } else if (claimed.statement !== criterion.statement) {
      problems.push(
        `Criterion ${criterion.id}'s statement differs from its declaration, changing the proof target; copy its statement from criteria.json or rerun with the intended criteria.`,
      );
    }
  }
  for (const claimed of claims.criteria) {
    if (!declared.criteria.some((criterion) => criterion.id === claimed.id)) {
      problems.push(
        `Criterion ${claimed.id} was not declared before the run, so it is not prior-intent proof; remove it from claims.json or declare it in a fresh bun run verify --criteria <file> run.`,
      );
    }
  }
  return problems;
}

export function sceneAlignmentProblems(
  shots: Shots,
  claims: Claims,
  results: Results,
): ReadonlyArray<string> {
  const attempt = results.attempts.find((candidate) =>
    candidate.attachments.some((attachment) => attachment.path === shots.rawVideo),
  );
  if (attempt === undefined) {
    return [
      `${shots.rawVideo} is not the recorded video of any test in this run, so scene timing cannot be verified; set shots.json rawVideo to a video attachment from results.json.`,
    ];
  }
  const problems: Array<string> = [];

  const pageVideos = attempt.attachments.filter((attachment) => attachment.name === "video");
  if (pageVideos.length > 1 && shots.scenes.some((scene) => scene.claims.length > 0)) {
    problems.push(
      `"${attempt.title}" recorded ${pageVideos.length} page videos, so step positions are unknown in each; scenes may cite artifacts but not label criteria.`,
    );
    return problems;
  }
  const primary = pageVideos.some((attachment) => attachment.path === shots.rawVideo);
  if (!primary && shots.scenes.some((scene) => scene.claims.length > 0)) {
    problems.push(
      `${shots.rawVideo} is another User's video; its scenes may cite artifacts but not label criteria.`,
    );
    return problems;
  }
  for (const scene of shots.scenes) {
    for (const id of scene.claims) {
      const windows = (claims.criteria.find((criterion) => criterion.id === id)?.assertions ?? [])
        .filter((assertion) => assertion.test === attempt.title)
        .flatMap((assertion) =>
          attempt.steps
            .filter(
              (step) =>
                step.title === assertion.step &&
                (((step.mcpExchanges?.length ?? 0) === 0 &&
                  (step.serviceCalls?.length ?? 0) === 0) ||
                  step.hasCheckpoint === true),
            )
            .flatMap((step) => (step.videoSeconds === undefined ? [] : [step.videoSeconds])),
        );
      if (windows.length === 0) {
        problems.push(
          `Scene "${scene.title}" labels ${id}, whose cited steps are not in this video; cite an artifact instead, or record a browser checkpoint in the assertion step to ground the label.`,
        );
      } else if (coveredSeconds(scene, windows) < (scene.end - scene.start) / 2) {
        const when = windows.map((window) => `${window.start}–${window.end}s`).join(", ");
        problems.push(
          `Scene "${scene.title}" (${scene.start}–${scene.end}s) labels ${id}, but its cited steps happen at ${when}; align the scene with those steps in shots.json so the label shows its proof.`,
        );
      }
    }
  }
  return problems;
}

function coveredSeconds(
  scene: { readonly start: number; readonly end: number },
  windows: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): number {
  let covered = 0;
  let reached = scene.start;
  for (const window of windows.toSorted((left, right) => left.start - right.start)) {
    const start = Math.max(reached, window.start - alignmentToleranceSeconds, scene.start);
    const end = Math.min(window.end + alignmentToleranceSeconds, scene.end);
    if (end > start) {
      covered += end - start;
      reached = end;
    }
  }
  return covered;
}

function citation(assertion: { readonly test: string; readonly step?: string }): string {
  return assertion.step === undefined
    ? `the whole test "${assertion.test}"`
    : `"${assertion.test}" › "${assertion.step}"`;
}

const alignmentToleranceSeconds = 0.25;

export function claimProblems(
  claims: Claims,
  results: Results,
  artifactExists: (path: string) => boolean,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  if (claims.criteria.length === 0) {
    problems.push(
      "claims.json needs at least one criterion to disclose coverage; copy the declared criteria from criteria.json and record each outcome.",
    );
  }
  if (claims.limitations.length === 0) {
    problems.push(
      "claims.json must state limitations because local proof is bounded; list untested environments, behaviors, or evidence gaps in limitations.",
    );
  }
  const ids = claims.criteria.map((criterion) => criterion.id);
  for (const duplicate of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(
      `Criterion ${duplicate} is declared more than once, making citations ambiguous; keep one claims.json entry per declared criterion ID.`,
    );
  }
  for (const criterion of claims.criteria) {
    for (const problem of criterionProblems(criterion, results, artifactExists)) {
      problems.push(problem);
    }
  }
  const disclosed = new Set(
    claims.criteria
      .filter((criterion) => criterion.status === "failed" || criterion.status === "blocked")
      .flatMap((criterion) => criterion.assertions.map((assertion) => assertion.test)),
  );
  for (const attempt of results.attempts.filter((attempt) => attempt.status !== "passed")) {
    if (!disclosed.has(attempt.title)) {
      problems.push(
        `Test "${attempt.title}" ended ${attempt.status}, but no failed or blocked criterion discloses it; cite it under a failed or blocked claims.json criterion so delivery reflects the run.`,
      );
    }
  }
  if (
    results.verdict !== "passed" &&
    !claims.criteria.some(
      (criterion) => criterion.status === "failed" || criterion.status === "blocked",
    )
  ) {
    problems.push(
      `The run's verdict is ${results.verdict}, but every criterion claims success; disclose the failed or blocked work in claims.json so delivery reflects the run.`,
    );
  }
  return problems;
}

function criterionProblems(
  criterion: Criterion,
  results: Results,
  artifactExists: (path: string) => boolean,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const label = `Criterion ${criterion.id}`;
  if (criterion.statement.trim() === "" || criterion.observation.trim() === "") {
    problems.push(
      `${label} needs a statement and the actual observation to make its outcome reviewable; copy the declared statement and describe what the run showed in claims.json.`,
    );
  }
  for (const artifact of criterion.artifacts) {
    if (!artifactExists(artifact)) {
      problems.push(
        `${label} cites ${artifact}, which is not a file in this run; use a run-relative artifact from results.json or rerun to capture it so the claim has retained proof.`,
      );
    }
  }
  const outcomes = criterion.assertions.map((assertion) => {
    const attempt = results.attempts.find((candidate) => candidate.title === assertion.test);
    const step =
      assertion.step === undefined
        ? undefined
        : attempt?.steps.find((candidate) => candidate.title === assertion.step);
    if (attempt === undefined || (assertion.step !== undefined && step === undefined)) {
      problems.push(
        `${label} cites ${citation(assertion)}, which this run did not execute; cite an executed test or assertion step from results.json, or rerun to establish proof.`,
      );
      return undefined;
    }
    const citedSteps = step === undefined ? attempt.steps : [step];
    for (const [kind, names] of [
      ["MCP exchange", citedSteps.flatMap((entry) => entry.mcpExchanges ?? [])],
      ["service call", citedSteps.flatMap((entry) => entry.serviceCalls ?? [])],
    ] as const) {
      for (const name of new Set(names)) {
        const attachment = attempt.attachments.find((entry) => entry.name === name);
        if (attachment === undefined || !artifactExists(attachment.path)) {
          problems.push(
            `${label} cites a missing ${kind}: ${name}; rerun through the MCP or services fixture to retain the exchange or call artifact that supports the assertion.`,
          );
        }
      }
    }
    return { attempt, step, cited: citation(assertion) };
  });
  switch (criterion.status) {
    case "passed": {
      if (criterion.assertions.length === 0) {
        problems.push(
          `${label} claims a pass without citing a test or an assertion step; add a passing results.json assertion citation so the outcome has observable proof.`,
        );
      }
      for (const outcome of outcomes) {
        if (outcome === undefined) {
          continue;
        }
        if (outcome.step?.title.startsWith("Setup") === true) {
          problems.push(
            `${label} cites setup step "${outcome.step.title}", which is not proof; cite a completed assertion step from a passing test in results.json instead.`,
          );
        }
        if (
          outcome.attempt.status !== "passed" ||
          outcome.attempt.expectedStatus !== "passed" ||
          (outcome.step !== undefined && outcome.step.status !== "completed")
        ) {
          problems.push(
            `${label} claims a pass, but ${outcome.cited} did not pass; record failed or blocked in claims.json, or fix the behavior and rerun to obtain passing proof.`,
          );
        }
      }
      break;
    }
    case "failed": {
      if (
        !outcomes.some(
          (outcome) =>
            outcome !== undefined &&
            (outcome.attempt.status !== "passed" || outcome.step?.status === "failed"),
        )
      ) {
        problems.push(
          `${label} claims a failure without citing the failing test step; cite the failed test or step from results.json to make the failure reviewable.`,
        );
      }
      break;
    }
    case "blocked":
    case "not-tested":
      break;
  }
  return problems;
}

async function videoProblems(
  directory: string,
  claims: Claims,
  results: Results,
  read: RequiredReader,
): Promise<ReadonlyArray<string>> {
  if (!existsSync(join(directory, "walkthrough.mp4"))) {
    return [
      "A video was requested, but walkthrough.mp4 has not been rendered; run bun run verify:video <run-dir> and review its frames to supply the requested visual proof.",
    ];
  }
  const problems: Array<string> = [];
  const shots = await read("shots.json", ShotsJson);
  const media = await read("media-check.json", MediaCheckJson);
  const review = await read("visual-review.json", VisualReviewJson);
  if (shots === undefined || media === undefined || review === undefined) {
    return problems;
  }
  for (const problem of sceneAlignmentProblems(shots, claims, results)) {
    problems.push(problem);
  }
  const shown = new Set(shots.scenes.flatMap((scene) => scene.claims));
  const explained = new Set((shots.notShown ?? []).map((entry) => entry.claim));
  for (const entry of shots.notShown ?? []) {
    if (entry.reason.trim() === "") {
      problems.push(
        `shots.json leaves ${entry.claim} out of the video without a reason; fill in its notShown reason so visual coverage gaps are disclosed.`,
      );
    }
  }
  for (const criterion of claims.criteria) {
    if (
      (criterion.status === "passed" || criterion.status === "failed") &&
      !shown.has(criterion.id) &&
      !explained.has(criterion.id)
    ) {
      problems.push(
        `The video never shows criterion ${criterion.id} (${criterion.status}); label a scene or list it in notShown with a reason.`,
      );
    }
  }
  const current = await renderInputs(directory, shots.rawVideo);
  for (const [input, hash] of Object.entries(current)) {
    if (media.inputs[input] !== hash) {
      problems.push(
        `${input} changed after walkthrough.mp4 was rendered; render and review again.`,
      );
    }
  }
  const walkthrough = await sha256(join(directory, "walkthrough.mp4"));
  if (media.walkthroughSha256 !== walkthrough) {
    problems.push(
      "walkthrough.mp4 is not the file that verify:video rendered and decoded, so its media check is stale; rerun bun run verify:video <run-dir> and review the resulting frames.",
    );
  }
  if (media.reviewFrames.length === 0) {
    problems.push(
      "verify:video extracted no review frames, so the video has no inspectable visual proof; rerun bun run verify:video <run-dir> and review the resulting frames.",
    );
  }
  for (const frame of media.reviewFrames) {
    const path = resolveArtifact(directory, join("review-frames", frame.name));
    if (path === undefined || (await sha256(path)) !== frame.sha256) {
      problems.push(
        `Review frame ${frame.name} is missing or differs from the one rendered, so visual approval cannot be verified; rerender with bun run verify:video <run-dir> and review the resulting frames.`,
      );
    }
  }
  if (review.walkthroughSha256 !== walkthrough) {
    problems.push(
      "visual-review.json reviewed a different render than the current walkthrough.mp4, so approval is stale; inspect the current review frames and record their render hash in visual-review.json.",
    );
  }
  const expected = media.reviewFrames.map((frame) => frame.name).toSorted();
  if (JSON.stringify(review.reviewedFrames.toSorted()) !== JSON.stringify(expected)) {
    problems.push(
      "visual-review.json must list every frame extracted from this render to establish complete review; inspect each media-check.json review frame and record its name in reviewedFrames.",
    );
  }
  if (!review.approved) {
    problems.push(
      `The visual review did not approve the video: ${review.findings}. Address these findings, rerender if needed, then inspect every frame and record approval in visual-review.json.`,
    );
  }
  return problems;
}

export async function renderInputs(
  directory: string,
  rawVideo: string,
): Promise<Readonly<Record<string, string>>> {
  return {
    "shots.json": await fileSha256(directory, "shots.json"),
    "claims.json": await fileSha256(directory, "claims.json"),
    "results.json": await fileSha256(directory, "results.json"),
    [rawVideo]: await fileSha256(directory, rawVideo),
  };
}

export async function writeDeliveryVerdict(directory: string): Promise<ReadonlyArray<string>> {
  const problems = await deliveryProblems(directory);
  await writeFile(
    join(directory, "delivery.json"),
    JSON.stringify(
      {
        status: problems.length === 0 ? "ready" : "not-ready",
        problems,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return problems;
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function fileSha256(directory: string, name: string): Promise<string> {
  const path = resolveArtifact(directory, name);
  return path === undefined ? "missing" : sha256(path);
}

export function resolveArtifact(directory: string, path: string): string | undefined {
  if (isAbsolute(path)) {
    return undefined;
  }
  try {
    const root = realpathSync(directory);
    const resolved = realpathSync(join(root, path));
    const inside = relative(root, resolved);
    return inside !== "" &&
      !inside.startsWith("..") &&
      !isAbsolute(inside) &&
      statSync(resolved).isFile()
      ? resolved
      : undefined;
  } catch {
    return undefined;
  }
}

export function artifactExists(directory: string, path: string): boolean {
  return resolveArtifact(directory, path) !== undefined;
}

function requiredReader(directory: string, problems: Array<string>): RequiredReader {
  return async (name, schema) => {
    const path = resolveArtifact(directory, name);
    if (path === undefined) {
      problems.push(
        `${name} is missing, so required evidence cannot be validated; produce it using the verify-app skill's run and review steps, then rerun bun run verify:review <run-dir>.`,
      );
      return undefined;
    }
    try {
      return Schema.decodeSync(schema)(await readFile(path, "utf8"));
    } catch (error) {
      problems.push(
        `${name} is invalid: ${error instanceof Error ? error.message : String(error)}. Regenerate runner-owned evidence or correct review-authored JSON to the verify-app skill's schema, then rerun bun run verify:review <run-dir>.`,
      );
      return undefined;
    }
  };
}

const Step = Schema.Struct({
  title: Schema.String,
  status: Schema.String,
  durationMs: Schema.Number,
  personas: Schema.optional(Schema.Array(Schema.String)),
  mcpExchanges: Schema.optional(Schema.Array(Schema.String)),
  serviceCalls: Schema.optional(Schema.Array(Schema.String)),
  hasCheckpoint: Schema.optional(Schema.Boolean),
  videoSeconds: Schema.optional(Schema.Struct({ start: Schema.Number, end: Schema.Number })),
});

const Attempt = Schema.Struct({
  title: Schema.String,
  status: Schema.String,
  expectedStatus: Schema.String,
  steps: Schema.Array(Step),
  attachments: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
});

const ResultsSchema = Schema.Struct({
  verdict: Schema.Literals(["passed", "failed", "blocked"]),
  attempts: Schema.Array(Attempt),
});

export const ResultsJson = Schema.fromJsonString(ResultsSchema);

const CriterionSchema = Schema.Struct({
  id: Schema.String,
  statement: Schema.String,
  status: Schema.Literals(["passed", "failed", "blocked", "not-tested"]),
  assertions: Schema.Array(
    Schema.Struct({ test: Schema.String, step: Schema.optional(Schema.String) }),
  ),
  artifacts: Schema.Array(Schema.String),
  observation: Schema.String,
});

const DeclaredCriteriaSchema = Schema.Struct({
  request: Schema.String,
  criteria: Schema.Array(Schema.Struct({ id: Schema.String, statement: Schema.String })),
});

export const DeclaredCriteriaJson = Schema.fromJsonString(DeclaredCriteriaSchema);

const ClaimsSchema = Schema.Struct({
  request: Schema.String,
  criteria: Schema.Array(CriterionSchema),
  limitations: Schema.Array(Schema.String),
  video: Schema.Literals(["requested", "not-requested"]),
});

export const ClaimsJson = Schema.fromJsonString(ClaimsSchema);

const ShotsSchema = Schema.Struct({
  rawVideo: Schema.String,
  scenes: Schema.Array(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
      title: Schema.String,
      text: Schema.String,
      claims: Schema.Array(Schema.String),
      artifacts: Schema.Array(Schema.String),
    }),
  ),
  notShown: Schema.optional(
    Schema.Array(Schema.Struct({ claim: Schema.String, reason: Schema.String })),
  ),
});

export const ShotsJson = Schema.fromJsonString(ShotsSchema);

const RunJson = Schema.fromJsonString(
  Schema.Struct({
    runId: Schema.String,
    criteriaDeclared: Schema.Boolean,
    criteriaSha256: Schema.optional(Schema.String),
  }),
);

const SourceCheckJson = Schema.fromJsonString(Schema.Struct({ changedDuringRun: Schema.Boolean }));

const CleanupJson = Schema.fromJsonString(Schema.Struct({ cleanupComplete: Schema.Boolean }));

const MediaCheckJson = Schema.fromJsonString(
  Schema.Struct({
    walkthroughSha256: Schema.String,
    fullDecode: Schema.Literal("passed"),
    inputs: Schema.Record(Schema.String, Schema.String),
    reviewFrames: Schema.Array(Schema.Struct({ name: Schema.String, sha256: Schema.String })),
  }),
);

const VisualReviewJson = Schema.fromJsonString(
  Schema.Struct({
    walkthroughSha256: Schema.String,
    reviewedFrames: Schema.Array(Schema.String),
    approved: Schema.Boolean,
    findings: Schema.String,
  }),
);

export function checkpointPersonaName(name: string): string {
  return `Checkpoint persona: ${name}`;
}

export function actingPersonas(
  attachments: ReadonlyArray<{ readonly name: string; readonly body?: Buffer }>,
): ReadonlyArray<string> {
  const names = attachments
    .filter(
      (attachment) =>
        isMcpExchangeAttachment(attachment) ||
        isServiceCallAttachment(attachment) ||
        attachment.name.startsWith("Checkpoint persona: "),
    )
    .map(
      (attachment) => Schema.decodeUnknownSync(PersonaJson)(attachment.body?.toString()).persona,
    );
  return [...new Set(names)];
}

const PersonaJson = Schema.fromJsonString(Schema.Struct({ persona: Schema.String }));

type RequiredReader = <A>(name: string, schema: Schema.Codec<A, string>) => Promise<A | undefined>;

export type Results = typeof ResultsSchema.Type;

type Criterion = typeof CriterionSchema.Type;

export type DeclaredCriteria = typeof DeclaredCriteriaSchema.Type;

export type Claims = typeof ClaimsSchema.Type;

export type Shots = typeof ShotsSchema.Type;
