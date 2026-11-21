# LemmaScript

LemmaScript adds contracts to TypeScript and checks them with Dafny. The TypeScript still builds and runs unchanged.

## Installed versions

| Part          | Version                     | Upgrade                                                         |
| ------------- | --------------------------- | --------------------------------------------------------------- |
| `lemmascript` | 0.6.10                      | `bun add -d --exact lemmascript@<version>`                      |
| Dafny         | 4.11.0                      | `brew upgrade dafny`                                            |
| Agent skills  | `v0.6.10`, commit `f9d5433` | Edit `skills.lock`, then run `tools/lemmascript/sync-skills.sh` |

The tool is a root dev dependency, so `bun install` gives every checkout the same `lsc`.

## First setup

```sh
brew install dafny
bun install
tools/lemmascript/sync-skills.sh
```

`sync-skills.sh` replaces the `lemmascript*` directories under `.agents/skills` with the version pinned in `skills.lock`. It does not touch the project's own skills.

## Commands

```sh
bun run lemma:check
bun run lemma:gen
bun run lemma:regen
```

With no file argument, the commands read `LemmaScript-files.txt`. One file can be checked directly:

```sh
bunx lsc check --backend=dafny path/to/file.verify.ts
```

Use the Dafny backend explicitly. Use `regen` after editing the TypeScript, never delete the `.dfy` proof file.
