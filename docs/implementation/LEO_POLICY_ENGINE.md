# LEO Policy Engine

## Abstract

The Policy Engine evaluates authorization requests deterministically and independently of the LLM.

## Flow

```text
PolicyRequest
    ↓
PolicyEngine.evaluate()
    ↓
PolicyDecision
```

## Decision States

- **ALLOW:** The action proceeds.
- **DENY:** The action is halted.
- **REQUIRE_APPROVAL:** The action awaits explicit user approval.

## Evaluation Criteria

The engine considers:

- Identity
- Workspace
- Resource
- Requested action
- Capability
- Risk level
- Environment
- Agent/Task permissions
- Credential scope
- Autonomous/manual execution
- Existing capability lease
- Approval state

**Unknown conditions must fail closed (DENY).**
