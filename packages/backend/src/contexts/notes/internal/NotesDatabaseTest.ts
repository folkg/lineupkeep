import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { Layer } from "effect";

import { DatabaseTest } from "#database/internal/DatabaseTest.ts";

import { NotesDatabase } from "./NotesDatabase.ts";
import { notesRelations } from "./NotesDatabase.ts";

export const NotesDatabaseTest = Layer.effect(
  NotesDatabase,
  PgliteDrizzle.makeWithDefaults({ relations: notesRelations }),
).pipe(Layer.provide(DatabaseTest));
