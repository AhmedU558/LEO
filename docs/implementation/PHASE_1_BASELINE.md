# LEO Phase 1 Baseline

## Overview
Phase 1 establishes the LEO security and identity boundary on top of the OwnPilot foundation. Before proceeding with any agent features, the core invariants for authorization must be integrated.

## Core Architectural Principle
```text
LLM
 ↓
Tool Request
 ↓
Capability Check
 ↓
LEO Policy Engine
 ↓
Risk Assessment
 ↓
Approval
 ↓
Execution Boundary
 ↓
OwnPilot / Sandbox / Host
 ↓
Action Ledger
```
The LLM MUST NEVER authorize itself.

## Identity Propagation
Every security-sensitive operation must propagate the subject (User/Workspace) into the execution, preventing cross-workspace data access.

## Status
* **OwnPilot Integration:** Completed in Phase 0.
* **Identity Model:** Defines Users, Workspaces, and Sessions.
* **Policy Engine:** Evaluating actions independently of the LLM.
* **Risk Engine:** Deterministic risk boundaries.
* **Approvals:** Pending, Approved, Denied, Expired, Cancelled states with cancellation invalidation.
* **Capabilities:** Lease management and expiration.
* **Credentials:** Isolated storage, never returned to LLM context.
* **Action Ledger:** Tamper-evident recording of high-impact actions.
