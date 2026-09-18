# OwnPilot to LEO Mapping

| Existing Component | Location                                                                          | LEO Usage           | Action      |
| ------------------ | --------------------------------------------------------------------------------- | ------------------- | ----------- |
| Agent Engine       | `packages/core/src/agentic`                                                       | Agent foundation    | KEEP/ADAPT  |
| Tool Registry      | `packages/gateway/src/tools` & `packages/core/src/agentic/capability-registry.ts` | Tool system         | KEEP/ADAPT  |
| MCP                | `packages/gateway/src/mcp`                                                        | Integration layer   | KEEP/ADAPT  |
| Memory             | `packages/core/src/memory`                                                        | LEO memory          | KEEP/ADAPT  |
| Scheduler          | `packages/gateway/src/scheduler`                                                  | Workflow scheduling | KEEP/ADAPT  |
| Sandbox            | `packages/core/src/sandbox`                                                       | Secure execution    | KEEP/ADAPT  |
| Audit              | `packages/core/src/audit` & `packages/gateway/src/middleware/audit.ts`            | Action Ledger       | KEEP/ADAPT  |
| Auth               | `packages/gateway/src/middleware/auth.ts`                                         | Identity foundation | KEEP/HARDEN |
| Plugins            | `packages/core/src/plugins` & `packages/gateway/src/plugins`                      | Extension system    | KEEP/HARDEN |
