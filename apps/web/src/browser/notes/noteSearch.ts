import { createSignal, onSettled, type Accessor } from "solid-js";

import { scheduleDelay } from "#browser/timing/delay.ts";

import { normalizeNoteSearch } from "./noteInput.ts";
const NOTE_SEARCH_DEBOUNCE_MS = 250;

export function createNoteSearch(options: NoteSearchOptions): NoteSearch {
  const initialSearch = normalizeNoteSearch(options.initialSearch);
  const [draft, setDraftValue] = createSignal(options.initialSearch ?? "");
  const [isDebouncing, setIsDebouncing] = createSignal(false);
  let desiredSearch = initialSearch;
  let cancelDelay: (() => void) | undefined;

  const cancelDebounce = (): void => {
    cancelDelay?.();
    cancelDelay = undefined;
    setIsDebouncing(false);
  };

  const apply = (search: string | undefined): void => {
    if (search === desiredSearch) {
      return;
    }

    desiredSearch = search;
    options.onApply(search);
  };

  const setDraft = (value: string): void => {
    setDraftValue(value);
    cancelDebounce();

    const search = normalizeNoteSearch(value);
    if (search === undefined) {
      apply(undefined);
      return;
    }
    if (search === desiredSearch) {
      return;
    }

    setIsDebouncing(true);
    cancelDelay = scheduleDelay(() => {
      cancelDelay = undefined;
      setIsDebouncing(false);
      apply(search);
    }, options.debounceMs ?? NOTE_SEARCH_DEBOUNCE_MS);
  };

  const submit = (): void => {
    cancelDebounce();
    apply(normalizeNoteSearch(draft()));
  };

  const clear = (): void => {
    setDraftValue("");
    cancelDebounce();
    apply(undefined);
  };

  onSettled(() => () => cancelDelay?.());

  return { clear, draft, isDebouncing, setDraft, submit };
}

export type NoteSearch = {
  readonly clear: () => void;
  readonly draft: Accessor<string>;
  readonly isDebouncing: Accessor<boolean>;
  readonly setDraft: (value: string) => void;
  readonly submit: () => void;
};

type NoteSearchOptions = {
  readonly debounceMs?: number;
  readonly initialSearch: string | undefined;
  readonly onApply: (search: string | undefined) => void;
};
