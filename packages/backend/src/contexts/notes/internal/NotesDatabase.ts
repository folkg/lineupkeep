import { defineRelations } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect/db";
import { Context, Layer } from "effect";

import { notes } from "./NotesTables.ts";

export const notesRelations = defineRelations({ notes });

export class NotesDatabase extends Context.Service<
  NotesDatabase,
  PgEffectDatabase<EffectPgQueryEffectHKT, PgQueryResultHKT, typeof notesRelations>
>()("@sourdough/backend/contexts/notes/internal/NotesDatabase") {
  static readonly layer = Layer.effect(
    this,
    PgDrizzle.makeWithDefaults({ relations: notesRelations }),
  );
}
