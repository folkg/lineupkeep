import { expect, it } from "vitest";

import { hasCheckpoint } from "#e2e/verify/capture.ts";

it("identifies checkpoint image and ARIA pairs rather than arbitrary PNG attachments", () => {
  const image = { name: "saved-note", contentType: "image/png" };
  const aria = { name: "saved-note-aria", contentType: "text/plain" };

  expect(hasCheckpoint([image])).toBe(false);
  expect(hasCheckpoint([image, { ...aria, name: "another-note-aria" }])).toBe(false);
  expect(hasCheckpoint([image, aria])).toBe(true);
  expect(hasCheckpoint([{ ...image, name: "saved-note (screen still changing)" }, aria])).toBe(
    true,
  );
});
