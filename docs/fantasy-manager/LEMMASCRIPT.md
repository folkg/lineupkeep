# LemmaScript trial

LemmaScript adds `//@` contracts to TypeScript and checks them with Dafny. The TypeScript still builds and runs unchanged.

## Setup

- `lemmascript` 0.6.10 is a root dev dependency. `bun install` provides `lsc`.
- Dafny 4.11.0 is installed with Homebrew. Upgrade it with `brew upgrade dafny`.
- The agent skills are synced from `midspiral/lemmascript-skills` at the commit recorded in `tools/lemmascript/skills.lock`. Upgrade with `tools/lemmascript/sync-skills.sh`.
- `LemmaScript-files.txt` lists the files checked by `bun run lemma:check`.

## Trial on connection incidents

The smallest candidate was `ConnectionIncidentWorkflow`: `open` to `resolved`, with one event.

Three shipped functions are verified:

- `decideConnectionIncidentTransition`: a resolved incident rejects every event; an open incident accepts `Resolved`, preserves `openedAt`, and records the event time and resolution.
- `connectionIncidentStatus`: the persisted status equals the workflow state tag.
- `connectionIncidentProjection`: an open row has no resolution fields; a resolved row has both; the opening time is retained.

The workflow uses the verified decision function for its `Resolved` callback. The workflow object itself is skipped because XState configuration is not in the LemmaScript fragment. Database writes are also outside the proof.

`bun run lemma:check` reports 5 verified, 0 errors.

## Boundary found

Effect Schema declarations are skipped. `DateTime.Utc` is modelled with `//@ declare-type Utc { epochMilliseconds: number }`. This is enough to verify the transition and row-projection logic, but it does not prove the DateTime library or the database layer.

The next useful step would be a verified transition decision for a larger machine, such as lineup delivery, where attempts and retry behavior give more substantial arithmetic facts to prove.
