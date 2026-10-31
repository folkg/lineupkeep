#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

const run = promisify(execFile);
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true };

const [label, ...rest] = process.argv.slice(2);
const origin = rest[0];
const revision = rest[1];
const service = rest[2];
const routes = rest.slice(3);
if (
  label === undefined ||
  origin === undefined ||
  revision === undefined ||
  service === undefined ||
  routes.length === 0
) {
  throw new Error(
    "Usage: node scripts/coldStart.ts <label> <origin> <revision> <cloud-run-service> <route...>",
  );
}
const idleMinutes = readIdleMinutes(process.env["COLD_START_IDLE_MINUTES"]);
const output = join(
  ".artifacts/cold-start",
  `${new Date().toISOString().replaceAll(":", "-")}-${label}`,
);
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const samples: Sample[] = [];
try {
  for (const route of routes) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await waitForScaleToZero(idleMinutes);
      let sample: Measurement;
      try {
        sample = await measure(route);
      } catch (error) {
        console.log(`Discarding a failed ${route} sample: ${String(error)}`);
        continue;
      }
      let timeline: InstanceTimeline | undefined;
      for (let look = 0; look < 6; look += 1) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        const found = await instanceTimeline(sample.startedAt);
        if (found !== undefined && found.listenToReadyMs !== null) {
          timeline = found;
          break;
        }
        timeline = timeline ?? found;
      }
      if (timeline === undefined) {
        console.log(`Discarding a warm ${route} sample; no instance started for it.`);
        continue;
      }
      const cold: Sample = { ...sample, ...timeline };
      samples.push(cold);
      console.log(JSON.stringify(cold));
      break;
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  join(output, "samples.json"),
  `${JSON.stringify({ label, origin, revision, samples }, null, 2)}\n`,
);
console.log(`Recorded ${samples.length} cold samples in ${output}`);

async function measure(route: string): Promise<Measurement> {
  const context = await browser.newContext({ ...phone, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.addInitScript(largestContentfulPaintProbe);
  const frames: BrowserFrame[] = [];
  const startedAt = Date.now();
  const session = await context.newCDPSession(page);
  await session.send("Page.enable");
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  session.on("Page.screencastFrame", (frame) => {
    frames.push({ at: Date.now() - startedAt, data: frame.data });
    void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  let ttfbMs: number | null = null;
  page.on("response", (response) => {
    if (response.request().isNavigationRequest() && ttfbMs === null) {
      ttfbMs = Date.now() - startedAt;
    }
  });
  try {
    const navigation = page.goto(new URL(route, origin).href, {
      waitUntil: "load",
      timeout: 180_000,
    });
    await saveFrameAt(frames, startedAt, 200, `${routeName(route)}-at-200ms`);
    await saveFrameAt(frames, startedAt, 1_000, `${routeName(route)}-at-1s`);
    const response = await navigation;
    if (response === null) {
      throw new Error(`${route} produced no response`);
    }
    const timings = await page.evaluate(readTimings);
    await page.screenshot({
      path: join(output, `${routeName(route)}-ready.png`),
      fullPage: true,
    });
    await saveFrameAt(
      frames,
      startedAt,
      Number.POSITIVE_INFINITY,
      `${routeName(route)}-ready-frame`,
    );
    return {
      route,
      status: response.status(),
      url: page.url(),
      startedAt,
      ttfbMs,
      ...timings,
      frameTimes: frames.map(({ at }) => at),
    };
  } finally {
    await session.send("Page.stopScreencast").catch(() => undefined);
    await context.close();
  }
}

async function saveFrameAt(
  frames: BrowserFrame[],
  startedAt: number,
  at: number,
  name: string,
): Promise<void> {
  if (at !== Number.POSITIVE_INFINITY) {
    const remaining = at - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
  const frame =
    frames.findLast((candidate) => at === Number.POSITIVE_INFINITY || candidate.at <= at) ??
    frames[0];
  if (frame === undefined) {
    return;
  }
  await writeFile(
    join(output, `${name} (last frame ${Math.max(frame.at, 0)}ms).png`),
    Buffer.from(frame.data, "base64"),
  );
}

async function waitForScaleToZero(idleMinutes: number): Promise<void> {
  const idle = idleMinutes * 60_000;
  for (;;) {
    const lastRequest = await lastServiceRequestAt();
    const idleFor = lastRequest === undefined ? Number.POSITIVE_INFINITY : Date.now() - lastRequest;
    if (idleFor >= idle) {
      return;
    }
    console.log(
      `Waiting for the service to scale to zero (idle ${
        lastRequest === undefined ? "unknown" : `${Math.round(idleFor / 60_000)}m`
      } of ${idleMinutes}m)…`,
    );
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

async function lastServiceRequestAt(): Promise<number | undefined> {
  const { stdout } = await run("gcloud", [
    "logging",
    "read",
    `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND logName:"run.googleapis.com%2Frequests"`,
    "--project=lineupkeep-prod",
    "--limit=1",
    "--format=value(timestamp)",
    "--freshness=6h",
  ]);
  const timestamp = stdout.trim();
  return timestamp === "" ? undefined : new Date(timestamp).getTime();
}

async function instanceTimeline(startedAt: number): Promise<InstanceTimeline | undefined> {
  const entries = await lifecycleEntries();
  const start = entries
    .filter((entry) => entry.kind === "start" && Math.abs(entry.at - startedAt) < 60_000)
    .at(0);
  if (start === undefined) {
    return undefined;
  }
  const instance = entries.filter(
    (entry) => entry.instance === start.instance && entry.at >= start.at,
  );
  const listen = instance.find((entry) => entry.kind === "listen");
  const ready = instance.find((entry) => entry.kind === "ready");
  const render = instance.find((entry) => entry.kind === "render");
  return {
    instance: start.instance,
    startToListenMs: listen === undefined ? null : listen.at - start.at,
    listenToReadyMs: listen === undefined || ready === undefined ? null : ready.at - listen.at,
    coldRenderMs: render?.durationMs ?? null,
  };
}

async function lifecycleEntries(): Promise<ReadonlyArray<LifecycleEntry>> {
  const { stdout } = await run("gcloud", [
    "logging",
    "read",
    `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND (textPayload:"Starting new instance" OR textPayload:"Listening on" OR textPayload:"STARTUP HTTP probe succeeded" OR jsonPayload.message:"GET / ok")`,
    "--project=lineupkeep-prod",
    "--limit=400",
    "--format=json",
    "--freshness=1h",
  ]);
  const parsed: unknown = JSON.parse(stdout === "" ? "[]" : stdout);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap(readLifecycleEntry);
}

function readLifecycleEntry(value: unknown): LifecycleEntry[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const labels: unknown = Reflect.get(value, "labels");
  const instanceId: unknown =
    typeof labels === "object" && labels !== null ? Reflect.get(labels, "instanceId") : undefined;
  const timestamp: unknown = Reflect.get(value, "timestamp");
  const text: unknown = Reflect.get(value, "textPayload");
  const payload: unknown = Reflect.get(value, "jsonPayload");
  const message: unknown =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, "message") : undefined;
  if (typeof instanceId !== "string" || typeof timestamp !== "string") {
    return [];
  }
  const at = new Date(timestamp).getTime();
  if (typeof text === "string" && text.includes("Starting new instance")) {
    return [{ kind: "start", instance: instanceId, at, durationMs: null }];
  }
  if (typeof text === "string" && text.includes("Listening on")) {
    return [{ kind: "listen", instance: instanceId, at, durationMs: null }];
  }
  if (typeof text === "string" && text.includes("STARTUP HTTP probe succeeded")) {
    return [{ kind: "ready", instance: instanceId, at, durationMs: null }];
  }
  if (typeof message === "string" && message.startsWith("GET / ok")) {
    const duration = /ok (\d+(?:\.\d+)?)ms/u.exec(message)?.[1];
    return [
      {
        kind: "render",
        instance: instanceId,
        at,
        durationMs: duration === undefined ? null : Number(duration),
      },
    ];
  }
  return [];
}

function readTimings(): Timings {
  const round = (value: number): number => Math.round(value * 10) / 10;
  const navigation = performance
    .getEntriesByType("navigation")
    .find((entry): entry is PerformanceNavigationTiming => entry.entryType === "navigation");
  if (navigation === undefined) {
    throw new Error("The document has no navigation timing entry");
  }
  const paints = performance.getEntriesByType("paint");
  const paint = (name: string): number | null => {
    const entry = paints.find((candidate) => candidate.name === name);
    return entry === undefined ? null : round(entry.startTime);
  };
  const largestContentfulPaint: unknown = Reflect.get(globalThis, "__lcp");
  return {
    firstPaintMs: paint("first-paint"),
    firstContentfulPaintMs: paint("first-contentful-paint"),
    largestContentfulPaintMs:
      typeof largestContentfulPaint === "number" ? round(largestContentfulPaint) : null,
    domContentLoadedMs: round(navigation.domContentLoadedEventEnd),
    loadMs: round(navigation.loadEventEnd),
    htmlBytes: navigation.decodedBodySize,
  };
}

function largestContentfulPaintProbe(): void {
  let latest = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      latest = entry.startTime;
    }
    Reflect.set(globalThis, "__lcp", latest);
  }).observe({ type: "largest-contentful-paint", buffered: true });
}

function readIdleMinutes(value: string | undefined): number {
  if (value === undefined) {
    return 16;
  }
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 16) {
    throw new Error("COLD_START_IDLE_MINUTES must be at least 16");
  }
  return minutes;
}

function routeName(route: string): string {
  return route === "/" ? "landing" : route.replace(/^\//u, "").replaceAll(/[^a-z0-9]+/giu, "-");
}

type BrowserFrame = {
  readonly at: number;
  readonly data: string;
};

type Measurement = {
  readonly route: string;
  readonly status: number;
  readonly url: string;
  readonly startedAt: number;
  readonly ttfbMs: number | null;
  readonly frameTimes: ReadonlyArray<number>;
} & Timings;

type Sample = Measurement & InstanceTimeline;

type InstanceTimeline = {
  readonly instance: string;
  readonly startToListenMs: number | null;
  readonly listenToReadyMs: number | null;
  readonly coldRenderMs: number | null;
};

type LifecycleEntry = {
  readonly kind: "start" | "listen" | "ready" | "render";
  readonly instance: string;
  readonly at: number;
  readonly durationMs: number | null;
};

type Timings = {
  readonly firstPaintMs: number | null;
  readonly firstContentfulPaintMs: number | null;
  readonly largestContentfulPaintMs: number | null;
  readonly domContentLoadedMs: number;
  readonly loadMs: number;
  readonly htmlBytes: number;
};
