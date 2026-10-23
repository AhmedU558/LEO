# LEO

## Antigravity Implementation Specification v1.0

**Project:** LEO — Autonomous Personal AI Operating System  
**Document:** Antigravity Implementation Specification  
**Version:** 1.0  
**Status:** Implementation Handoff  
**Implementation Agent:** Antigravity  
**Architecture Foundation:** OwnPilot  
**Database:** PostgreSQL  
**Primary Language:** TypeScript  
**Date:** September 18, 2026

---

# 1. Mission

Build LEO as a production-grade autonomous personal AI operating system.

LEO must not become a collection of unrelated scripts or integrations.

The implementation must preserve this core lifecycle:

```text
USER
 ↓
UNDERSTAND
 ↓
PLAN
 ↓
POLICY
 ↓
PERMISSION
 ↓
APPROVAL
 ↓
EXECUTE
 ↓
VERIFY
 ↓
AUDIT
 ↓
LEARN

```

The implementation agent must treat the architecture documents in this project as the source of truth.

---

# 2. Documents That Define the Architecture

Before implementing substantial functionality, read and understand:

```text
LEO_REPOSITORY_DUE_DILIGENCE.md
LEO_PRODUCT_DOCUMENT.md
LEO_SRS.md
LEO_ARCHITECTURE.md
LEO_SECURITY_ARCHITECTURE.md
LEO_DATABASE_SCHEMA.md
LEO_API_CONTRACTS.md
LEO_REPOSITORY_STRUCTURE.md
LEO_IMPLEMENTATION_ROADMAP.md

```

These documents collectively define:

- product requirements
- system architecture
- security architecture
- database design
- API contracts
- repository structure
- implementation sequence

If code conflicts with these documents, stop and resolve the conflict rather than silently changing the architecture.

---

# 3. Primary Foundation

LEO uses:

```text
OwnPilot

```

as its foundational agent platform.

The goal is to **adapt and extend**, not unnecessarily rewrite it.

Antigravity must first inspect the current OwnPilot implementation before modifying it.

---

# 4. Repository Inspection Requirement

Before writing LEO-specific code:

```text
1. Inspect repository
2. Inspect package structure
3. Inspect build system
4. Inspect database layer
5. Inspect authentication
6. Inspect agent runtime
7. Inspect tool registry
8. Inspect plugin system
9. Inspect MCP
10. Inspect scheduler
11. Inspect memory
12. Inspect sandbox
13. Inspect audit
14. Inspect tests
15. Inspect dependency versions

```

Create an implementation map showing:

```text
Existing OwnPilot component
        ↓
LEO usage
        ↓
LEO modification required?
        ↓
Keep / Adapt / Replace

```

Do not duplicate existing OwnPilot functionality unless there is a documented reason.

---

# 5. Repository Classification

The audited repositories have these roles:

| Repository                      | Implementation Role                 |
| ------------------------------- | ----------------------------------- |
| OwnPilot                        | **Primary foundation**              |
| Qwen open-computer-use          | **Local computer provider**         |
| E2B open-computer-use           | **Cloud computer provider**         |
| OpenAI realtime voice component | **Voice UI/runtime reference**      |
| SocialClaw                      | **Social architecture reference**   |
| PostEverywhere MCP              | **Social workflow reference**       |
| Free AI Social Scheduler        | **Scheduler/UI reference**          |
| OpenClaw                        | **Architecture/security reference** |
| OpenLily                        | **Voice reference**                 |
| Agent S                         | **Computer-use research reference** |

Do not automatically import code from these repositories.

Before copying implementation code:

```text
Verify license
Inspect dependency chain
Inspect security implications
Determine whether adaptation is actually necessary

```

---

# 6. Non-Negotiable Architecture

The system must maintain:

```text
LEO Product Layer
        ↓
LEO Security Layer
        ↓
OwnPilot Foundation
        ↓
Tools / MCP / Providers

```

The LEO security layer must remain authoritative.

---

# 7. Core Security Principle

The LLM must never authorize itself.

Correct:

```text
LLM
 ↓
Tool Request
 ↓
Policy Engine
 ↓
Authorization
 ↓
Risk
 ↓
Approval
 ↓
Executor

```

Incorrect:

```text
LLM
 ↓
"I have permission"
 ↓
Execute

```

The second architecture is prohibited.

---

# 8. Security Invariants

The following invariants are mandatory:

```text
INV-SEC-001
LLM cannot authorize itself.

INV-SEC-002
Tools cannot bypass Policy Engine.

INV-SEC-003
Agents cannot elevate privileges.

INV-SEC-004
Credentials are never freely exposed.

INV-SEC-005
External content is untrusted.

INV-SEC-006
Cancelled tasks invalidate pending approvals.

INV-SEC-007
Unknown provider status cannot become SUCCESS.

INV-SEC-008
Cross-user data access is denied.

INV-SEC-009
Untrusted code cannot execute in the core process.

INV-SEC-010
Autonomous execution is resource-limited.

INV-SEC-011
High-impact actions are auditable.

INV-SEC-012
Users can stop autonomous execution.

```

A feature that violates any of these invariants is not complete.

---

# 9. Implementation Order

Follow this order unless an ADR explicitly changes it:

```text
PHASE 0
Repository

PHASE 1
Identity + Security

PHASE 2
Agent Core

PHASE 3
Tasks + Workers + Workflows

PHASE 4
Web Product

PHASE 5
Social

PHASE 6
Browser + Computer

PHASE 7
Voice

PHASE 8
Autonomy

PHASE 9
Analytics + Learning

PHASE 10
Production Hardening

```

Do not begin advanced autonomy before the underlying execution and security layers are reliable.

---

# 10. Phase 0 — Repository Initialization

Antigravity must:

```text
Inspect OwnPilot
 ↓
Create LEO branch/fork strategy
 ↓
Establish package boundaries
 ↓
Establish build system
 ↓
Establish local infrastructure
 ↓
Establish CI

```

Required infrastructure:

```text
PostgreSQL
Redis
Object Storage
Gateway
Web
Workers

```

---

# 11. Phase 0 Acceptance

The repository must support:

```text
pnpm install
pnpm build
pnpm typecheck
pnpm test

```

The development environment must provide health checks for:

```text
Database
Redis
Gateway
Workers

```

---

# 12. Phase 1 — Identity

Implement:

```text
User
Workspace
Session
Device
Authentication
Authorization

```

Use the existing OwnPilot authentication/security primitives where they are safe and compatible.

Do not preserve unsafe passwordless remote access behavior.

---

# 13. Phase 1 — Authorization

Implement:

```text
RBAC
ABAC
Capability scopes
Resource scopes
Capability leases

```

Authorization must be evaluated server-side.

---

# 14. Phase 1 — Policy Engine

Implement a centralized API similar to:

```text
evaluatePolicy(request): PolicyDecision

```

Conceptual request:

```text
subject
action
resource
context
risk

```

Decision:

```text
ALLOW
DENY
APPROVAL_REQUIRED

```

All consequential tools must use this service.

---

# 15. Policy Precedence

At minimum:

```text
Explicit DENY
    >
Missing capability
    >
Resource restriction
    >
Risk restriction
    >
Approval requirement
    >
Explicit ALLOW

```

The exact implementation may evolve, but policy precedence must be deterministic.

---

# 16. Phase 1 — Approval Engine

Implement:

```text
ApprovalRequest
Approval
Expiration
Cancellation
Resolution

```

An approval must bind to:

```text
Agent
Run
Task
Tool
Action
Resource
Parameters
Risk

```

Approval must not become a reusable unlimited authorization token.

---

# 17. Phase 1 — Action Ledger

Every consequential operation must be recorded.

Minimum fields:

```text
who
what
when
why
agent
task
run
tool
credential
resource
policy decision
approval
result
cost
hash

```

Implement tamper-evident chaining.

---

# 18. Phase 1 — Credentials

Credentials must be stored encrypted.

Never:

```text
console.log(token)
return token
store token in plaintext source
send token to LLM context

```

Providers should receive narrowly scoped credential access.

---

# 19. Phase 1 Security Gate

Do not proceed to autonomous execution until these tests pass:

```text
Cross-user access → DENIED
Unauthorized tool → DENIED
Missing capability → DENIED
High-risk action → APPROVAL_REQUIRED
Expired approval → DENIED
Cancelled task approval → INVALID
Credential leakage → NONE
Audit event → CREATED

```

---

# 20. Phase 2 — Agent Runtime

Adapt OwnPilot's agent runtime.

Implement LEO orchestration around:

```text
Intent
Planning
Context
Tool Selection
Policy
Execution
Verification
Result

```

---

# 21. Intent Layer

User requests should become structured intents.

Example:

```json
{
  "intent": "publish_content",
  "goal": "Publish my video",
  "constraints": {
    "platforms": ["instagram", "tiktok"]
  }
}
```

Never rely exclusively on free-form strings internally.

---

# 22. Planner

Planner output must be structured.

Example:

```json
{
  "goal": "...",
  "steps": [
    {
      "tool": "media.analyze",
      "reason": "Understand content"
    },
    {
      "tool": "social.generate_seo",
      "reason": "Create platform-specific metadata"
    }
  ]
}
```

Plans must be validated before execution.

---

# 23. Tool Registry

Each tool should define:

```text
id
name
description
schema
source
trust
capabilities
risk
requiresApproval
timeout
retryPolicy

```

---

# 24. Tool Execution

Every tool invocation must follow:

```text
Request
 ↓
Schema Validation
 ↓
Capability Check
 ↓
Resource Check
 ↓
Policy
 ↓
Risk
 ↓
Approval if required
 ↓
Execution
 ↓
Verification
 ↓
Audit

```

---

# 25. Tool Trust

Maintain trust levels:

```text
TRUSTED
SEMI_TRUSTED
SANDBOXED

```

External/MCP/dynamic tools must not automatically become trusted.

---

# 26. Dynamic Code

Dynamic code must never execute directly in the core process.

Required controls:

```text
Static validation
Capability validation
Policy validation
Sandbox
Resource limits
Network policy
Filesystem restrictions
Timeout
Cancellation
Audit

```

---

# 27. Phase 3 — Tasks

Implement durable task execution.

States:

```text
CREATED
QUEUED
RUNNING
WAITING_APPROVAL
PAUSED
COMPLETED
FAILED
CANCELLED

```

Persist task state.

Do not rely solely on process memory.

---

# 28. Task Execution

Task architecture:

```text
API
 ↓
Task Service
 ↓
Queue
 ↓
Worker
 ↓
Agent Run
 ↓
Tool Execution

```

---

# 29. Worker Requirements

Workers must support:

```text
Retries
Backoff
Timeout
Cancellation
Concurrency limits
Leases
Crash recovery
Dead-letter handling

```

---

# 30. Concurrency

Do not allow unlimited tool execution.

Use global and scoped limits:

```text
Global
User
Agent
Task
Tool
Provider

```

---

# 31. Cancellation

Cancellation must propagate:

```text
Task
 ↓
Agent Run
 ↓
Tool
 ↓
Provider

```

Pending approvals must be invalidated.

---

# 32. Workflow Engine

Implement:

```text
Trigger
 ↓
Step
 ↓
Condition
 ↓
Action
 ↓
Next Step

```

Support:

- scheduled workflows
- event triggers
- retries
- conditional branching
- cancellation
- execution history

---

# 33. Scheduler

Support:

```text
One-time
Recurring
Cron-like
Timezone-aware

```

Scheduled work must execute even when the UI is closed.

---

# 34. Phase 4 — Web UI

Build the LEO command center.

Required initial sections:

```text
Chat
Tasks
Agents
Approvals
Social
Media
Memory
Analytics
Settings

```

---

# 35. Main Chat

The chat should show:

```text
User request
Agent response
Task status
Tool activity
Approval requests
Failures
Completion

```

The user should be able to understand what LEO is doing.

---

# 36. Task Trace

Display:

```text
Planning
Policy
Tools
Approvals
Execution
Verification
Result

```

Sensitive data must be redacted.

---

# 37. Approval Center

Each approval should show:

```text
What will happen
Why
Which agent
Which resource
Which account
Risk
Requested action

```

Buttons:

```text
Approve
Deny

```

---

# 38. Phase 5 — Social System

Create a provider-independent interface:

```text
SocialProvider

```

Provider implementations must remain isolated.

Initial providers:

```text
Instagram
TikTok
YouTube

```

Facebook follows once the architecture is stable.

---

# 39. Social Account Architecture

Support:

```text
Connect
Disconnect
Refresh
Capability discovery
Credential state

```

Provider capabilities must be explicit.

Example:

```json
{
  "video": true,
  "image": false,
  "carousel": true,
  "scheduling": true,
  "analytics": true
}
```

Do not assume all providers support identical functionality.

---

# 40. Media Pipeline

Implement:

```text
Upload
 ↓
Metadata
 ↓
Validation
 ↓
Transcoding
 ↓
Thumbnail
 ↓
Transcript
 ↓
OCR
 ↓
Analysis

```

Heavy processing belongs in workers.

---

# 41. Social Content Model

Use:

```text
Content Concept
      ↓
Platform Variant
      ↓
Social Draft
      ↓
Scheduled Post
      ↓
Publishing Attempt
      ↓
Provider Result

```

---

# 42. Platform-Specific SEO

LEO must generate independent platform variants.

Example:

```text
Video
 ↓
Topic
 ↓
Entities
 ↓
Audience
 ↓
Keywords
 ↓
Instagram Variant
TikTok Variant
YouTube Variant

```

Do not simply copy the same caption everywhere.

---

# 43. Social Publishing State Machine

Use states similar to:

```text
DRAFT
APPROVED
SCHEDULED
QUEUED
PUBLISHING
PUBLISHED
FAILED
UNKNOWN
CANCELLED

```

---

# 44. Publishing Rule

Never report:

```text
SUCCESS

```

until provider success has been sufficiently verified.

If status is uncertain:

```text
UNKNOWN

```

and reconciliation must continue.

---

# 45. Publishing Idempotency

Publishing must support idempotency.

A retry must not accidentally create duplicate posts.

Use:

```text
Idempotency-Key

```

and provider-specific idempotency/reconciliation mechanisms where available.

---

# 46. Social Approval

Default flow:

```text
Generate
 ↓
Draft
 ↓
Review
 ↓
Approve
 ↓
Schedule
 ↓
Publish

```

Autonomous publishing requires explicit policy authorization.

---

# 47. Social Analytics

Normalize provider metrics into LEO's analytics model.

Never fabricate unavailable metrics.

Provider-specific metrics may remain in provider metadata.

---

# 48. Phase 6 — Browser

Create:

```text
BrowserProvider
BrowserSession
BrowserAction
BrowserSecurityPolicy

```

Initial provider:

```text
Playwright

```

Browser sessions must be isolated.

---

# 49. Browser Security

Protect against:

```text
Prompt injection
Malicious websites
Credential theft
Cross-origin abuse
Untrusted downloads
Dangerous navigation

```

External web content must be treated as untrusted input.

---

# 50. Phase 6 — Computer Use

Implement:

```text
ComputerUseProvider
ComputerRouter
ComputerSession
ComputerAction

```

Initial providers:

```text
Qwen Local
E2B Cloud

```

---

# 51. Computer Routing

The router decides:

```text
LOCAL
or
CLOUD

```

based on:

```text
Task
Risk
Isolation requirement
Availability
User policy
Capability

```

---

# 52. Computer Permission Levels

```text
READ_ONLY
BROWSER_ONLY
APP_CONTROL
FILE_OPERATIONS
SHELL_COMMANDS
SYSTEM_CONTROL

```

Never expose system-level actions by default.

---

# 53. Computer Action Validation

Every action must pass:

```text
Session validation
 ↓
Capability
 ↓
Resource scope
 ↓
Policy
 ↓
Risk
 ↓
Approval
 ↓
Action
 ↓
Audit

```

---

# 54. Shell Execution

Shell access must be treated as a privileged capability.

Never allow:

```text
LLM
 ↓
raw shell string
 ↓
host shell

```

without policy and isolation.

---

# 55. File Operations

Protect against:

```text
Path traversal
System directories
Credential files
Secrets
Cross-user files

```

---

# 56. Emergency Computer Stop

The user must be able to stop a running computer session.

Cancellation must propagate to the provider.

---

# 57. Phase 7 — Voice

Create:

```text
VoiceProvider
VoiceSession
VoiceTool
Transcript

```

Initial provider:

```text
OpenAI Realtime

```

Use the existing realtime voice component as an implementation/reference layer where appropriate.

---

# 58. Voice Security

Voice must use the same authorization model as text.

Voice input must not bypass:

```text
Policy
Permissions
Approval
Audit

```

---

# 59. Voice Tools

Only expose narrow application-owned tools.

Do not expose unrestricted:

```text
shell
filesystem
system-control

```

through voice.

---

# 60. Phase 8 — Autonomous Agents

Only enable advanced autonomy after core security is stable.

Levels:

```text
LEVEL 0
Manual

LEVEL 1
Suggest

LEVEL 2
Approved execution

LEVEL 3
Bounded autonomous execution

LEVEL 4
Bounded autonomous workflows

LEVEL 5
Persistent autonomous operation

```

---

# 61. Autonomous Agent Controls

Every autonomous agent must have:

```text
Allowed tools
Blocked tools
Allowed resources
Blocked resources
Approval requirements
Budget
Concurrency
Quiet hours
Failure threshold
Execution limits

```

---

# 62. Heartbeat

Autonomous agents may use:

```text
Cron
Heartbeat
Event triggers

```

A heartbeat must evaluate:

```text
Should I act?
Am I allowed?
Do I have budget?
Is the resource available?
Does the action require approval?

```

---

# 63. Runaway Protection

Automatically stop/pause execution when:

```text
Failure threshold exceeded
Budget exceeded
Tool loop detected
Unexpected cost
Policy violations
Provider instability

```

---

# 64. Phase 9 — Analytics

Collect:

```text
Task success
Task duration
Tool success
Tool latency
Provider success
Provider errors
LLM cost
Approval rate
Agent failure rate
Social performance

```

---

# 65. Agent Learning

Store structured outcomes:

```text
Outcome
Error
Correction
Learning
Confidence
Source
Timestamp

```

Learning must not automatically modify security policies or grant permissions.

---

# 66. Social Feedback Loop

Use historical performance to inform future content generation.

Potential dimensions:

```text
Topic
Format
Hook
Caption
Posting time
Platform
Audience
Engagement

```

The system should produce evidence-based recommendations rather than silently changing important user settings.

---

# 67. Phase 10 — Production Hardening

Before production:

```text
Security review
Dependency audit
Performance testing
Failure testing
Recovery testing
Provider testing
API testing
E2E testing
Agent evaluation

```

---

# 68. Required Security Tests

At minimum:

```text
Authentication bypass
Authorization bypass
IDOR
Cross-user access
Cross-workspace access
SSRF
DNS rebinding
Prompt injection
Tool injection
Credential leakage
Path traversal
Shell escape
MCP abuse
Webhook spoofing
Rate-limit bypass
Approval bypass
Capability escalation

```

---

# 69. Dependency Security

CI must run dependency security checks.

Use the security mechanisms already present in OwnPilot where applicable, including production dependency auditing and security overrides.

Do not disable vulnerability checks merely to make CI pass.

---

# 70. API Implementation

Implement according to:

```text
LEO_API_CONTRACTS.md

```

API routes should be thin:

```text
Route
 ↓
Validation
 ↓
Authorization
 ↓
Service
 ↓
Domain
 ↓
Repository

```

---

# 71. API Contract Rule

Do not introduce undocumented breaking changes.

If a breaking change is required:

```text
Create ADR
Update API contract
Update OpenAPI
Update tests
Update frontend

```

---

# 72. Database Implementation

Implement migrations according to:

```text
LEO_DATABASE_SCHEMA.md

```

Initial migration sequence:

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

---

# 73. Database Rules

Use:

```text
UUID
UTC TIMESTAMPTZ
Foreign keys
Indexes
Transactions
Ownership controls
RLS where appropriate

```

JSONB is permitted for provider-specific metadata.

Do not put core security relationships into opaque JSONB.

---

# 74. Repository Structure

Follow:

```text
apps/
packages/
workers/
infrastructure/
tests/
scripts/
docs/
config/

```

as defined by:

```text
LEO_REPOSITORY_STRUCTURE.md

```

---

# 75. Package Dependency Rule

Preferred direction:

```text
apps
 ↓
services/domain
 ↓
shared

```

Provider SDKs must stay inside provider packages.

Do not allow UI code to directly access database repositories.

---

# 76. Frontend Rule

The frontend must communicate through:

```text
REST
WebSocket

```

It must not:

```text
directly access PostgreSQL
directly access provider credentials
directly call provider APIs with secret credentials

```

---

# 77. Realtime

Implement typed events such as:

```text
task.created
task.updated
task.started
task.completed
task.failed

agent.started
agent.paused
agent.resumed

approval.created
approval.approved
approval.denied

social.post.publishing
social.post.published
social.post.failed

media.processing
media.ready

```

---

# 78. Observability

Every important operation should be traceable through:

```text
requestId
userId
workspaceId
taskId
agentId
runId
toolExecutionId
provider

```

---

# 79. Logging Rules

Never log:

```text
Passwords
OAuth tokens
API keys
Encryption keys
Full sensitive files
Private message content unnecessarily

```

Use structured redaction.

---

# 80. Testing Pyramid

Implement:

```text
Unit
 ↓
Integration
 ↓
E2E
 ↓
Security
 ↓
Agent Evaluation

```

Do not rely exclusively on end-to-end tests.

---

# 81. Mock Providers

Every major external provider should have a deterministic mock.

Example:

```text
MockInstagramProvider
MockTikTokProvider
MockYouTubeProvider
MockEmailProvider
MockComputerProvider

```

This enables reliable CI.

---

# 82. Provider Contract Tests

Each provider adapter must satisfy the same interface contract.

Example:

```text
authenticate
getCapabilities
validate
createDraft
publish
getStatus
reconcile
getAnalytics

```

Not every provider must support every operation.

Unsupported operations must return explicit capability errors.

---

# 83. Failure Handling

Use explicit states:

```text
FAILED
RETRYING
UNKNOWN
CANCELLED

```

Never convert errors into fake success.

---

# 84. Retry Rules

Retries must distinguish:

```text
Retryable
Non-retryable
Unknown

```

Examples of likely retryable failures:

```text
Temporary network failure
Provider 5xx
Rate limit
Transient queue failure

```

Examples of non-retryable failures:

```text
Invalid credentials
Invalid media
Permission denied
Policy denied
Malformed request

```

---

# 85. Idempotency

Use idempotency for consequential side effects:

```text
Publish
Send Email
Create external resource
Schedule external action

```

---

# 86. Webhooks

Webhook handlers must:

```text
Verify signature
Validate timestamp
Validate event
Deduplicate
Persist event
Process asynchronously
Audit where appropriate

```

---

# 87. Security Boundary for External Content

Anything originating outside LEO must be considered untrusted:

```text
Web pages
Emails
Documents
MCP responses
Social content
Provider responses
Browser text
Computer screenshots

```

External content must never override system/developer/policy instructions.

---

# 88. Prompt Injection Defense

Agents must distinguish:

```text
User instruction
System instruction
Policy
Tool output
External content

```

Tool output is data.

It is not automatically an instruction.

---

# 89. Memory Security

Memory retrieval must respect:

```text
User
Workspace
Agent
Conversation
Resource scope

```

A retrieved memory must never grant permissions.

---

# 90. Agent-to-Agent Security

If multiple agents communicate:

```text
Agent A
 ↓
Message
 ↓
Agent B

```

the message must not grant Agent B new authority.

Permissions are evaluated independently.

---

# 91. Autonomous Action Budget

Implement limits for:

```text
Token cost
Money cost
Tool calls
Provider calls
Concurrent executions
Daily actions
Monthly actions
Runtime

```

---

# 92. Kill Switch

Provide:

```text
Pause Agent
Cancel Task
Stop Workflow
Revoke Capability
Disable Autonomous Mode
Global Emergency Lockdown

```

where authorized.

---

# 93. Git Workflow

Antigravity should work in small commits.

Preferred pattern:

```text
feat:
fix:
refactor:
test:
security:
docs:
chore:

```

Examples:

```text
feat(policy): add centralized policy evaluator
test(policy): add authorization boundary tests
feat(tasks): add durable task execution
feat(social): add provider abstraction

```

---

# 94. Commit Rules

Do not combine unrelated changes.

Bad:

```text
feat: implement entire LEO

```

Preferred:

```text
feat(database): add task schema
feat(tasks): add task state machine
feat(worker): add task worker
test(tasks): add lifecycle tests

```

---

# 95. Pull Request Rules

Every significant change must document:

```text
What changed
Why
Tests
Security impact
Database impact
API impact
Rollback considerations

```

---

# 96. ADR Requirement

Create an ADR whenever implementation requires changing:

```text
Architecture
Security model
Authorization
Database ownership
Provider abstraction
API contract
Execution semantics
Autonomy model

```

---

# 97. No Silent Architecture Changes

If Antigravity encounters a conflict:

```text
STOP
 ↓
Document conflict
 ↓
Identify options
 ↓
Recommend implementation
 ↓
Update ADR/spec
 ↓
Continue

```

Do not silently choose a fundamentally different architecture.

---

# 98. Feature Development Loop

Every feature should follow:

```text
Read requirement
 ↓
Inspect existing implementation
 ↓
Identify reusable code
 ↓
Design smallest change
 ↓
Implement
 ↓
Write tests
 ↓
Run tests
 ↓
Security review
 ↓
Review diff
 ↓
Commit

```

---

# 99. Definition of Done

A feature is not done merely because it works manually.

It is done when applicable:

```text
Code
Tests
Security
API
Database
UI
Observability
Documentation

```

are complete.

---

# 100. Phase Completion Rule

A phase can only be marked complete when:

```text
Implementation ✓
Tests ✓
Security ✓
Acceptance criteria ✓
Documentation ✓

```

are satisfied.

---

# 101. Antigravity First Execution

The first implementation task is **NOT** to build all of LEO.

The first task is:

```text
AUDIT → MAP → PLAN → IMPLEMENT FOUNDATION

```

Specifically:

```text
1. Inspect OwnPilot repository.
2. Confirm actual current version/commit.
3. Map existing architecture.
4. Identify reusable modules.
5. Identify modules requiring adaptation.
6. Identify security gaps.
7. Confirm dependency/license state.
8. Establish LEO repository structure.
9. Run baseline tests.
10. Produce implementation report.

```

Only after this should coding begin.

---

# 102. First Coding Milestone

The first actual implementation milestone is:

```text
LEO Foundation Bootstrap

```

Deliver:

```text
Monorepo
PostgreSQL
Redis
Object Storage abstraction
Gateway
Web shell
Worker shell
Environment validation
Logging
Health checks
Testing
CI

```

---

# 103. Second Coding Milestone

Then:

```text
LEO Security Foundation

```

Deliver:

```text
Identity
Sessions
Authorization
Policy Engine
Permissions
Approvals
Credentials
Audit Ledger

```

---

# 104. Third Coding Milestone

Then:

```text
LEO Agent Foundation

```

Deliver:

```text
Intent
Planner
Agent Run
Tool Registry
Tool Execution
Policy Integration
Task Lifecycle

```

---

# 105. Fourth Coding Milestone

Then:

```text
LEO Autonomous Execution Foundation

```

Deliver:

```text
Queue
Workers
Scheduler
Workflows
Retries
Cancellation
Recovery

```

---

# 106. Fifth Coding Milestone

Then:

```text
LEO Product UI

```

Deliver:

```text
Chat
Task dashboard
Agent dashboard
Approval center
Notifications
Settings
Realtime

```

---

# 107. Sixth Coding Milestone

Then:

```text
LEO Social MVP

```

Deliver:

```text
Media
SEO
Drafts
Accounts
Scheduling
Publishing
Reconciliation
Analytics

```

---

# 108. Seventh Coding Milestone

Then:

```text
LEO Browser + Computer

```

Deliver:

```text
Browser provider
Computer provider
Qwen local
E2B cloud
Permissions
Security
Cancellation
Audit

```

---

# 109. Eighth Coding Milestone

Then:

```text
LEO Voice

```

Deliver:

```text
Voice session
Realtime provider
Voice tools
Transcripts
Policy integration

```

---

# 110. Ninth Coding Milestone

Then:

```text
LEO Advanced Autonomy

```

Deliver:

```text
Heartbeat
Autonomous agents
Budgets
Failure limits
Quiet hours
Bounded workflows

```

---

# 111. Tenth Coding Milestone

Then:

```text
LEO Production

```

Deliver:

```text
Security hardening
Performance
Observability
Backups
Recovery
Provider reliability
Penetration testing
Agent evaluation
Release pipeline

```

---

# 112. Final Product Flow

A mature LEO request should look like:

```text
USER
 │
 ↓
CHAT / VOICE
 │
 ↓
INTENT
 │
 ↓
PLANNER
 │
 ↓
POLICY
 │
 ├── DENY ───────────────→ USER
 │
 ├── APPROVAL ───────────→ USER
 │                           │
 │                        APPROVE
 │                           ↓
 └──────────────────────→ EXECUTOR
                             │
                       ┌─────┼─────┐
                       ↓     ↓     ↓
                     TOOLS  MCP  PROVIDERS
                       │     │     │
                       └─────┼─────┘
                             ↓
                         VERIFY
                             ↓
                           AUDIT
                             ↓
                         RESULT
                             ↓
                          MEMORY

```

---

# 113. Final Antigravity Rule

LEO's capability should grow through:

```text
Better Intelligence
+
Better Tools
+
Better Integrations

```

not through:

```text
Weaker Security

```

The security/governance layer must remain stronger as autonomy increases.

---

# 114. Final Handoff

Antigravity is authorized to begin implementation only according to this sequence:

```text
READ
 ↓
INSPECT
 ↓
MAP
 ↓
BOOTSTRAP
 ↓
SECURE
 ↓
TEST
 ↓
IMPLEMENT
 ↓
VERIFY
 ↓
COMMIT
 ↓
NEXT MILESTONE

```

The implementation agent must maintain the architecture documents as the source of truth and must never treat successful execution of a single feature as permission to bypass the system's security model.

---

# 115. LEO Architecture Baseline — COMPLETE

The complete planning stack is now:

```text
01  Repository Due Diligence
02  Product Document
03  SRS
04  System Architecture
05  Security Architecture
06  Database Schema
07  API Contracts
08  Repository Structure
09  Implementation Roadmap
10  Antigravity Implementation Specification

```

These ten documents form the **LEO v1.0 implementation baseline**.

The project is now ready to move from:

```text
PLANNING

```

to:

```text
IMPLEMENTATION

```

with Antigravity as the primary coding agent.
