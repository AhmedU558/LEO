# LEO

## System Architecture v1.0

**Project:** LEO — Autonomous Personal AI Operating System
**Document:** System Architecture
**Version:** 1.0
**Status:** Architecture Baseline
**Date:** September 18, 2026

---

# 1. Architecture Objective

This document defines the technical architecture required to implement LEO according to:

- `LEO_PRODUCT_DOCUMENT.md`
- `LEO_SRS.md`
- repository due diligence findings

The architecture must provide:

- autonomous agents
- persistent tasks
- workflows
- memory
- social automation
- browser automation
- computer use
- voice
- email/productivity
- permissions
- approvals
- security
- auditability
- provider independence
- reliable background execution

The architecture must also allow LEO to evolve without repeatedly rewriting the core platform.

---

# 2. Architectural Principle

The central architectural rule is:

> **The intelligence layer decides what could be done; the policy layer decides what may be done.**

Therefore:

```text id="e2m7sp"
                    ┌──────────────┐
                    │     User     │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │   LEO UI     │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │ API Gateway  │
                    └──────┬───────┘
                           ↓
                 ┌────────────────────┐
                 │ Agent Orchestrator │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │   Policy Engine    │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │ Tool / MCP Runtime  │
                 └─────────┬──────────┘
                           ↓
                 ┌────────────────────┐
                 │ External Providers  │
                 └────────────────────┘
```

No external side-effecting action should bypass the policy layer.

---

# 3. Architectural Style

LEO should initially use a:

> **Modular Monolith + Asynchronous Worker Architecture**

rather than immediately becoming a microservice system.

This gives:

- simpler development
- easier local deployment
- lower operational complexity
- shared types
- simpler debugging
- faster MVP development

while still creating clear module boundaries.

Later, high-load components can be extracted into independent services.

---

# 4. High-Level Architecture

```text id="9q3p6j"
                         LEO CLIENTS
                              │
              ┌───────────────┼────────────────┐
              │               │                │
             Web            Voice           Remote
              │               │                │
              └───────────────┼────────────────┘
                              ↓
                       ┌──────────────┐
                       │  LEO Gateway │
                       └──────┬───────┘
                              ↓
                     ┌──────────────────┐
                     │ Session / Auth   │
                     └────────┬─────────┘
                              ↓
                    ┌─────────────────────┐
                    │ Agent Orchestrator  │
                    └──────────┬──────────┘
                               ↓
                 ┌─────────────────────────┐
                 │       Policy Engine     │
                 └────────────┬────────────┘
                              ↓
                    ┌──────────────────┐
                    │ Execution Engine │
                    └────────┬─────────┘
                             ↓
          ┌──────────────────┼────────────────────┐
          ↓                  ↓                    ↓
       Tool Runtime       MCP Runtime        Workflow Engine
          │                  │                    │
          └──────────────────┼────────────────────┘
                             ↓
              ┌───────────────────────────┐
              │      Provider Layer       │
              └─────────────┬─────────────┘
                            │
       ┌──────────┬─────────┼──────────┬───────────┐
       ↓          ↓         ↓          ↓           ↓
     Social     Email     Browser    Computer    Voice
```

---

# 5. Core Architectural Layers

LEO SHALL contain the following logical layers.

```text id="pj7b1b"
1. Presentation
2. Gateway
3. Identity
4. Agent
5. Planning
6. Policy
7. Execution
8. Workflow
9. Integration
10. Memory
11. Persistence
12. Observability
```

---

# 6. Presentation Layer

Technology target:

- React
- TypeScript
- Next.js or existing foundation UI architecture where compatible

Responsibilities:

- chat
- task dashboard
- agent dashboard
- approvals
- social manager
- media library
- analytics
- memory
- audit
- settings
- voice interface

The frontend SHALL NOT contain authorization logic as the ultimate security boundary.

---

# 7. Gateway Layer

The gateway is the entry point into LEO.

Responsibilities:

- HTTP API
- WebSocket/realtime communication
- authentication
- request validation
- session handling
- rate limiting
- request context
- API versioning

Conceptually:

```text id="l4l90w"
Client
 ↓
Gateway
 ├── Auth
 ├── Rate Limit
 ├── Validation
 ├── Request Context
 └── Route
```

---

# 8. Identity Layer

Identity manages:

- users
- sessions
- authentication
- devices
- authorization context

Identity must remain separate from agent reasoning.

---

# 9. Agent Orchestrator

The Agent Orchestrator is the central execution brain.

Responsibilities:

- understand intent
- construct plans
- select agents
- select tools
- maintain execution state
- execute steps
- handle failures
- request approvals
- produce final results

It should not directly perform privileged actions.

---

# 10. Agent Runtime

An agent execution should have a structured context.

```text id="f2c8yp"
AgentRun
├── user
├── agent
├── task
├── conversation
├── permissions
├── memory scope
├── budget
├── tool context
├── execution state
└── cancellation signal
```

Every tool invocation receives a controlled execution context.

---

# 11. Agent Loop

Conceptually:

```text id="5m74kr"
USER REQUEST
     ↓
UNDERSTAND
     ↓
PLAN
     ↓
CHECK PLAN
     ↓
SELECT TOOL
     ↓
POLICY CHECK
     ↓
┌───────────────┐
│ APPROVAL?      │
└───────┬───────┘
        │
   YES  │  NO
    ↓   │   ↓
APPROVAL│ EXECUTE
    ↓   │   ↓
 EXECUTE
    ↓
VERIFY
    ↓
UPDATE STATE
    ↓
NEXT STEP
```

---

# 12. Planning Engine

Planning should produce structured plans rather than only natural-language reasoning.

Example:

```json
{
  "goal": "Publish product video",
  "steps": [
    {
      "id": "analyze",
      "action": "analyze_media"
    },
    {
      "id": "seo",
      "action": "generate_platform_seo"
    },
    {
      "id": "draft",
      "action": "create_social_drafts"
    },
    {
      "id": "publish",
      "action": "publish_social_posts"
    }
  ]
}
```

Plans must be validated before execution.

---

# 13. Policy Engine

The Policy Engine is one of LEO's most important components.

It evaluates:

```text id="x1whpe"
WHO
WHAT
WHERE
WHY
WHEN
WITH WHICH CREDENTIAL
USING WHICH TOOL
AT WHAT RISK
UNDER WHICH PERMISSION
```

Output:

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

---

# 14. Policy Decision Pipeline

```text id="v2h5dn"
Tool Request
     ↓
Identity Check
     ↓
Agent Check
     ↓
Capability Check
     ↓
Resource Check
     ↓
Credential Check
     ↓
Risk Check
     ↓
Budget Check
     ↓
Approval Check
     ↓
Environment Check
     ↓
Decision
```

---

# 15. Capability Model

Capabilities should be granular.

Examples:

```text id="iyx4jt"
email.read
email.send
calendar.read
calendar.write

social.read
social.draft
social.schedule
social.publish
social.delete

browser.read
browser.interact

computer.screen
computer.keyboard
computer.mouse
computer.files
computer.shell

system.admin
```

Agents receive capabilities rather than unrestricted access.

---

# 16. Resource Scoping

Permissions should also identify resources.

Example:

```text id="2k04x8"
Capability:
social.publish

Resource:
instagram/account/brand-a
```

This prevents:

```text
Permission to publish Brand A
```

from becoming:

```text
Permission to publish every Instagram account.
```

---

# 17. Capability Leases

LEO should eventually support temporary capabilities.

Example:

```text id="kq5zj1"
Capability:
computer.keyboard

Scope:
Chrome

Duration:
15 minutes

Task:
Research XYZ
```

After expiration, the capability automatically becomes invalid.

---

# 18. Approval Engine

Approval requests are generated by policy.

```text id="w0jyur"
Policy
 ↓
REQUIRE_APPROVAL
 ↓
Approval Service
 ↓
User
 ↓
APPROVE / DENY
 ↓
Policy re-evaluation
 ↓
Execution
```

Approvals must be bound to the task and intended action.

---

# 19. Execution Engine

The Execution Engine is responsible for actually invoking tools.

Responsibilities:

- tool validation
- timeout
- cancellation
- retries
- concurrency
- result normalization
- error classification
- audit events

---

# 20. Tool Registry

The registry contains all callable capabilities.

Sources may include:

```text id="2kebh4"
CORE
PLUGIN
CUSTOM
DYNAMIC
MCP
PROVIDER
```

Each tool should declare:

```text
Tool ID
Name
Description
Schema
Capabilities
Risk
Trust
Source
Approval Requirement
Timeout
Retry Policy
```

---

# 21. Tool Trust

Tools should have trust levels:

```text id="7f9ax4"
TRUSTED
SEMI_TRUSTED
SANDBOXED
UNTRUSTED
```

A tool's trust level affects execution restrictions.

---

# 22. MCP Layer

MCP provides an integration boundary.

```text id="9g74cj"
             LEO
              │
        Policy Engine
              │
          MCP Runtime
              │
       ┌──────┼──────┐
       ↓      ↓      ↓
    Social  Browser  External
```

MCP tools must still pass LEO authorization.

---

# 23. Workflow Engine

The Workflow Engine executes persistent multi-step workflows.

It supports:

- sequential steps
- parallel steps
- conditions
- branching
- delays
- approvals
- retries
- timeouts
- cancellation
- compensation

---

# 24. Queue Architecture

Long-running work should not block API requests.

Conceptually:

```text id="9i4b20"
API
 ↓
Task Created
 ↓
Queue
 ↓
Worker
 ↓
Agent Execution
 ↓
Result
 ↓
Event
 ↓
UI
```

Potential queue infrastructure:

- Redis-backed queue
- PostgreSQL-backed jobs
- foundation-native scheduler/queue where appropriate

The final choice belongs in the implementation architecture decision record.

---

# 25. Scheduler

The Scheduler handles:

- scheduled tasks
- recurring workflows
- autonomous agents
- delayed execution
- retries
- heartbeat-style agents

Example:

```text id="q9f3x8"
09:00
 ↓
Social Agent
 ↓
Run analytics
 ↓
Generate report
 ↓
Notify user
```

---

# 26. Event Bus

LEO should use an internal event model.

Examples:

```text id="n3xxa5"
task.created
task.started
task.completed
task.failed

approval.created
approval.approved
approval.denied
approval.expired

agent.started
agent.stopped

social.published
social.failed

credential.expired
workflow.completed
```

Events allow modules to remain loosely coupled.

---

# 27. Memory Architecture

Memory consists of:

```text id="s8ibad"
Memory Manager
      │
 ┌────┼──────────────┐
 ↓    ↓              ↓
Short Long-term   Project
Term   Memory      Memory
```

The exact storage strategy will be defined in the database architecture.

---

# 28. Memory Retrieval

When processing a request:

```text id="d5lkn7"
User Request
 ↓
Memory Query
 ↓
Relevant Memories
 ↓
Context Builder
 ↓
Agent
```

Memory retrieval must be scoped to the requesting user and agent.

---

# 29. Memory Write Pipeline

LEO should not automatically persist every piece of conversation.

```text id="t8gk6w"
Conversation
 ↓
Candidate Memory
 ↓
Classification
 ↓
Confidence / Relevance
 ↓
Policy
 ↓
Persist
```

---

# 30. Social Architecture

The social subsystem should use a provider abstraction.

```text id="k2s5fm"
SocialService
      │
SocialProvider
      │
 ┌────┼──────────────┐
 ↓    ↓              ↓
IG   TikTok       YouTube
```

Each provider implements a common capability interface.

---

# 31. Social Provider Interface

Conceptually:

```text id="8x5a1g"
connect()
disconnect()
getAccounts()
getCapabilities()
createDraft()
publish()
schedule()
getPostStatus()
getAnalytics()
deletePost()
```

Not every provider must support every operation.

Capabilities must be explicitly declared.

---

# 32. Social Content Model

LEO should separate:

```text id="y4q2k9"
Source Media
     ↓
Content Concept
     ↓
Platform Variant
     ↓
Draft
     ↓
Scheduled Post
     ↓
Published Post
```

This prevents platform-specific metadata from contaminating the source content model.

---

# 33. Social SEO Engine

The SEO engine should be independent from provider APIs.

```text id="h5s7ja"
Media
 ↓
Content Understanding
 ↓
Keyword Research
 ↓
Audience Analysis
 ↓
Platform Rules
 ↓
SEO Generator
 ↓
SEO Validator
 ↓
Platform Variant
```

---

# 34. Media Pipeline

Media processing should be asynchronous.

```text id="x2x5ck"
Upload
 ↓
Object Storage
 ↓
Media Job
 ↓
Transcription
 ↓
OCR
 ↓
Visual Analysis
 ↓
Metadata
 ↓
Content Model
```

---

# 35. Browser Architecture

Browser automation should be isolated behind:

```text id="o3wq2s"
BrowserProvider
├── Playwright
├── CDP
└── Future Provider
```

The browser provider receives a controlled execution context.

---

# 36. Computer Architecture

Computer use should never be embedded directly inside the agent engine.

```text id="0wj2xg"
ComputerService
       ↓
ComputerUseProvider
       ↓
┌───────────────┬────────────────┐
│               │                │
Local           Cloud            Future
Qwen            E2B              Provider
```

---

# 37. Local Computer Provider

Initial target:

**Qwen Open Computer Use**

Responsibilities:

- application discovery
- screenshots
- keyboard
- mouse
- accessibility
- controlled application interaction

LEO owns the permission layer around it.

---

# 38. Cloud Computer Provider

Secondary target:

**E2B Desktop**

Use cases:

- isolated browser sessions
- remote research
- long-running tasks
- tasks requiring cloud execution
- user device unavailable

---

# 39. Computer Router

The router chooses local or cloud execution.

Factors may include:

```text id="g4p3ap"
User preference
Task type
Security policy
Device availability
Required application
Resource requirements
Execution duration
```

---

# 40. Voice Architecture

Voice should connect to the same agent system.

```text id="c8v0p1"
Microphone
 ↓
Voice Runtime
 ↓
Speech / Realtime Model
 ↓
LEO Gateway
 ↓
Agent
 ↓
Tools
 ↓
Voice Response
```

The voice layer must not have privileged capabilities unavailable to text.

---

# 41. Voice Provider

Initial UI/runtime candidate:

**OpenAI Realtime Voice Component**

The architecture should expose:

```text id="m9g3a1"
VoiceProvider
├── OpenAIRealtime
└── LocalVoice
```

---

# 42. Email Architecture

```text id="7gk2me"
EmailService
     ↓
EmailProvider
     ↓
┌────┴─────┐
Gmail   Future
```

Email actions pass through the same policy system.

---

# 43. Calendar Architecture

```text id="4e4w0k"
CalendarService
       ↓
CalendarProvider
       ↓
Google / Future
```

---

# 44. Credential Architecture

Credentials should be handled by a dedicated credential subsystem.

```text id="c2g9qi"
Provider
 ↓
Credential Manager
 ↓
Encrypted Vault
 ↓
Scoped Credential
 ↓
Tool
```

The model should receive a reference/capability rather than unnecessary secret material.

---

# 45. Secret Isolation

Secrets SHALL NOT be placed into:

- prompts
- ordinary logs
- task descriptions
- analytics
- browser-visible UI
- model context

unless specifically required and protected.

---

# 46. Audit Architecture

Every important action creates an audit event.

```text id="m5m8o4"
Action
 ↓
Audit Event
 ↓
Hash
 ↓
Previous Hash
 ↓
Ledger
```

Example:

```text
previous_hash
event_hash
actor
agent
task
tool
action
resource
policy_decision
approval
result
timestamp
```

---

# 47. Security Architecture Boundary

Security enforcement should occur at multiple levels:

```text id="m1m3f9"
UI
 ↓
API
 ↓
Agent
 ↓
Policy
 ↓
Tool
 ↓
Provider
 ↓
Environment
```

Defense in depth is required.

---

# 48. Network Security

All outbound network-capable tools should use controlled networking.

Required protections:

- URL validation
- DNS validation
- private IP blocking
- redirect validation
- protocol restrictions
- timeout
- response limits

The final architecture should centralize these capabilities into a reusable network policy layer.

---

# 49. Sandbox Architecture

Untrusted execution should occur in isolated environments.

Potential execution classes:

```text id="8s2hkt"
Trusted
 ↓
Restricted
 ↓
Sandboxed
 ↓
Cloud Isolated
```

Shell and arbitrary code execution should not execute directly inside the primary application process.

---

# 50. Dynamic Code

Dynamic tools should pass:

```text id="7q3xen"
Static Validation
 ↓
Capability Validation
 ↓
Policy Validation
 ↓
Approval
 ↓
Sandbox
 ↓
Resource Limits
 ↓
Execution
 ↓
Audit
```

---

# 51. Concurrency Control

The execution engine must limit concurrent work.

Limits should exist at:

```text id="3qf5g2"
Global
User
Agent
Task
Tool
Provider
Computer Session
```

This prevents runaway autonomous execution.

---

# 52. Cancellation Architecture

Cancellation must propagate through the execution tree.

```text id="x4v0we"
User Cancels Task
       ↓
Task Cancellation
       ↓
Agent Run
       ↓
Workflow
       ↓
Tool Calls
       ↓
External Operation
```

Pending approvals associated with the cancelled task must become invalid.

---

# 53. Verification Architecture

Every consequential action should have a verification strategy.

Example:

```text id="6p6vqn"
Publish Request
 ↓
Provider API
 ↓
Provider Response
 ↓
Status Check
 ↓
Verified Result
```

LEO should distinguish:

```text
REQUESTED
ACCEPTED
PROCESSING
COMPLETED
FAILED
UNKNOWN
```

---

# 54. Retry Architecture

Retryable operations should use controlled backoff.

```text id="q9f8n4"
Failure
 ↓
Classify
 ↓
Retryable?
 ├── NO → Fail
 └── YES
       ↓
   Backoff
       ↓
     Retry
```

External side effects require idempotency protection.

---

# 55. Database Architecture

PostgreSQL will be the primary relational database.

Major domains:

```text id="c8n8qt"
Identity
Users
Sessions
Agents
AgentRuns
Tasks
TaskSteps
Workflows
WorkflowRuns
Tools
Permissions
Approvals
Credentials
SocialAccounts
SocialPosts
Media
Analytics
Memory
Events
Notifications
Audit
```

Detailed schema will be defined in:

`LEO_DATABASE_SCHEMA.md`

---

# 56. Object Storage

Large media files should not be stored directly in PostgreSQL.

Use object storage for:

- videos
- images
- audio
- generated documents
- other large artifacts

Database stores metadata and references.

---

# 57. Caching

Caching may be used for:

- tool definitions
- provider metadata
- temporary task state
- session data
- rate-limit state
- frequently accessed configuration

Sensitive credential caching must remain tightly controlled and short-lived.

---

# 58. Realtime Architecture

Realtime events should be delivered through WebSocket or equivalent infrastructure.

Example:

```text id="t2e4fj"
Worker
 ↓
Event Bus
 ↓
Realtime Gateway
 ↓
Browser
```

---

# 59. Frontend State

Frontend state should distinguish:

```text id="8t2j1a"
Server State
Task State
Realtime State
UI State
Draft State
```

The client should not be considered authoritative for task or permission state.

---

# 60. Multi-Tenant Isolation

Even for an initially single-user-oriented product, internal boundaries should support multiple users.

Every major resource should have an ownership scope.

```text
user_id
workspace_id
agent_id
task_id
```

Cross-tenant access must be denied by default.

---

# 61. Configuration

Configuration should be separated into:

### System configuration

Infrastructure/provider settings.

### User configuration

Personal preferences.

### Agent configuration

Agent-specific instructions/limits.

### Task configuration

Task-specific runtime settings.

### Secrets

Stored separately in the credential subsystem.

---

# 62. Provider Abstraction

LEO should define provider interfaces for:

```text id="5w0t1m"
ModelProvider
SocialProvider
EmailProvider
CalendarProvider
BrowserProvider
ComputerUseProvider
VoiceProvider
StorageProvider
SearchProvider
```

This prevents vendor lock-in.

---

# 63. Dependency Strategy

LEO should prefer:

1. mature audited internal components
2. established open-source libraries
3. official provider SDKs
4. small focused dependencies

Avoid unnecessary dependency duplication.

All third-party components should undergo:

- license review
- security review
- maintenance review
- dependency audit

---

# 64. OwnPilot Integration

OwnPilot remains the primary foundation.

LEO should reuse/adapt:

```text id="8zj9ik"
Agent Engine
Tool Registry
MCP
Workflow Infrastructure
Scheduler
Memory
Browser
Voice Foundations
Credential Security
SSRF Protection
Audit
Rate Limiting
```

LEO-specific systems sit above or around these components.

---

# 65. LEO-Owned Core

The following should belong to LEO:

```text id="q6pjr5"
LEO Policy Engine
LEO Authorization Model
LEO Risk Engine
LEO Action Ledger Extensions
Social Intelligence
Platform SEO
Provider Abstractions
Capability Leases
Product UI
Unified Task Model
```

---

# 66. Repository-Level Architecture

Initial conceptual repository:

```text id="k6x1r4"
leo/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── core/
│   ├── agent/
│   ├── policy/
│   ├── permissions/
│   ├── tasks/
│   ├── workflows/
│   ├── memory/
│   ├── tools/
│   ├── mcp/
│   ├── social/
│   ├── media/
│   ├── browser/
│   ├── computer/
│   ├── voice/
│   ├── email/
│   ├── calendar/
│   ├── credentials/
│   ├── audit/
│   ├── analytics/
│   └── shared/
│
├── workers/
│   ├── agent-worker/
│   ├── media-worker/
│   ├── social-worker/
│   └── workflow-worker/
│
├── infrastructure/
│
├── tests/
│
└── docs/
```

The exact repository structure will be finalized later.

---

# 67. Deployment Architecture

Initial deployment:

```text id="4c8k2s"
                  Internet
                     │
                     ↓
                Reverse Proxy
                     │
              ┌──────┴──────┐
              ↓             ↓
             Web           API
                            │
                     ┌──────┴──────┐
                     ↓             ↓
                  Workers        DB
                     │
               ┌─────┴─────┐
               ↓           ↓
             Redis       Storage
```

---

# 68. Local Deployment

LEO should support local/self-hosted deployment.

Potential components:

```text id="j7e4pn"
Docker
PostgreSQL
Redis
LEO API
LEO Web
Workers
Optional Local Models
Optional Computer Agent
```

---

# 69. Cloud Deployment

Cloud deployment should support:

- scalable API
- workers
- managed PostgreSQL
- managed Redis
- object storage
- isolated computer environments

Cloud computer sessions should remain isolated from the core API.

---

# 70. Local + Cloud Hybrid

LEO should support:

```text id="4y9qj0"
                  LEO
                   │
             Execution Router
               /          \
              /            \
        Local Runtime    Cloud Runtime
             │                │
       User Computer      E2B Sandbox
```

---

# 71. Security Zones

The deployment should conceptually contain:

```text id="6s4r2p"
ZONE A
Public/API

ZONE B
Core Application

ZONE C
Worker Runtime

ZONE D
Secrets/Credentials

ZONE E
Sandbox

ZONE F
External Providers
```

Higher-risk execution should be placed farther away from core infrastructure.

---

# 72. Data Flow Example — Social Publishing

```text id="4m0v8c"
User
 ↓
Web UI
 ↓
API
 ↓
Task
 ↓
Agent
 ↓
SEO Engine
 ↓
Draft
 ↓
Policy
 ↓
Approval
 ↓
Social Provider
 ↓
Publish
 ↓
Verify
 ↓
Analytics
 ↓
Audit
 ↓
User
```

---

# 73. Data Flow Example — Computer Use

```text id="6d2m4n"
User
 ↓
Agent
 ↓
Computer Tool
 ↓
Policy
 ↓
Permission
 ↓
Computer Router
 ↓
Qwen / E2B
 ↓
Screenshot / Result
 ↓
Verification
 ↓
Agent
 ↓
User
```

---

# 74. Data Flow Example — Voice

```text id="5g1w2s"
Voice Input
 ↓
Voice Runtime
 ↓
Transcript
 ↓
LEO Agent
 ↓
Policy
 ↓
Tool
 ↓
Result
 ↓
Voice Response
```

---

# 75. Data Flow Example — Autonomous Agent

```text id="n5v7e1"
Scheduler
 ↓
Agent Run
 ↓
Load Context
 ↓
Load Memory
 ↓
Plan
 ↓
Policy
 ↓
Tools
 ↓
Verification
 ↓
Persist
 ↓
Audit
 ↓
Notification
```

---

# 76. Failure Isolation

A failure in:

```text
Instagram
```

must not crash:

```text
Email
Memory
Chat
Calendar
```

A failed computer session should not terminate the API.

Provider failures must be isolated at provider boundaries.

---

# 77. Observability Architecture

The system should produce:

```text id="s7h1t2"
Logs
Metrics
Traces
Events
Audit
Task History
Provider Health
```

Correlation IDs should connect:

```text
User Request
 → Task
 → Agent Run
 → Tool Call
 → Provider Request
 → Result
```

---

# 78. Security Observability

Security monitoring should identify:

- repeated authorization failures
- unusual tool activity
- excessive execution
- credential failures
- suspicious network requests
- repeated denied actions
- sandbox violations
- abnormal agent behavior

---

# 79. AI Observability

LEO should record appropriate metadata around model execution:

- model provider
- model
- latency
- token usage
- tool selection
- plan outcome
- failure
- cost

Sensitive prompt content should not automatically be logged in plaintext.

---

# 80. Architecture Decision — Modular Monolith

**Decision:** Start modular.

Reason:

LEO is complex enough that boundaries matter, but premature microservices would make development significantly harder.

Modules can later become services if required.

---

# 81. Architecture Decision — OwnPilot

**Decision:** Use OwnPilot as the foundation.

Reason:

It already provides substantial infrastructure for:

- agents
- tools
- MCP
- workflows
- memory
- scheduling
- browser
- voice
- security

LEO's effort should focus on the product-specific intelligence, policy and automation layer.

---

# 82. Architecture Decision — Computer Use

**Decision:** Abstract computer control behind `ComputerUseProvider`.

Initial implementation target:

```text
Qwen Open Computer Use
```

Secondary:

```text
E2B Desktop
```

This avoids coupling LEO to a single computer-use engine.

---

# 83. Architecture Decision — Social

**Decision:** Build a LEO-owned provider abstraction.

Use existing repositories for:

- patterns
- provider mappings
- validation
- scheduling ideas
- MCP interfaces

Do not make a hosted third-party social backend a hard dependency.

---

# 84. Architecture Decision — Voice

**Decision:** Adapt the realtime voice component as the initial browser voice layer while keeping a provider abstraction for future local voice.

---

# 85. Architecture Decision — Authorization

**Decision:** LEO owns the final authorization decision.

No:

```text
LLM → Tool
```

for privileged operations.

Always:

```text
LLM → Policy → Tool
```

---

# 86. Architecture Decision — Audit

**Decision:** Every security-sensitive side effect must be auditable.

Audit records should be append-oriented and tamper-evident.

---

# 87. Architecture Decision — Async Execution

Long-running operations SHALL run asynchronously.

This includes:

- media processing
- social publishing
- browser tasks
- computer tasks
- research
- autonomous agents
- scheduled workflows

---

# 88. Architecture Decision — Provider Independence

LEO should avoid putting provider-specific logic into:

- agent prompts
- task engine
- policy engine
- core database models

Provider-specific behavior belongs in adapters.

---

# 89. Critical Invariants

The following architecture invariants SHALL always hold.

### INV-001

LLM output cannot grant permissions.

### INV-002

Tools cannot bypass policy.

### INV-003

Agents cannot modify their own authorization.

### INV-004

Credentials cannot be freely exposed to agents.

### INV-005

Cancelled tasks invalidate pending approvals.

### INV-006

Unknown external action status cannot be reported as success.

### INV-007

Cross-user resource access is denied.

### INV-008

Destructive actions require appropriate authorization.

### INV-009

Untrusted code cannot execute directly in the main process.

### INV-010

Autonomous execution is subject to resource limits.

---

# 90. Architecture Quality Attributes

LEO architecture is optimized for:

```text id="j3x8m1"
Security
Reliability
Extensibility
Observability
Maintainability
Autonomy
Provider Independence
User Control
```

Performance and horizontal scalability remain important but should not compromise the security model.

---

# 91. Architecture Validation

Before implementation, architecture review must verify:

- every SRS requirement maps to a module
- every external side effect maps to policy
- every privileged capability has an authorization model
- every persistent task has recovery behavior
- every provider has an abstraction
- every secret has a storage/access strategy
- every high-risk action has an approval strategy
- every major workflow has an audit strategy

---

# 92. Architecture Freeze

The following decisions are now considered the baseline:

```text
Foundation
→ OwnPilot

Architecture
→ Modular Monolith + Workers

Database
→ PostgreSQL

Agent
→ OwnPilot Agent Runtime + LEO orchestration

Security
→ LEO Policy Engine

Integration
→ MCP + Provider Adapters

Computer
→ ComputerUseProvider
   → Qwen local
   → E2B cloud

Voice
→ VoiceProvider
   → OpenAI Realtime initial
   → Local future

Social
→ LEO SocialProvider abstraction

Storage
→ PostgreSQL + Object Storage

Execution
→ Async task/workflow workers

Audit
→ Tamper-evident Action Ledger

Authorization
→ Capability + Resource + Risk + Approval
```

---

# 93. Next Architecture Documents

This architecture now produces the next technical specifications:

```text id="7j0x3c"
LEO_ARCHITECTURE.md
        │
        ├──────────────→ LEO_SECURITY_ARCHITECTURE.md
        │
        ├──────────────→ LEO_DATABASE_SCHEMA.md
        │
        ├──────────────→ LEO_API_CONTRACTS.md
        │
        └──────────────→ LEO_REPOSITORY_STRUCTURE.md
```

After those:

```text
Architecture
     ↓
Database
     ↓
API
     ↓
Repository
     ↓
Roadmap
     ↓
Antigravity Specification
```

---

# 94. Final Architecture Principle

LEO should not be built as:

> “An LLM with lots of tools.”

It should be built as:

```text
                 LEO
                  │
        ┌─────────┴─────────┐
        │                   │
   Intelligence          Governance
        │                   │
   Planning             Policy
   Reasoning            Permissions
   Memory               Risk
   Agents               Approvals
        │               Audit
        └─────────┬─────────┘
                  ↓
             Execution
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
      Tools      MCP      Providers
        │         │         │
        └─────────┼─────────┘
                  ↓
             Real World
```

**Intelligence proposes. Governance authorizes. Execution acts. Verification confirms. Audit records.**

That is the architectural foundation of LEO.
