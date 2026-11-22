# Dependency patches

Bun applies these through `patchedDependencies` in `package.json` and `bun.lock`. No dependency version changes; each patch edits shipped dist files of the resolved version.

| Patch                                          | Why                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@better-auth%2Fcimd@1.7.27.patch`             | Names a policy-refused client-metadata redirect separately from a network failure, and says redirects are not followed.                                        |
| `@tanstack%2Fstart-server-core@1.169.45.patch` | Adds the `./request-scope` export that Solid Start rc.11 imports; 1.169.45 omits it ([TanStack/router #8964](https://github.com/TanStack/router/issues/8964)). |

The TanStack patch is temporary packaging repair, not a transport or security change. [Release readiness](../docs/release-readiness.md#publication-blocker-solid-start-rpc-security-fixed-upstream) owns its removal condition. Remove it by deleting the patch file and its `patchedDependencies` entry from `package.json` and `bun.lock`, then reinstalling and running the build.
