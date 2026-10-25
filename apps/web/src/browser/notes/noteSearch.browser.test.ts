import { createRoot, flush } from "solid-js";
import { expect, it, vi } from "vitest";

import { createNoteSearch } from "./noteSearch";

it("applies only the latest eligible draft after the debounce delay", () => {
  using fixture = setup();
  const { search, applied } = fixture;

  search.setDraft("mee");
  search.setDraft("meeting");
  vi.advanceTimersByTime(249);

  expect(applied).toEqual([]);

  vi.advanceTimersByTime(1);
  flush();

  expect(search.draft()).toBe("meeting");
  expect(applied).toEqual(["meeting"]);
});

it("cancels a pending search when the draft is cleared", () => {
  using fixture = setup();
  const { search, applied } = fixture;
  search.setDraft("meeting");

  search.clear();
  vi.runAllTimers();
  flush();

  expect(search.draft()).toBe("");
  expect(applied).toEqual([]);
});

it("clears an applied search immediately when the draft becomes too short", () => {
  using fixture = setup({ initialSearch: "meeting", fakeTimers: false });
  const { search, applied } = fixture;

  search.setDraft("me");
  flush();

  expect(search.draft()).toBe("me");
  expect(applied).toEqual([undefined]);
});

it("cancels a pending debounce when its owner is disposed", () => {
  using fixture = setup();
  const { search, applied, dispose } = fixture;
  search.setDraft("meeting");

  dispose();
  vi.runAllTimers();

  expect(applied).toEqual([]);
});

it("submits an eligible draft immediately", () => {
  using fixture = setup();
  const { search, applied } = fixture;
  search.setDraft("  project  ");
  flush();

  search.submit();

  expect(applied).toEqual(["project"]);

  vi.runAllTimers();

  expect(applied).toEqual(["project"]);
});

function setup(options: { initialSearch?: string; fakeTimers?: boolean } = {}): {
  dispose: () => void;
  search: import("./noteSearch").NoteSearch;
  applied: (string | undefined)[];
} & Disposable {
  using resources = new DisposableStack();
  if (options.fakeTimers !== false && !vi.isFakeTimers()) {
    resources.defer(() => vi.useRealTimers());
    vi.useFakeTimers();
  }
  const applied: Array<string | undefined> = [];
  const root = createRoot((dispose) => {
    resources.defer(dispose);
    return {
      dispose,
      search: createNoteSearch({
        initialSearch: options.initialSearch,
        onApply: (value) => applied.push(value),
      }),
    };
  });
  flush();
  const owned = resources.move();
  return { ...root, applied, [Symbol.dispose]: () => owned.dispose() };
}
