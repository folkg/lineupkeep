#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { chromium } from "@playwright/test";
import { Schema } from "effect";

import {
  artifactExists,
  ClaimsJson,
  ResultsJson,
  renderInputs,
  sceneAlignmentProblems,
  sha256,
  ShotsJson,
} from "./evidence.ts";
import type { Shots } from "./evidence.ts";

export function videoDirection(
  direction: Shots,
  duration: number,
  criteria: ReadonlyArray<string>,
  artifactExists: (path: string) => boolean,
): Shots {
  if (direction.scenes.length === 0) {
    throw new Error("Video direction needs at least one scene.");
  }
  let previousEnd = 0;
  for (const scene of direction.scenes) {
    if (
      !Number.isFinite(scene.start) ||
      !Number.isFinite(scene.end) ||
      scene.start < previousEnd ||
      scene.end <= scene.start ||
      scene.end > duration
    ) {
      throw new Error("Scene timing must fit the raw video and remain ordered without overlaps.");
    }
    if ([scene.title, scene.text].some((value) => value.trim() === "")) {
      throw new Error("Each scene needs a title and directing text.");
    }
    if (scene.claims.length + scene.artifacts.length === 0) {
      throw new Error(`Scene "${scene.title}" must cite a criterion or an artifact.`);
    }
    for (const claim of scene.claims) {
      if (!criteria.includes(claim)) {
        throw new Error(
          `Scene "${scene.title}" cites ${claim}, which claims.json does not define.`,
        );
      }
    }
    for (const artifact of scene.artifacts) {
      if (!artifactExists(artifact)) {
        throw new Error(`Scene "${scene.title}" cites ${artifact}, which is not in this run.`);
      }
    }
    previousEnd = scene.end;
  }
  return direction;
}

async function renderVideo(directory: string): Promise<void> {
  const root = await realpath(directory);
  const direction = Schema.decodeSync(ShotsJson)(await readFile(join(root, "shots.json"), "utf8"));
  const results = Schema.decodeSync(ResultsJson)(
    await readFile(join(root, "results.json"), "utf8"),
  );
  const claims = Schema.decodeSync(ClaimsJson)(await readFile(join(root, "claims.json"), "utf8"));
  const status = new Map(claims.criteria.map((criterion) => [criterion.id, criterion.status]));

  await rm(join(root, "media-check.json"), { force: true });
  const inputs = await renderInputs(root, direction.rawVideo);
  const rawVideo = await realpath(resolve(root, direction.rawVideo));
  const rawRelative = relative(root, rawVideo);
  if (rawRelative === ".." || rawRelative.startsWith(`..${sep}`) || isAbsolute(rawRelative)) {
    throw new Error("Raw video must belong to this evidence directory.");
  }
  const media = probe(rawVideo);
  videoDirection(direction, media.duration, [...status.keys()], (path) =>
    artifactExists(root, path),
  );
  const misaligned = sceneAlignmentProblems(direction, claims, results);
  if (misaligned.length > 0) {
    throw new Error(`Scenes do not match the recorded steps:\n- ${misaligned.join("\n- ")}`);
  }
  const cards = join(root, "direction");
  await mkdir(cards, { recursive: true });
  const paths: Array<string> = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: media.width, height: 120 } });
    await page.setContent(`<html><body style="margin:0;padding:14px 24px;box-sizing:border-box;height:120px;background:#111;color:white;font-family:Arial,sans-serif;display:grid;align-content:center;gap:6px">
      <h1 style="margin:0;font-size:20px;line-height:24px;color:#ddd"></h1>
      <p style="margin:0;font-size:24px;line-height:28px"></p>
    </body></html>`);
    for (const [index, scene] of direction.scenes.entries()) {
      await page.getByRole("heading").evaluate(
        (element, text) => {
          element.textContent = text;
        },
        `${scene.title} · ${sceneStatus(scene.claims, status, results.verdict)}`,
      );
      await page.locator("p").evaluate((element, text) => {
        element.textContent = text;
      }, scene.text);
      if ((await page.evaluate(() => document.documentElement.scrollHeight)) > 120) {
        throw new Error(
          `Scene ${index + 1} annotation does not fit; shorten it or use a wider viewport.`,
        );
      }
      const path = join(cards, `scene-${index + 1}.png`);
      await page.screenshot({ path });
      paths.push(path);
    }
  } finally {
    await browser.close();
  }

  const filters = ["[0:v]pad=iw:ih+120:0:0:color=black[base]"];
  for (const [index, scene] of direction.scenes.entries()) {
    const previous = index === 0 ? "base" : `scene${index}`;
    filters.push(
      `[${previous}][${index + 1}:v]overlay=0:H-h:enable='gte(t,${scene.start})*lt(t,${scene.end})'[scene${index + 1}]`,
    );
  }
  const output = join(root, "walkthrough.mp4");
  await ffmpeg(root, "media-render.log", [
    "-y",
    "-i",
    rawVideo,
    ...paths.flatMap((path) => ["-loop", "1", "-i", path]),
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[scene${paths.length}]`,
    "-t",
    String(media.duration),
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ]);
  await ffmpeg(root, "decode.log", ["-v", "error", "-i", output, "-f", "null", "-"]);
  const frames = await Promise.all(
    (await extractReviewFrames(root, output, direction)).map(async (name) => ({
      name,
      sha256: await sha256(join(root, "review-frames", name)),
    })),
  );
  await writeFile(
    join(root, "media-check.json"),
    JSON.stringify(
      {
        raw: media,
        rendered: probe(output),
        testVerdict: results.verdict,
        walkthroughSha256: await sha256(output),
        fullDecode: "passed",
        inputs,
        reviewFrames: frames,
        note: "Rendering is not proof. Inspect every review frame and record the review in visual-review.json; the delivery gate (delivery.json) decides whether the video is ready.",
      },
      null,
      2,
    ),
  );
  console.log(
    `Annotated video: ${output}\nFull decode passed. Inspect review-frames/, write visual-review.json, then run verify:review.`,
  );
}

function sceneStatus(
  claims: ReadonlyArray<string>,
  status: ReadonlyMap<string, string>,
  verdict: string,
): string {
  return claims.length === 0
    ? `TEST RUN: ${verdict.toUpperCase()}`
    : claims.map((claim) => `${claim} ${String(status.get(claim)).toUpperCase()}`).join(" · ");
}

async function extractReviewFrames(
  root: string,
  video: string,
  direction: Shots,
): Promise<ReadonlyArray<string>> {
  const folder = join(root, "review-frames");
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder);
  const frames: Array<string> = [];
  for (const [index, scene] of direction.scenes.entries()) {
    const inset = Math.min(0.1, (scene.end - scene.start) / 4);
    const moments = {
      start: scene.start + inset,
      middle: (scene.start + scene.end) / 2,
      end: scene.end - inset,
    };
    for (const [label, time] of Object.entries(moments)) {
      const name = `scene-${String(index + 1).padStart(2, "0")}-${label}.png`;
      await ffmpeg(root, "review-frames.log", [
        "-y",
        "-v",
        "error",
        "-ss",
        time.toFixed(3),
        "-i",
        video,
        "-frames:v",
        "1",
        join(folder, name),
      ]);
      frames.push(name);
    }
  }
  return frames;
}

function probe(path: string): { width: number; height: number; duration: number } {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr}`);
  }
  const metadata = Schema.decodeSync(Media)(result.stdout);
  const stream = metadata.streams[0];
  const duration = Number(metadata.format.duration);
  if (stream === undefined || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Video needs a video stream and finite positive duration.");
  }
  return { width: stream.width, height: stream.height, duration };
}

async function ffmpeg(
  directory: string,
  log: string,
  arguments_: ReadonlyArray<string>,
): Promise<void> {
  const result = spawnSync("ffmpeg", arguments_, { encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  await writeFile(join(directory, log), result.stderr);
  if (result.status !== 0) {
    throw new Error(`FFmpeg failed; see ${join(directory, log)}.`);
  }
}

const Media = Schema.fromJsonString(
  Schema.Struct({
    streams: Schema.Array(Schema.Struct({ width: Schema.Int, height: Schema.Int })),
    format: Schema.Struct({ duration: Schema.String }),
  }),
);

if (import.meta.main) {
  const directory = process.argv[2];
  if (directory === undefined) {
    throw new Error("Usage: bun run verify:video <printed-run-directory>");
  }
  await renderVideo(directory);
}
