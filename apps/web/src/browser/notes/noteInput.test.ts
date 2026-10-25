import { expect, it } from "vitest";

import { noteTitleError, noteBodyError, parseNotesSearch } from "./noteInput.ts";
it("explains missing and oversized input using one client policy", () => {
  expect(noteTitleError(" ")).toBe("Add a title.");
  expect(noteBodyError("\n")).toBe("Add a note.");
  expect(noteTitleError("a".repeat(201))).toBe("Use 200 characters or fewer for the title.");
  expect(noteBodyError("a".repeat(10_001))).toBe("Use 10000 characters or fewer for the note.");
});

it("accepts boundary values and measures the trimmed title but unmodified body", () => {
  expect(noteTitleError("  " + "a".repeat(200) + "  ")).toBeUndefined();
  expect(noteBodyError("a".repeat(10_000))).toBeUndefined();
  expect(noteBodyError("a".repeat(10_000) + " ")).toBeDefined();
});

it("normalizes route search and bounds queries without loading a schema", () => {
  expect(parseNotesSearch({ search: 42, view: "unknown" })).toEqual({});
  expect(parseNotesSearch({ search: " ab ", view: "trash" })).toEqual({ view: "trash" });
  expect(parseNotesSearch({ search: " meeting ", view: "trash" })).toEqual({
    search: "meeting",
    view: "trash",
  });
  expect(parseNotesSearch({ search: "a".repeat(201) })).toEqual({ search: "a".repeat(200) });
});
