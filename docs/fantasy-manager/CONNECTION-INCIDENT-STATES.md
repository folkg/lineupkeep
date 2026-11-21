# Connection incident states

The incident row persists the workflow projection in `status`, `openedAt`, `resolvedAt`, and `resolution`; it has no separate state column. Operation and provider evidence remain attached to the incident.

| State / row status | Entered by                                                                    | Exit                                        | Terminal |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- | -------- |
| `open`             | Insert when provider access requires reconnection                             | `Resolved` on reconnection or disconnection | No       |
| `resolved`         | `Resolved`, recording its time and `reconnected` or `disconnected` resolution | None; all events are rejected               | Yes      |

An already resolved incident stays unchanged on repeated resolution. Only pending notifications belonging to newly resolved incidents are cancelled through the notification workflow.
