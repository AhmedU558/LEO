# LEO

## Database Schema v1.0

**Project:** LEO — Autonomous Personal AI Operating System  
**Database:** PostgreSQL  
**Document:** Database Schema  
**Version:** 1.0  
**Status:** Database Baseline  
**Date:** September 18, 2026

---

# 1. Purpose

This document defines the logical PostgreSQL data model for LEO.

The schema must support:

- users
- authentication
- workspaces
- agents
- agent runs
- conversations
- tasks
- workflows
- tools
- permissions
- approvals
- credentials
- social accounts
- social posts
- media
- memory
- analytics
- events
- notifications
- audit
- usage/cost tracking

The database must preserve:

- ownership isolation
- referential integrity
- auditability
- security
- extensibility
- recoverability

---

# 2. Database Strategy

Primary database:

**PostgreSQL**

Use PostgreSQL for structured application state.

Do not store large binary media directly in PostgreSQL.

Use object storage for:

- videos
- images
- audio
- generated files
- large artifacts

PostgreSQL stores metadata and object references.

---

# 3. Schema Organization

Logical PostgreSQL schemas may be organized as:

```text
public
identity
agents
tasks
workflows
tools
security
social
media
memory
analytics
events
audit
system

```

For the initial implementation, these may remain within one PostgreSQL database while logical ownership is maintained through table naming/module boundaries.

---

# 4. Common Conventions

All primary IDs should use:

```text
UUID

```

Recommended:

```text
uuid

```

or PostgreSQL-generated UUIDs.

All timestamps should use:

```text
TIMESTAMPTZ

```

All database timestamps should be stored in UTC.

User/workspace timezone preferences are stored separately.

---

# 5. Common Columns

Most user-owned entities should contain:

```text
created_at
updated_at

```

Where applicable:

```text
created_by
updated_by
deleted_at

```

Soft deletion should only be used where it has a clear product/security benefit.

---

# 6. Entity Relationship Overview

```text
User
 │
 ├── Workspaces
 │      │
 │      ├── Agents
 │      │     └── Agent Runs
 │      │
 │      ├── Conversations
 │      │
 │      ├── Tasks
 │      │     └── Task Steps
 │      │
 │      ├── Workflows
 │      │     └── Workflow Runs
 │      │
 │      ├── Permissions
 │      ├── Approvals
 │      ├── Credentials
 │      ├── Social Accounts
 │      │     └── Social Posts
 │      ├── Media
 │      ├── Memory
 │      ├── Analytics
 │      ├── Notifications
 │      └── Audit Events

```

---

# 7. Users

## Table: `users`

Stores LEO user identities.

```text
email
email_verified_at
display_name
avatar_url
status
timezone
locale
created_at
updated_at

```

### Status

```text
ACTIVE
SUSPENDED
DEACTIVATED

```

---

# 8. User Security

Never store:

- plaintext passwords
- OAuth client secrets
- provider access tokens

inside the `users` table.

Authentication credentials belong in dedicated security structures.

---

# 9. Workspaces

## Table: `workspaces`

A workspace provides an ownership boundary.

```text
id
name
owner_user_id
status
timezone
created_at
updated_at

```

Initially, a user may have one default workspace.

The model should still support multiple workspaces.

---

# 10. Workspace Membership

## Table: `workspace_members`

```text
id
workspace_id
user_id
role
created_at
updated_at

```

Roles:

```text
OWNER
ADMIN
MEMBER

```

Future roles can be added without redesigning ownership.

---

# 11. Sessions

## Table: `sessions`

```text
id
user_id
workspace_id
device_id
session_token_hash
ip_hash
user_agent
created_at
expires_at
revoked_at
last_seen_at

```

Raw session tokens should not be stored.

---

# 12. Devices

## Table: `devices`

```text
id
user_id
name
device_type
platform
last_seen_at
created_at
updated_at

```

Examples:

```text
WEB
DESKTOP
MOBILE
LOCAL_COMPUTER

```

---

# 13. Conversations

## Table: `conversations`

```text
id
workspace_id
user_id
title
status
created_at
updated_at

```

---

# 14. Messages

## Table: `messages`

```text
id
conversation_id
role
content
content_type
agent_run_id
created_at

```

Roles:

```text
USER
ASSISTANT
SYSTEM
TOOL

```

Sensitive tool results should not automatically be persisted indefinitely.

---

# 15. Message Metadata

Optional metadata:

```text
model_provider
model_name
token_usage
latency_ms
attachments
tool_call_count

```

Sensitive information must be redacted where required.

---

# 16. Agents

## Table: `agents`

```text
id
workspace_id
name
description
instructions
status
autonomy_level
memory_scope
created_by
created_at
updated_at

```

Status:

```text
ACTIVE
PAUSED
DISABLED
ARCHIVED

```

---

# 17. Agent Configuration

## Table: `agent_configs`

```text
id
agent_id
model_provider
model_name
temperature
max_tokens
max_runtime_seconds
max_tool_calls
daily_budget
monthly_budget
created_at
updated_at

```

Model-specific parameters should remain flexible.

---

# 18. Agent Permissions

Agents should not store permissions as an uncontrolled JSON blob.

Use normalized permission structures.

Primary table:

```text
agent_capabilities

```

---

# 19. Agent Capabilities

## Table: `agent_capabilities`

```text
id
agent_id
capability
resource_type
resource_id
risk_limit
requires_approval
valid_from
valid_until
created_at

```

Example:

```text
capability = social.publish
resource_type = social_account
resource_id = <UUID>
requires_approval = true

```

---

# 20. Agent Runs

## Table: `agent_runs`

Represents an individual execution of an agent.

```text
id
agent_id
task_id
conversation_id
status
started_at
completed_at
cancelled_at
failure_reason
token_usage
estimated_cost
created_at

```

Status:

```text
QUEUED
RUNNING
WAITING
COMPLETED
FAILED
CANCELLED

```

---

# 21. Tasks

## Table: `tasks`

Tasks are first-class persistent objects.

```text
id
workspace_id
user_id
agent_id
conversation_id
parent_task_id
title
description
status
priority
trigger_type
scheduled_at
started_at
completed_at
cancelled_at
deadline_at
created_at
updated_at

```

---

# 22. Task Status

```text
CREATED
PLANNING
READY
WAITING_APPROVAL
RUNNING
VERIFYING
COMPLETED
FAILED
RETRYING
PAUSED
CANCELLED
EXPIRED

```

---

# 23. Task Steps

## Table: `task_steps`

```text
id
task_id
step_order
step_key
name
description
type
status
tool_id
depends_on_step_id
input_reference
output_reference
started_at
completed_at
failure_reason
created_at
updated_at

```

---

# 24. Task Step Types

```text
PLAN
TOOL
CONDITION
APPROVAL
WAIT
PARALLEL
SUBTASK
VERIFICATION

```

---

# 25. Task Plans

## Table: `task_plans`

Stores structured execution plans.

```text
id
task_id
version
plan_json
status
created_at
updated_at

```

Plans may be regenerated.

Only an approved/validated plan version should execute.

---

# 26. Workflows

## Table: `workflows`

```text
id
workspace_id
name
description
status
version
definition_json
created_by
created_at
updated_at

```

Status:

```text
ACTIVE
PAUSED
DISABLED
ARCHIVED

```

---

# 27. Workflow Triggers

## Table: `workflow_triggers`

```text
id
workflow_id
type
configuration_json
enabled
created_at
updated_at

```

Types:

```text
MANUAL
SCHEDULE
EVENT
WEBHOOK
EMAIL
FILE
CONDITION

```

---

# 28. Workflow Runs

## Table: `workflow_runs`

```text
id
workflow_id
task_id
status
started_at
completed_at
failure_reason
created_at
updated_at

```

---

# 29. Workflow Steps

## Table: `workflow_steps`

```text
id
workflow_id
step_key
step_order
type
configuration_json
created_at
updated_at

```

The workflow definition should be versioned.

---

# 30. Scheduled Jobs

## Table: `scheduled_jobs`

```text
id
workspace_id
task_id
workflow_id
agent_id
schedule_type
schedule_expression
timezone
next_run_at
last_run_at
enabled
created_at
updated_at

```

Schedule types:

```text
ONCE
CRON
INTERVAL

```

---

# 31. Tools

## Table: `tools`

```text
id
name
description
source
trust_level
risk_level
schema_json
enabled
created_at
updated_at

```

Sources:

```text
CORE
PLUGIN
CUSTOM
DYNAMIC
MCP
PROVIDER

```

---

# 32. Tool Capabilities

## Table: `tool_capabilities`

```text
id
tool_id
capability
created_at

```

Example:

```text
tool:
publish_social_post

capability:
social.publish

```

---

# 33. Tool Executions

## Table: `tool_executions`

```text
id
task_id
agent_run_id
tool_id
status
input_hash
output_hash
started_at
completed_at
duration_ms
error_code
retry_count
created_at

```

Do not store raw secrets in tool execution records.

---

# 34. Tool Execution Status

```text
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
TIMED_OUT

```

---

# 35. Permissions

## Table: `permissions`

```text
id
workspace_id
subject_type
subject_id
capability
resource_type
resource_id
effect
conditions_json
created_at
updated_at
expires_at

```

Subject types:

```text
USER
AGENT
WORKSPACE

```

Effect:

```text
ALLOW
DENY

```

---

# 36. Permission Conditions

Conditions may include:

```text
time window
provider
account
environment
risk level
network
device

```

Conditions should be evaluated by the Policy Engine.

---

# 37. Approvals

## Table: `approvals`

```text
id
workspace_id
task_id
agent_id
requested_by
action
resource_type
resource_id
risk_level
scope_json
status
created_at
expires_at
resolved_at
resolved_by

```

Status:

```text
PENDING
APPROVED
DENIED
EXPIRED
CANCELLED

```

---

# 38. Approval Decisions

The approval record must bind to the exact action.

For example:

```text
action:
social.publish

resource:
instagram_account_123

content:
post_456

```

A later modification to the intended action should invalidate the approval.

---

# 39. Capability Leases

## Table: `capability_leases`

```text
id
agent_id
task_id
capability
resource_type
resource_id
constraints_json
issued_at
expires_at
revoked_at
status

```

Status:

```text
ACTIVE
EXPIRED
REVOKED
USED

```

---

# 40. Credentials

## Table: `credentials`

This table stores encrypted provider credentials.

```text
id
workspace_id
provider
credential_type
encrypted_payload
encryption_version
status
created_at
updated_at
expires_at
last_used_at

```

The encrypted payload must be inaccessible to ordinary application logic except through the credential service.

---

# 41. Credential Metadata

Optional:

```text
account_identifier
scopes
provider_account_id
token_expiry

```

Never store raw access tokens in metadata.

---

# 42. Credential Access Records

## Table: `credential_access_logs`

```text
id
credential_id
task_id
agent_id
tool_id
access_type
timestamp
result

```

This provides visibility into credential usage.

---

# 43. Integrations

## Table: `integrations`

```text
id
workspace_id
provider
status
configuration_json
credential_id
created_at
updated_at

```

Status:

```text
CONNECTED
DISCONNECTED
EXPIRED
ERROR
REAUTH_REQUIRED

```

---

# 44. Social Accounts

## Table: `social_accounts`

```text
id
workspace_id
integration_id
platform
external_account_id
username
display_name
account_type
status
capabilities_json
created_at
updated_at

```

---

# 45. Social Account Capabilities

Example:

```json
{
  "read": true,
  "draft": true,
  "schedule": true,
  "publish": true,
  "delete": false,
  "analytics": true
}

```

The provider adapter is authoritative for actual capabilities.

---

# 46. Social Posts

## Table: `social_posts`

```text
id
workspace_id
social_account_id
platform
media_id
content_concept_id
status
caption
title
description
scheduled_at
published_at
external_post_id
external_url
created_at
updated_at

```

---

# 47. Social Post Status

```text
DRAFT
REVIEW
APPROVED
SCHEDULED
PUBLISHING
PROCESSING
PUBLISHED
FAILED
CANCELLED
UNKNOWN

```

---

# 48. Content Concepts

## Table: `content_concepts`

Represents platform-independent content.

```text
id
workspace_id
media_id
topic
summary
audience
content_type
source_context_json
created_at
updated_at

```

---

# 49. Platform Variants

## Table: `content_variants`

```text
id
content_concept_id
platform
title
caption
description
hashtags_json
keywords_json
cta
seo_metadata_json
created_at
updated_at

```

This separates the source content from platform-specific optimization.

---

# 50. Social Publishing Attempts

## Table: `social_publish_attempts`

```text
id
social_post_id
attempt_number
status
provider_request_id
started_at
completed_at
error_code
error_message_safe
created_at

```

This allows reconciliation and retry tracking.

---

# 51. Social Analytics

## Table: `social_analytics_snapshots`

```text
id
social_post_id
captured_at
views
likes
comments
shares
saves
watch_time
impressions
clicks
followers_change
raw_metrics_json

```

Provider-specific metrics can be stored in `raw_metrics_json`.

---

# 52. Media

## Table: `media`

```text
id
workspace_id
uploaded_by
storage_provider
storage_key
filename
mime_type
size_bytes
checksum
duration_ms
width
height
status
created_at
updated_at

```

Status:

```text
UPLOADING
PROCESSING
READY
FAILED
DELETED

```

---

# 53. Media Processing Jobs

## Table: `media_jobs`

```text
id
media_id
job_type
status
attempts
started_at
completed_at
error_code
created_at
updated_at

```

Job types:

```text
TRANSCRIPTION
OCR
THUMBNAIL
VISION
AUDIO_ANALYSIS
METADATA

```

---

# 54. Media Analysis

## Table: `media_analysis`

```text
id
media_id
transcript
ocr_text
summary
topics_json
entities_json
visual_metadata_json
audio_metadata_json
confidence
created_at
updated_at

```

Large analysis artifacts may be stored externally.

---

# 55. Memory

## Table: `memories`

```text
id
workspace_id
user_id
agent_id
type
content
source_type
source_id
confidence
importance
status
created_at
updated_at
expires_at

```

Types:

```text
PREFERENCE
FACT
PROJECT
PERSON
DECISION
LEARNING
OBSERVATION

```

Source types:

```text
USER
CONVERSATION
TASK
AGENT
SYSTEM

```

---

# 56. Memory Classification

Memory should distinguish:

```text
EXPLICIT
OBSERVED
INFERRED
TEMPORARY
SYSTEM

```

Store classification separately if required:

```text
classification

```

---

# 57. Memory Access

Agents must not query unrestricted memory.

Memory retrieval should filter by:

```text
workspace
user
agent
memory_scope
classification
status

```

---

# 58. Memory Embeddings

If semantic memory retrieval is implemented, PostgreSQL may use:

**pgvector**

Potential table extension:

```text
embedding
embedding_model

```

Embeddings must follow the same ownership/security boundaries as the source memory.

---

# 59. Memory Versioning

Important memories may require version history.

## Table: `memory_versions`

```text
id
memory_id
version
content
changed_by
reason
created_at

```

This allows correction and auditability.

---

# 60. Notifications

## Table: `notifications`

```text
id
workspace_id
user_id
type
title
body
severity
status
related_task_id
related_approval_id
created_at
read_at

```

Types:

```text
TASK_COMPLETED
TASK_FAILED
APPROVAL_REQUIRED
CREDENTIAL_EXPIRED
AGENT_ALERT
SYSTEM_ALERT

```

---

# 61. Events

## Table: `events`

Internal application events.

```text
id
workspace_id
event_type
aggregate_type
aggregate_id
payload_json
created_at
processed_at

```

Events may drive:

- notifications
- workflows
- analytics
- integrations

---

# 62. Event Processing

Event consumers should be idempotent.

A consumer must not process the same event twice as a separate logical action.

---

# 63. Event Delivery

Optional event delivery tracking:

## Table: `event_deliveries`

```text
id
event_id
consumer
status
attempts
last_attempt_at
processed_at
error_code

```

---

# 64. Audit Events

## Table: `audit_events`

This is the security-sensitive Action Ledger.

```text
id
workspace_id
user_id
agent_id
task_id
tool_id
action
resource_type
resource_id
policy_decision
approval_id
result
error_code
metadata_json
created_at
previous_hash
event_hash

```

---

# 65. Audit Hash Chain

Each audit event should incorporate the previous event hash.

Conceptually:

```text
Hash(N) =
H(
  Event(N)
  +
  Hash(N-1)
)

```

This creates a tamper-evident sequence.

---

# 66. Audit Result

Results should be:

```text
SUCCESS
FAILURE
DENIED
CANCELLED
UNKNOWN

```

---

# 67. Security Events

Security events may be represented through `audit_events` or a dedicated table.

Examples:

```text
AUTH_SUCCESS
AUTH_FAILURE
AUTHORIZATION_DENIED
APPROVAL_CREATED
APPROVAL_DENIED
CREDENTIAL_ACCESSED
PLUGIN_ENABLED
MCP_CONNECTED
SANDBOX_VIOLATION
POLICY_VIOLATION

```

---

# 68. Usage

## Table: `usage_records`

```text
id
workspace_id
user_id
agent_id
task_id
provider
resource_type
quantity
unit
estimated_cost
created_at

```

Examples:

```text
tokens
API_CALL
COMPUTE_SECONDS
STORAGE_BYTES

```

---

# 69. Agent Budgets

## Table: `agent_budgets`

```text
id
agent_id
period_type
limit_amount
used_amount
reset_at
created_at
updated_at

```

Period:

```text
TASK
DAY
MONTH

```

---

# 70. Provider Health

## Table: `provider_health`

```text
id
provider
service
status
latency_ms
error_rate
checked_at

```

This can be used for provider routing and operational monitoring.

---

# 71. API Idempotency

## Table: `idempotency_keys`

```text
id
workspace_id
key
operation
request_hash
response_reference
created_at
expires_at

```

Used for actions such as:

- publishing
- sending
- creating records

---

# 72. Webhooks

## Table: `webhook_events`

```text
id
provider
external_event_id
event_type
signature_valid
payload_hash
payload_reference
received_at
processed_at
status

```

Raw sensitive webhook data should be retained only when necessary.

---

# 73. Index Strategy

Important indexes include:

### Users

```text
users(email)

```

### Workspace ownership

```text
agents(workspace_id)
tasks(workspace_id)
memories(workspace_id)
social_accounts(workspace_id)
media(workspace_id)

```

### Task execution

```text
tasks(status)
tasks(scheduled_at)
agent_runs(status)

```

### Approvals

```text
approvals(status)
approvals(task_id)
approvals(expires_at)

```

### Social

```text
social_posts(status)
social_posts(scheduled_at)
social_posts(external_post_id)

```

### Audit

```text
audit_events(workspace_id, created_at)
audit_events(task_id)
audit_events(agent_id)

```

---

# 74. Unique Constraints

Examples:

```text
users.email
workspace_members(workspace_id, user_id)
social_accounts(workspace_id, platform, external_account_id)
idempotency_keys(workspace_id, key)

```

Provider-specific uniqueness rules may differ.

---

# 75. Foreign Keys

Foreign keys should enforce ownership relationships wherever practical.

Example:

```text
agent.workspace_id
    → workspace.id

```

and:

```text
task.agent_id
    → agent.id

```

---

# 76. Delete Strategy

Critical security data should not be casually cascaded.

For example:

Deleting a user should not silently destroy the audit trail before required retention handling occurs.

Deletion policies must distinguish:

```text
USER DATA
OPERATIONAL DATA
SECURITY DATA
LEGAL/RETENTION DATA

```

---

# 77. Soft Deletion

Soft deletion may be used for:

- agents
- workflows
- social posts
- media metadata
- user configuration

It should not automatically be used for every table.

---

# 78. Row-Level Security

PostgreSQL Row-Level Security should be considered for high-sensitivity user-owned tables.

Candidate tables:

```text
memories
credentials
social_accounts
audit_events
tasks
conversations
media

```

Application-level authorization remains required.

Database RLS should be defense in depth, not the only authorization mechanism.

---

# 79. Transaction Boundaries

Operations that modify multiple related records should use database transactions.

Example:

```text
Create Approval
+
Update Task
+
Create Audit Event

```

These should be transactionally coordinated where consistency requires it.

---

# 80. Task Transaction Example

Creating a task may require:

```text
BEGIN

Create task
Create initial task step
Create task plan
Create audit event

COMMIT

```

Failure should roll back the incomplete transaction.

---

# 81. Publishing Transaction

A social publishing workflow should distinguish database state from external provider state.

Do not assume:

```text
DB COMMIT = PROVIDER PUBLISH SUCCESS

```

Instead:

```text
DB → PUBLISHING
Provider → Result
DB → VERIFIED RESULT

```

---

# 82. Approval Transaction

Approval flow:

```text
BEGIN

Create approval
Update task → WAITING_APPROVAL
Create audit event

COMMIT

```

Resolution:

```text
BEGIN

Validate approval
Update approval
Update task
Create audit event

COMMIT

```

---

# 83. Task Recovery

On application restart:

```text
Find RUNNING tasks
        ↓
Determine worker lease
        ↓
Recover / Retry / Fail

```

A worker lease mechanism should prevent duplicate execution.

---

# 84. Worker Leases

## Table: `execution_leases`

```text
id
resource_type
resource_id
worker_id
lease_token_hash
acquired_at
expires_at
released_at

```

Used to prevent multiple workers from executing the same task simultaneously.

---

# 85. Concurrency Control

Database-level locking may be used for critical transitions.

Examples:

```text
approval resolution
task claiming
workflow execution
publishing
credential rotation

```

---

# 86. Migration Strategy

Database changes must use versioned migrations.

Never modify production schema manually as the normal workflow.

Migration process:

```text
Create Migration
 ↓
Review
 ↓
Test
 ↓
Apply
 ↓
Verify

```

---

# 87. Backup Strategy

Production database should have:

- automated backups
- point-in-time recovery where supported
- encrypted backups
- tested restoration

---

# 88. Sensitive Column Handling

Highly sensitive columns include:

```text
credentials.encrypted_payload
sessions.session_token_hash
audit metadata containing sensitive references

```

Access to these columns should be restricted at the application layer.

---

# 89. JSON Usage

JSON/JSONB should be used for:

- provider-specific metadata
- workflow definitions
- flexible configuration
- external provider responses
- capability declarations

Do not use JSONB as a substitute for relational modeling of core entities.

---

# 90. Core Relational Principle

Use relational tables for:

```text
identity
ownership
authorization
tasks
agents
approvals
credentials
social accounts
posts
media
audit

```

Use JSONB for:

```text
provider-specific metadata
dynamic configuration
workflow definitions
raw external metadata

```

---

# 91. Database Security Invariants

```text
DB-SEC-001
Every user-owned resource has an ownership boundary.

DB-SEC-002
Credentials are encrypted.

DB-SEC-003
Raw secrets are not stored in ordinary task/message records.

DB-SEC-004
Audit records are tamper-evident.

DB-SEC-005
Approval records are bound to actions.

DB-SEC-006
Agent permissions are scoped.

DB-SEC-007
Cross-workspace access is denied.

DB-SEC-008
External provider state is not assumed to equal local state.

DB-SEC-009
Critical operations use transactions.

DB-SEC-010
Long-running tasks are recoverable.

```

---

# 92. Database-to-Architecture Mapping

```text
Database
   │
   ├── Identity
   │
   ├── Agent Runtime
   │
   ├── Task Engine
   │
   ├── Workflow Engine
   │
   ├── Policy Engine
   │
   ├── Social Engine
   │
   ├── Media Engine
   │
   ├── Memory
   │
   ├── Analytics
   │
   └── Audit

```

---

# 93. Database-to-API Mapping

The database should map cleanly to:

```text
/api/v1/users
/api/v1/agents
/api/v1/tasks
/api/v1/workflows
/api/v1/tools
/api/v1/permissions
/api/v1/approvals
/api/v1/credentials
/api/v1/social
/api/v1/media
/api/v1/memory
/api/v1/analytics
/api/v1/notifications
/api/v1/audit

```

Detailed request/response contracts belong in:

`LEO_API_CONTRACTS.md`

---

# 94. Initial Migration Order

Recommended migration sequence:

```text
001_identity
002_workspaces
003_sessions
004_conversations
005_agents
006_agent_configs
007_permissions
008_tools
009_tasks
010_task_steps
011_workflows
012_scheduling
013_approvals
014_capability_leases
015_credentials
016_integrations
017_social_accounts
018_media
019_social_content
020_social_posts
021_analytics
022_memory
023_events
024_notifications
025_audit
026_usage
027_execution_leases
028_idempotency
029_webhooks

```

Exact migration ordering may change during implementation.

---

# 95. MVP Database Scope

The initial production MVP should prioritize:

```text
Users
Workspaces
Sessions
Conversations
Messages
Agents
Agent Runs
Tasks
Task Steps
Tools
Permissions
Approvals
Credentials
Integrations
Social Accounts
Media
Content Concepts
Content Variants
Social Posts
Publishing Attempts
Memory
Notifications
Audit
Usage
Execution Leases

```

Advanced analytics and provider-specific extensions can be expanded later.

---

# 96. Database Acceptance Criteria

The schema is ready for implementation when:

- ownership boundaries are defined
- all major entities have IDs
- relationships are defined
- indexes are defined
- unique constraints are defined
- security-sensitive data is isolated
- approval relationships are defined
- audit structure is defined
- task recovery is supported
- provider state reconciliation is supported
- migrations are ordered

---

# 97. Final Database Architecture

The final conceptual model is:

```text
                    USER
                     │
                  WORKSPACE
                     │
       ┌─────────────┼──────────────┐
       ↓             ↓              ↓
     AGENTS        TASKS        CONVERSATIONS
       │             │
       ↓             ↓
  AGENT RUNS      TASK STEPS
                     │
              ┌──────┴──────┐
              ↓             ↓
           TOOLS         APPROVALS
              │             │
              └──────┬──────┘
                     ↓
                 EXECUTION
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
     SOCIAL        BROWSER       COMPUTER
       │
     MEDIA
       │
   ANALYTICS

Parallel:
MEMORY
CREDENTIALS
EVENTS
NOTIFICATIONS
AUDIT
USAGE

```

---

# 98. Database Baseline Decision

LEO will use:

```text
PostgreSQL
+
Object Storage
+
Optional pgvector

```

with:

```text
UUID identifiers
UTC timestamps
Normalized security entities
JSONB for flexible provider metadata
Transactions for critical operations
Ownership isolation
Audit hash chaining
Worker leases
Idempotency

```

The database is now defined sufficiently to proceed to the **API contract layer**.

---

# 99. Next Document

The next specification is:

`LEO_API_CONTRACTS.md`

It will define:

- REST endpoints
- WebSocket events
- request schemas
- response schemas
- authentication
- authorization
- pagination
- errors
- task APIs
- agent APIs
- workflow APIs
- approval APIs
- social APIs
- media APIs
- memory APIs
- analytics APIs
- computer APIs
- voice APIs
- audit APIs
- idempotency
- webhook contracts
- API versioning

The API document will serve as the contract between the **LEO frontend, backend, workers, and Antigravity implementation.**