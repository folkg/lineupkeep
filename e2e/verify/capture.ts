import { writeFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";

import { pagePersona } from "#e2e/persona.ts";

import { checkpointPersonaName } from "./evidence.ts";
export async function captureCheckpoint(page: Page, info: TestInfo, name: string): Promise<void> {
  if (process.env["VERIFICATION_DIR"] === undefined) {
    return;
  }
  const screenshot = info.outputPath(`${name}.png`);
  const snapshot = info.outputPath(`${name}.aria.txt`);
  const { image, settled } = await stableScreenshot(page);
  await writeFile(screenshot, image);
  await writeFile(snapshot, await page.locator("body").ariaSnapshot());
  await info.attach(settled ? name : `${name} (screen still changing)`, {
    path: screenshot,
    contentType: "image/png",
  });
  await info.attach(`${name}-aria`, { path: snapshot, contentType: "text/plain" });
  await info.attach(checkpointPersonaName(name), {
    body: JSON.stringify({ persona: pagePersona(page) }),
    contentType: "application/json",
  });
  if (process.env["VERIFICATION_VIDEO"] === "true") {
    await page.waitForTimeout(readableHoldMs);
  }
}

export function hasCheckpoint(
  attachments: ReadonlyArray<{ readonly name: string; readonly contentType: string }>,
): boolean {
  return attachments.some(
    (image) =>
      image.contentType === "image/png" &&
      attachments.some(
        (snapshot) =>
          snapshot.name === `${image.name.replace(/ \(screen still changing\)$/u, "")}-aria` &&
          snapshot.contentType === "text/plain",
      ),
  );
}

async function stableScreenshot(
  page: Page,
): Promise<{ readonly image: Buffer; readonly settled: boolean }> {
  let previous = await page.screenshot({ animations: "disabled" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(150);
    const current = await page.screenshot({ animations: "disabled" });
    if (current.equals(previous)) {
      return { image: current, settled: true };
    }
    previous = current;
  }
  return { image: previous, settled: false };
}

const readableHoldMs = 2200;
