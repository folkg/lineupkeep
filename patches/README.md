# Dependency patches

Bun applies these through `patchedDependencies` in `package.json` and `bun.lock`. No dependency version changes; each patch edits shipped dist files of the resolved version.

| Patch                                          | Why                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@better-auth%2Foauth-provider@1.7.12.patch`   | Retained cause-chain fix for concurrent CIMD registration.                                                                                  |
| `@tanstack%2Fsolid-start@2.0.0-rc.8.patch`     | Retained rc.8 action-URL names under the Solid rc.13 hold.                                                                                  |
| `@tanstack%2Frouter-core@1.171.22.patch`       | Temporary response-validation backport ([GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8)). |
| `@tanstack%2Fstart-client-core@1.170.22.patch` | Same backport.                                                                                                                              |
| `@tanstack%2Fstart-server-core@1.169.26.patch` | Same backport.                                                                                                                              |

The three `@tanstack` backport patches are temporary. [Release readiness](../docs/release-readiness.md#temporary-response-validation-backport-applied-2026-10-25) owns their record, evidence, residual risk, and removal condition. Remove them by deleting the three files and their `patchedDependencies` entries from `package.json` and `bun.lock`, then reinstalling and re-running the acceptance in that record.
