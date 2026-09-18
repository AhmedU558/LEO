# LEO Risk Model

## Abstract
The Risk Engine assigns a deterministic risk classification to actions to dictate approval flows and policy strictness. The LLM cannot lower or override this classification.

## Risk Levels

### LOW
* Read memory
* Read task status
* Inspect application state
* General safe, read-only internal operations

### MEDIUM
* Create drafts
* Navigate browser
* Modify non-sensitive workspace data

### HIGH
* Send email
* Publish social content
* Modify credentials
* Write/delete files
* Execute computer actions

### CRITICAL
* Unrestricted shell execution
* Destructive system operations
* Security configuration changes
* Credential extraction
* Privilege escalation

## Enforcement
Higher risk levels trigger tighter policy constraints, such as mandatory approvals and limits on capability lease duration.
