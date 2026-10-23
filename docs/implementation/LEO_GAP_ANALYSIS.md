# LEO Gap Analysis

## Findings

| Component                       | Status               | Description                                                                                           |
| ------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| LEO Policy Engine               | NEEDS IMPLEMENTATION | Centralized API for `evaluatePolicy(request): PolicyDecision` does not exist in OwnPilot.             |
| OwnPilot Agent Engine           | EXISTS / ADAPT       | Adapt into `packages/agent`. Core intent/planner/orchestration logic to be extended.                  |
| OwnPilot SSRF protection        | EXISTS / EXTEND      | Gateway network layer has SSRF guards, but needs a centralized `NetworkPolicy`.                       |
| LEO Social Provider abstraction | NEEDS IMPLEMENTATION | No existing abstraction for social scheduling/publishing.                                             |
| LEO Action Ledger               | ADAPT / EXTEND       | Extend OwnPilot's tamper-evident audit to cover comprehensive LEO actions.                            |
| Qwen Computer Provider          | NEEDS IMPLEMENTATION | Needs implementation under `packages/computer/local/qwen`.                                            |
| E2B Computer Provider           | NEEDS IMPLEMENTATION | Needs implementation under `packages/computer/cloud/e2b`.                                             |
| Task System & Workers           | NEEDS IMPLEMENTATION | OwnPilot executes directly. Needs a durable Task worker/queue system.                                 |
| Workflow System                 | NEEDS IMPLEMENTATION | Needs durable `packages/workflows` with conditional/multi-step support.                               |
| Browser Playwright Provider     | NEEDS IMPLEMENTATION | Needs dedicated isolated browser provider in `packages/browser`.                                      |
| OpenAI Realtime Voice Provider  | NEEDS IMPLEMENTATION | Needs implementation under `packages/voice/provider`.                                                 |
| Redis Queue Infrastructure      | NEEDS IMPLEMENTATION | Currently no Redis used in OwnPilot docker-compose baseline.                                          |
| Approval Engine                 | NEEDS IMPLEMENTATION | Needs formal `packages/approvals` for risk-based authorization flows.                                 |
| Object Storage                  | NEEDS IMPLEMENTATION | LEO needs an explicit Object Storage abstraction.                                                     |
| Identity & Credentials          | KEEP / HARDEN        | OwnPilot has auth & encrypted credential storage, but passwordless local execution needs restriction. |
