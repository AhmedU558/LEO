# LEO Action Ledger

## Abstract
Extends the OwnPilot audit foundation into a tamper-evident LEO Action Ledger. Records all security-sensitive operations.

## Record Schema
Each ledger entry includes:
* `action_id`, `timestamp`
* `user_id`, `workspace_id`
* `agent_id`, `task_id`, `run_id`
* `tool`, `action`
* `resource`, `resource_type`
* `credential_id`, `capability`
* `policy_decision`, `risk_level`
* `approval_id`, `approval_status`
* `execution_environment`
* `result`, `error`
* `duration`, `cost`
* `previous_hash`, `hash`

## Constraints
* The ledger must remain tamper-evident.
* Agents, tools, or users cannot modify or delete historical audit records.
