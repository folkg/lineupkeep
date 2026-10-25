import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import { hasCheckpoint } from "./capture.ts";
import { actingPersonas } from "./evidence.ts";
import { isMcpExchangeAttachment } from "./mcpEvidence.ts";
import { isServiceCallAttachment } from "./serviceEvidence.ts";
export default class VerificationReporter implements Reporter {
  constructor(options: { readonly directory: string }) {
    this.directory = options.directory;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.planned = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.attempts.push({
      title: test.title,
      source: `${relative(process.cwd(), test.location.file)}:${test.location.line}`,
      status: result.status,
      expectedStatus: test.expectedStatus,
      retry: result.retry,
      errors: result.errors,
      steps: reviewSteps(
        result.steps,
        result.startTime,
        recordingVideo ? videoStart(result) : undefined,
      ),
      attachments: result.attachments.flatMap((attachment) => {
        if (attachment.path !== undefined) {
          return [{ name: attachment.name, path: relative(this.directory, attachment.path) }];
        }
        if (attachment.body === undefined) {
          return [];
        }
        const path = join(
          "test-results",
          "body-attachments",
          `${this.bodies.length + 1}-${slug(attachment.name)}${extension(attachment.contentType)}`,
        );
        this.bodies.push({ path, body: attachment.body });
        return [{ name: attachment.name, path }];
      }),
    });
  }

  onError(error: TestError): void {
    this.errors.push(error);
  }

  async onEnd(result: FullResult): Promise<{ status: "failed" } | void> {
    if (this.bodies.length > 0) {
      await mkdir(join(this.directory, "test-results", "body-attachments"), { recursive: true });
    }
    for (const { path, body } of this.bodies) {
      await writeFile(join(this.directory, path), body);
    }
    const verdict = verificationVerdict(
      this.errors.length === 0 ? result.status : "failed",
      this.planned,
      this.attempts,
    );
    await writeFile(
      join(this.directory, "results.json"),
      JSON.stringify(
        { verdict, planned: this.planned, attempts: this.attempts, errors: this.errors },
        null,
        2,
      ),
    );
    await writeFile(
      join(this.directory, "summary.md"),
      [
        "# Application verification run",
        "",
        `Automated assertions: **${verdict}**. Selected tests: ${this.planned}.`,
        "",
        "This is scoped test evidence, not a claim that every feature or deployment is verified.",
        recordingVideo
          ? "Raw videos are unreviewed capture. Steps carry `videoSeconds`, an estimate of their position in the test's page video; it is absent when unknown, and a test with several page videos has no known positions. Confirm every caption against the extracted review frames."
          : "No video was recorded.",
        "",
        "Next: write claims.json citing the test and step titles below (or a whole test), then run `bun run verify:review` on this directory. See run.json for source and environment, doctor.json for readiness, results.json for steps and errors, and report/index.html for traces.",
        "",
        ...this.attempts.flatMap((attempt) => [
          `## ${attempt.status}: ${attempt.title}`,
          "",
          `Source: ${attempt.source}`,
          "",
          "Steps:",
          ...attempt.steps.flatMap((step) => [
            `- ${step.status}: ${step.title}`,
            ...(step.personas.length === 0
              ? []
              : [`  - Acting personas: ${step.personas.join(", ")}`]),
            ...[...step.mcpExchanges, ...step.serviceCalls].map((name) => {
              const path = attempt.attachments.find((attachment) => attachment.name === name)?.path;
              return `  - ${name}: [transcript](${path})`;
            }),
          ]),
          "",
          "Attachments (cite these exact paths):",
          ...attempt.attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`),
          "",
        ]),
      ].join("\n"),
    );
    if (verdict !== "passed") {
      return { status: "failed" };
    }
  }

  printsToStdio(): boolean {
    return false;
  }

  private readonly directory: string;
  private planned = 0;
  private readonly bodies: Array<{ readonly path: string; readonly body: Buffer }> = [];
  private readonly attempts: Array<Attempt> = [];
  private readonly errors: Array<TestError> = [];
}

function reviewSteps(
  steps: ReadonlyArray<TestStep>,
  start: Date,
  video: number | undefined,
): Array<ReviewStep> {
  return steps.flatMap((step) => [
    ...(step.category === "test.step"
      ? [
          {
            title: step.title,
            personas: actingPersonas(allSteps([step]).flatMap((entry) => entry.attachments)),
            mcpExchanges: allSteps([step]).flatMap((entry) =>
              entry.attachments
                .filter(isMcpExchangeAttachment)
                .map((attachment) => attachment.name),
            ),
            serviceCalls: allSteps([step]).flatMap((entry) =>
              entry.attachments
                .filter(isServiceCallAttachment)
                .map((attachment) => attachment.name),
            ),
            hasCheckpoint: hasCheckpoint(allSteps([step]).flatMap((entry) => entry.attachments)),
            testElapsedMs: step.startTime.getTime() - start.getTime(),
            durationMs: step.duration,
            videoSeconds:
              video === undefined
                ? undefined
                : {
                    start: hundredths((step.startTime.getTime() - video) / 1000),
                    end: hundredths((step.startTime.getTime() + step.duration - video) / 1000),
                  },
            status: step.error === undefined ? "completed" : "failed",
          },
        ]
      : []),
    ...reviewSteps(step.steps, start, video),
  ]);
}

function videoStart(result: TestResult): number | undefined {
  const starts = allSteps(result.steps)
    .filter((step) => step.category === "fixture" && step.title === 'Fixture "page"')
    .map((step) => step.startTime.getTime());
  return starts.length === 0 ? undefined : Math.min(...starts);
}

function allSteps(steps: ReadonlyArray<TestStep>): ReadonlyArray<TestStep> {
  return steps.flatMap((step) => [step, ...allSteps(step.steps)]);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function extension(contentType: string): string {
  const known: Readonly<Record<string, string>> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/json": ".json",
    "text/plain": ".txt",
    "text/markdown": ".md",
  };
  return known[contentType] ?? ".bin";
}

const recordingVideo = process.env["VERIFICATION_VIDEO"] === "true";

function hundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

export function verificationVerdict(
  runnerStatus: string,
  planned: number,
  attempts: ReadonlyArray<VerificationAttempt>,
): "passed" | "failed" | "blocked" {
  if (attempts.length === 0) {
    return "blocked";
  }
  if (
    runnerStatus === "failed" ||
    runnerStatus === "timedout" ||
    attempts.some((attempt) => attempt.status === "failed" || attempt.status === "timedOut")
  ) {
    return "failed";
  }
  if (
    runnerStatus !== "passed" ||
    planned === 0 ||
    attempts.length !== planned ||
    attempts.some((attempt) => attempt.status !== "passed" || attempt.expectedStatus !== "passed")
  ) {
    return "blocked";
  }
  return "passed";
}

type Attempt = {
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly expectedStatus: string;
  readonly retry: number;
  readonly errors: ReadonlyArray<TestError>;
  readonly steps: ReadonlyArray<ReviewStep>;
  readonly attachments: ReadonlyArray<{ readonly name: string; readonly path: string }>;
};

type ReviewStep = {
  readonly title: string;
  readonly personas: ReadonlyArray<string>;
  readonly mcpExchanges: ReadonlyArray<string>;
  readonly serviceCalls: ReadonlyArray<string>;
  readonly hasCheckpoint: boolean;
  readonly testElapsedMs: number;
  readonly durationMs: number;
  readonly videoSeconds: { readonly start: number; readonly end: number } | undefined;
  readonly status: string;
};

type VerificationAttempt = {
  readonly status: string;
  readonly expectedStatus: string;
};
