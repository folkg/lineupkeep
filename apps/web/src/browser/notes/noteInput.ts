import {
  noteTitleMaxLength,
  noteBodyMaxLength,
  noteSearchMaxLength,
} from "@lineupkeep/backend/notes/NoteLimits";
export function noteTitleError(value: string): string | undefined {
  const title = value.trim();
  return title.length === 0
    ? "Add a title."
    : title.length > noteTitleMaxLength
      ? `Use ${noteTitleMaxLength} characters or fewer for the title.`
      : undefined;
}

export function noteBodyError(value: string): string | undefined {
  return value.trim().length === 0
    ? "Add a note."
    : value.length > noteBodyMaxLength
      ? `Use ${noteBodyMaxLength} characters or fewer for the note.`
      : undefined;
}

const NOTE_SEARCH_MIN_LENGTH = 3;

export function parseNotesSearch(input: Record<string, unknown>): NotesRouteSearch {
  const search = normalizeNoteSearch(
    typeof input["search"] === "string" ? input["search"] : undefined,
  );
  const view = input["view"] === "trash" ? "trash" : undefined;
  return {
    ...(search === undefined ? {} : { search }),
    ...(view === undefined ? {} : { view }),
  };
}

export function normalizeNoteSearch(value: string | undefined): string | undefined {
  const normalized = (value?.trim() ?? "").slice(0, noteSearchMaxLength);
  return normalized.length >= NOTE_SEARCH_MIN_LENGTH ? normalized : undefined;
}

type NotesRouteSearch = {
  readonly search?: string;
  readonly view?: "trash";
};
