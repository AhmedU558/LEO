# LEO

## Repository Structure v1.0

**Project:** LEO — Autonomous Personal AI Operating System  
**Document:** Repository Structure  
**Version:** 1.0  
**Status:** Architecture Baseline  
**Foundation:** OwnPilot  
**Date:** September 18, 2026

---

# 1. Purpose

This document defines the physical and logical organization of the LEO codebase.

The structure is designed to:

- preserve OwnPilot's proven foundation
- isolate LEO-owned business logic
- prevent security boundaries from being bypassed
- support modular development
- support background workers
- support external providers
- support local and cloud computer-use
- support social automation
- support voice
- support browser automation
- support testing
- allow Antigravity to work systematically

---

# 2. Repository Strategy

LEO should initially use a **monorepo**.

Conceptually:

```text
leo/
├── apps/
├── packages/
├── workers/
├── infrastructure/
├── tests/
├── scripts/
├── docs/
└── config/

```

The repository should preserve the useful OwnPilot package organization while introducing clear LEO-owned boundaries.

---

# 3. Top-Level Structure

```text
leo/
│
├── apps/
│   ├── web/
│   ├── gateway/
│   └── admin/
│
├── packages/
│   ├── core/
│   ├── agent/
│   ├── policy/
│   ├── permissions/
│   ├── approvals/
│   ├── tasks/
│   ├── workflows/
│   ├── tools/
│   ├── mcp/
│   ├── memory/
│   ├── social/
│   ├── media/
│   ├── browser/
│   ├── computer/
│   ├── voice/
│   ├── email/
│   ├── notifications/
│   ├── credentials/
│   ├── audit/
│   ├── database/
│   ├── events/
│   ├── realtime/
│   ├── providers/
│   ├── shared/
│   └── config/
│
├── workers/
│   ├── agent-worker/
│   ├── task-worker/
│   ├── workflow-worker/
│   ├── social-worker/
│   ├── media-worker/
│   ├── analytics-worker/
│   ├── notification-worker/
│   └── maintenance-worker/
│
├── infrastructure/
│   ├── docker/
│   ├── postgres/
│   ├── redis/
│   ├── object-storage/
│   ├── monitoring/
│   └── deployment/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   ├── agent-evals/
│   ├── provider/
│   └── fixtures/
│
├── scripts/
│
├── docs/
│
├── config/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md

```

---

# 4. `apps/`

Application entry points belong under `apps/`.

Business logic must remain inside packages rather than becoming tightly coupled to an application.

---

# 5. Web Application

```text
apps/web/
├── app/
├── components/
├── features/
├── hooks/
├── lib/
├── stores/
├── styles/
├── public/
└── tests/

```

Responsibilities:

- chat UI
- task dashboard
- agent dashboard
- approval center
- social calendar
- media library
- analytics
- memory UI
- settings
- voice interface
- computer-use interface
- notifications
- realtime event display

The web application should call the API rather than directly accessing the database.

---

# 6. Gateway

```text
apps/gateway/
├── routes/
├── middleware/
├── controllers/
├── serializers/
├── websocket/
├── openapi/
└── server.ts

```

Responsibilities:

- HTTP API
- WebSocket
- authentication middleware
- request validation
- request IDs
- API serialization
- API error handling
- OpenAPI generation

The gateway must remain thin.

---

# 7. Admin Application

```text
apps/admin/
├── app/
├── components/
├── features/
└── lib/

```

Optional separate administrative interface.

Potential functionality:

- system health
- provider health
- worker status
- audit investigation
- queue inspection
- security events
- system configuration

Normal users must not automatically receive admin access.

---

# 8. Core Package

```text
packages/core/
├── agent/
├── tools/
├── plugins/
├── workflows/
├── memory/
├── events/
├── sandbox/
├── scheduler/
└── index.ts

```

This contains the adapted OwnPilot foundation.

LEO should avoid unnecessarily rewriting stable OwnPilot infrastructure.

---

# 9. Agent Package

```text
packages/agent/
├── orchestrator/
├── planner/
├── executor/
├── context/
├── runs/
├── checkpoints/
├── autonomy/
├── delegation/
├── prompts/
├── state/
└── index.ts

```

Responsibilities:

- intent handling
- planning
- execution
- agent lifecycle
- context management
- delegation
- checkpoints
- autonomous runs
- run cancellation

---

# 10. Policy Package

```text
packages/policy/
├── engine/
├── rules/
├── evaluators/
├── risk/
├── decisions/
├── resources/
├── actions/
├── capabilities/
└── index.ts

```

This is one of LEO's most important packages.

The policy engine decides:

```text
ALLOW
DENY
APPROVAL_REQUIRED

```

The LLM does not make the final authorization decision.

---

# 11. Permissions

```text
packages/permissions/
├── roles/
├── permissions/
├── scopes/
├── capability-leases/
├── resource-access/
└── index.ts

```

Responsibilities:

- RBAC
- ABAC
- capability scopes
- resource restrictions
- temporary capability leases

---

# 12. Approval System

```text
packages/approvals/
├── engine/
├── policies/
├── requests/
├── resolution/
├── expiration/
└── index.ts

```

Handles:

- approval creation
- approval UI data
- approval resolution
- expiration
- cancellation
- binding approval to exact actions

---

# 13. Task System

```text
packages/tasks/
├── models/
├── service/
├── lifecycle/
├── planning/
├── cancellation/
├── retries/
├── leases/
└── index.ts

```

Task states:

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

---

# 14. Workflow System

```text
packages/workflows/
├── definitions/
├── engine/
├── triggers/
├── steps/
├── validation/
├── scheduler/
└── index.ts

```

Supports:

- scheduled workflows
- event-triggered workflows
- conditional workflows
- multi-step workflows
- retries
- failure handling

---

# 15. Tool System

```text
packages/tools/
├── registry/
├── definitions/
├── execution/
├── validation/
├── permissions/
├── trust/
├── sandbox/
├── built-in/
└── index.ts

```

Tool execution path:

```text
Tool Request
    ↓
Validation
    ↓
Authorization
    ↓
Policy
    ↓
Approval
    ↓
Execution
    ↓
Audit

```

---

# 16. MCP Package

```text
packages/mcp/
├── client/
├── server/
├── registry/
├── discovery/
├── permissions/
├── security/
├── adapters/
└── index.ts

```

MCP must not bypass LEO policy.

External MCP tools are treated as untrusted until explicitly trusted.

---

# 17. Memory

```text
packages/memory/
├── storage/
├── retrieval/
├── embeddings/
├── ranking/
├── summarization/
├── privacy/
├── lifecycle/
└── index.ts

```

Memory types may include:

```text
EPISODIC
SEMANTIC
PREFERENCE
TASK
PROFILE
SYSTEM

```

---

# 18. Social Package

```text
packages/social/
├── domain/
├── accounts/
├── content/
├── variants/
├── scheduling/
├── publishing/
├── reconciliation/
├── analytics/
├── seo/
├── policies/
├── providers/
└── index.ts

```

Provider implementations:

```text
packages/social/providers/
├── instagram/
├── tiktok/
├── youtube/
├── facebook/
├── linkedin/
├── x/
├── threads/
└── pinterest/

```

Provider availability must be capability-driven rather than assumed.

---

# 19. Social SEO

```text
packages/social/seo/
├── analyzer/
├── keywords/
├── platform-rules/
├── generators/
├── validators/
├── scoring/
└── index.ts

```

Pipeline:

```text
Media
 ↓
Transcript / OCR
 ↓
Topic extraction
 ↓
Entity extraction
 ↓
Audience analysis
 ↓
Keyword research
 ↓
Platform-specific generation
 ↓
Validation
 ↓
Draft

```

LEO must not use one generic caption for every platform.

---

# 20. Media Package

```text
packages/media/
├── uploads/
├── storage/
├── metadata/
├── transcoding/
├── thumbnails/
├── analysis/
├── transcription/
├── ocr/
├── moderation/
└── index.ts

```

---

# 21. Browser Package

```text
packages/browser/
├── providers/
├── sessions/
├── navigation/
├── extraction/
├── actions/
├── security/
└── index.ts

```

Initial implementation:

```text
Playwright

```

Browser sessions must be isolated.

---

# 22. Computer Package

```text
packages/computer/
├── provider/
├── router/
├── sessions/
├── actions/
├── permissions/
├── local/
├── cloud/
├── screenshots/
├── security/
└── index.ts

```

Provider abstraction:

```text
ComputerUseProvider
       │
       ├── QwenLocalProvider
       └── E2BCloudProvider

```

---

# 23. Local Computer Provider

```text
packages/computer/local/
└── qwen/
    ├── client/
    ├── adapter/
    ├── capabilities/
    └── security/

```

The Qwen implementation should remain replaceable.

---

# 24. Cloud Computer Provider

```text
packages/computer/cloud/
└── e2b/
    ├── client/
    ├── sessions/
    ├── adapter/
    └── security/

```

Cloud execution is preferred for high-risk or isolated autonomous tasks where appropriate.

---

# 25. Voice Package

```text
packages/voice/
├── provider/
├── sessions/
├── realtime/
├── tools/
├── transcripts/
├── audio/
├── wake-word/
└── index.ts

```

Initial provider:

```text
OpenAI Realtime

```

Future:

```text
Local STT
Local TTS
Local wake word

```

---

# 26. Email

```text
packages/email/
├── providers/
├── compose/
├── send/
├── receive/
├── attachments/
├── security/
└── index.ts

```

Sending email is a consequential action and must pass policy.

---

# 27. Notifications

```text
packages/notifications/
├── service/
├── channels/
├── templates/
├── preferences/
└── index.ts

```

Possible channels:

```text
Web
Email
Push
Telegram

```

---

# 28. Credentials

```text
packages/credentials/
├── vault/
├── encryption/
├── oauth/
├── tokens/
├── rotation/
├── scopes/
└── index.ts

```

Critical rule:

```text
Application code requests credential usage.
It should not freely retrieve raw secrets.

```

---

# 29. Audit

```text
packages/audit/
├── ledger/
├── hashing/
├── verification/
├── redaction/
├── events/
└── index.ts

```

The Action Ledger records consequential operations.

---

# 30. Database

```text
packages/database/
├── client/
├── schema/
├── migrations/
├── repositories/
├── transactions/
├── rls/
└── index.ts

```

Database:

```text
PostgreSQL

```

Optional:

```text
pgvector

```

---

# 31. Events

```text
packages/events/
├── definitions/
├── bus/
├── publishers/
├── consumers/
├── serialization/
└── index.ts

```

Events should be typed.

Example:

```text
TaskCompleted
ApprovalCreated
SocialPostPublished
MediaReady
AgentFailed

```

---

# 32. Realtime

```text
packages/realtime/
├── websocket/
├── subscriptions/
├── authorization/
├── events/
└── index.ts

```

Realtime events must be filtered according to user/workspace access.

---

# 33. Provider Abstraction

```text
packages/providers/
├── ai/
├── social/
├── voice/
├── browser/
├── computer/
├── email/
├── storage/
└── index.ts

```

Provider implementations should be replaceable.

---

# 34. Shared Package

```text
packages/shared/
├── types/
├── schemas/
├── errors/
├── constants/
├── ids/
├── dates/
├── logging/
└── index.ts

```

Contains reusable primitives only.

Do not turn `shared` into a dumping ground.

---

# 35. Configuration

```text
packages/config/
├── environment/
├── validation/
├── defaults/
└── index.ts

```

All environment variables should be validated at startup.

---

# 36. Worker Architecture

Workers execute asynchronous workloads.

```text
workers/
├── agent-worker/
├── task-worker/
├── workflow-worker/
├── social-worker/
├── media-worker/
├── analytics-worker/
├── notification-worker/
└── maintenance-worker/

```

---

# 37. Agent Worker

Handles:

- agent execution
- planning
- tool orchestration
- checkpoints
- cancellation

---

# 38. Task Worker

Handles:

- queued tasks
- task steps
- retries
- execution leases
- timeouts

---

# 39. Workflow Worker

Handles:

- workflow execution
- triggers
- scheduled runs
- workflow retries

---

# 40. Social Worker

Handles:

- publishing
- scheduling
- reconciliation
- provider polling
- webhook processing
- analytics synchronization

---

# 41. Media Worker

Handles:

- transcoding
- thumbnails
- transcription
- OCR
- media analysis

---

# 42. Analytics Worker

Handles:

- provider analytics ingestion
- normalization
- aggregation
- periodic synchronization

---

# 43. Notification Worker

Handles:

- queued notifications
- delivery
- retries
- notification preferences

---

# 44. Maintenance Worker

Handles:

- cleanup
- expired sessions
- expired approvals
- stale leases
- old temporary files
- consistency checks
- audit verification

---

# 45. Infrastructure

```text
infrastructure/
├── docker/
│   ├── gateway/
│   ├── workers/
│   └── development/
│
├── postgres/
│   ├── migrations/
│   └── initialization/
│
├── redis/
│
├── object-storage/
│
├── monitoring/
│   ├── metrics/
│   ├── logs/
│   └── tracing/
│
└── deployment/
    ├── local/
    ├── cloud/
    └── hybrid/

```

---

# 46. Testing Structure

```text
tests/
├── unit/
├── integration/
├── e2e/
├── security/
├── agent-evals/
├── provider/
└── fixtures/

```

---

# 47. Unit Tests

Test isolated:

- policy rules
- permission evaluation
- task state machines
- validators
- providers
- serializers
- schemas
- utility functions

---

# 48. Integration Tests

Test:

```text
API
 ↓
Service
 ↓
Database

```

and:

```text
Task
 ↓
Worker
 ↓
Provider

```

---

# 49. End-to-End Tests

Examples:

```text
Login
 ↓
Create task
 ↓
Agent plans
 ↓
Approval requested
 ↓
User approves
 ↓
Tool executes
 ↓
Task completes
 ↓
Audit created

```

---

# 50. Security Tests

Must include:

- authorization bypass
- IDOR
- SSRF
- DNS rebinding
- prompt injection
- tool injection
- credential leakage
- cross-workspace access
- malicious webhook
- MCP abuse
- computer-use escalation
- shell escape
- path traversal
- rate-limit bypass

---

# 51. Agent Evaluations

Agent-specific evaluation datasets should test:

- correct intent
- planning quality
- tool selection
- policy compliance
- refusal of unsafe actions
- prompt injection resistance
- recovery
- cancellation
- approval handling
- hallucination control

---

# 52. Provider Tests

Every provider should have:

```text
Capability tests
Authentication tests
Validation tests
Publish tests
Error tests
Rate-limit tests
Retry tests
Reconciliation tests

```

Provider APIs should be mocked for deterministic CI tests.

---

# 53. Documentation

```text
docs/
├── product/
├── architecture/
├── security/
├── api/
├── database/
├── integrations/
├── operations/
├── development/
├── testing/
└── decisions/

```

---

# 54. Architecture Decision Records

```text
docs/decisions/
├── ADR-001-ownpilot-foundation.md
├── ADR-002-postgresql.md
├── ADR-003-policy-engine.md
├── ADR-004-provider-abstraction.md
├── ADR-005-computer-use.md
├── ADR-006-social-architecture.md
├── ADR-007-voice.md
└── ADR-008-audit-ledger.md

```

New architectural decisions must be documented as ADRs.

---

# 55. Configuration Files

Root configuration:

```text
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.json
.env.example
.editorconfig
.gitignore

```

CI configuration should be added separately.

---

# 56. Dependency Rules

Dependency direction should generally be:

```text
apps
 ↓
services/packages
 ↓
domain
 ↓
shared

```

Lower-level packages must not depend on application entry points.

---

# 57. Security Dependency Rules

Security-critical packages should have restricted dependencies.

For example:

```text
policy
permissions
credentials
audit

```

must not depend on UI packages.

---

# 58. Provider Dependency Rules

Provider SDKs should remain inside their adapter packages.

Example:

```text
social/providers/tiktok/

```

may depend on TikTok SDK/API code.

Core agent code should not directly import TikTok SDKs.

---

# 59. Computer Security Boundary

Computer-use implementations must never be imported directly into:

```text
packages/agent/
packages/policy/

```

Instead:

```text
Agent
 ↓
Tool
 ↓
Policy
 ↓
ComputerProvider
 ↓
Qwen/E2B

```

---

# 60. Social Security Boundary

Social providers follow:

```text
Social Service
 ↓
Policy
 ↓
Credential Scope
 ↓
Provider Adapter
 ↓
External Platform

```

---

# 61. Credential Boundary

Only credential services should communicate directly with the credential vault.

Providers should receive narrowly scoped credential material only when necessary.

---

# 62. Database Boundary

Only database/repository packages should access PostgreSQL.

Avoid direct database access from:

```text
apps/web
apps/gateway
workers

```

except through approved repository/service layers.

---

# 63. Object Storage Boundary

Media objects should use an object-storage abstraction.

The rest of the application should not depend directly on a specific storage vendor.

---

# 64. Queue Boundary

Workers consume jobs through a queue abstraction.

Example:

```text
TaskService
 ↓
Queue
 ↓
TaskWorker

```

The API must not execute long-running work synchronously.

---

# 65. Logging

Centralized logging should support:

```text
requestId
userId
workspaceId
taskId
agentId
runId
toolExecutionId
provider
severity
timestamp

```

Sensitive values must be redacted.

---

# 66. Observability

LEO should expose:

```text
Metrics
Logs
Traces
Audit
Provider health
Worker health
Queue health

```

These are separate concerns.

---

# 67. Local Development

Expected developer flow:

```text
pnpm install

pnpm dev

```

Development infrastructure:

```text
PostgreSQL
Redis
Object Storage
LEO Gateway
LEO Web
Workers

```

should be easy to start locally.

---

# 68. Docker Development

A development compose environment should eventually provide:

```text
postgres
redis
object-storage
gateway
web
workers

```

Computer-use runtimes may remain separate from the main compose stack.

---

# 69. Production Deployment

Production may use:

```text
Web
Gateway
Workers
PostgreSQL
Redis
Object Storage
Observability

```

with computer-use infrastructure isolated separately.

---

# 70. Hybrid Deployment

LEO should support:

```text
User
 ↓
Cloud LEO
 ↓
Secure connection
 ↓
Local LEO Agent / Computer Runtime
 ↓
User's PC

```

This enables remote control without exposing the user's computer directly to the public internet.

---

# 71. Repository Ownership Model

Suggested ownership:

```text
LEO Core
├── Agent
├── Policy
├── Permissions
├── Tasks
├── Workflows
├── Memory
├── Social
├── Computer
├── Voice
└── API

Foundation
└── Adapted OwnPilot infrastructure

External adapters
├── Social providers
├── Computer providers
├── Voice providers
├── Email providers
└── AI providers

```

---

# 72. What Antigravity May Change

Antigravity may:

- refactor implementation
- add files
- improve abstractions
- optimize performance
- replace internal implementation details
- add tests
- adapt OwnPilot modules

provided that documented contracts and security invariants remain intact.

---

# 73. What Antigravity Must Not Change Without Approval

Antigravity must not silently change:

- authorization model
- policy precedence
- credential security
- audit semantics
- database ownership boundaries
- API breaking contracts
- provider security scopes
- computer-use permission levels
- autonomy levels
- critical security invariants

Such changes require an ADR and architecture review.

---

# 74. Implementation Rule

Antigravity should implement from the inside out:

```text
Foundation
 ↓
Shared types
 ↓
Database
 ↓
Security
 ↓
Domain services
 ↓
Workers
 ↓
API
 ↓
Realtime
 ↓
Web UI
 ↓
Providers
 ↓
End-to-end workflows

```

---

# 75. Initial Implementation Order

Recommended first repository work:

```text
1. Fork/adapt OwnPilot
2. Establish LEO package boundaries
3. Establish PostgreSQL schema
4. Establish identity/auth
5. Establish Policy Engine
6. Establish permissions
7. Establish Action Ledger
8. Establish task lifecycle
9. Establish worker infrastructure
10. Establish API contracts
11. Establish realtime
12. Establish web shell
13. Establish social provider interface
14. Establish media pipeline
15. Establish computer provider
16. Establish browser provider
17. Establish voice provider
18. Establish integrations

```

---

# 76. Definition of Done

Repository structure is considered implemented when:

- monorepo builds
- package boundaries are enforced
- TypeScript references are correct
- lint passes
- typecheck passes
- tests execute
- database migrations execute
- gateway starts
- web application starts
- workers start
- health checks work
- OpenAPI generates
- CI validates the repository

---

# 77. Final Structure

The intended LEO architecture becomes:

```text
                         LEO
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
       WEB             GATEWAY            ADMIN
        │                 │
        └────────────┬────┘
                     ↓
              DOMAIN SERVICES
                     │
      ┌──────────────┼───────────────┐
      ↓              ↓               ↓
    AGENT          POLICY          TASKS
      │              │               │
      └──────────────┼───────────────┘
                     ↓
                 EXECUTION
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
     TOOLS          MCP         WORKFLOWS
       │             │             │
       └─────────────┼─────────────┘
                     ↓
                 PROVIDERS
                     │
       ┌───────┬─────┼─────┬────────┐
       ↓       ↓     ↓     ↓        ↓
     Social  Browser Computer Voice  Email
                     │
                ┌────┴────┐
                ↓         ↓
              Qwen       E2B
                │         │
             LOCAL      CLOUD

```

---

# 78. Architecture Boundary

The most important repository rule is:

```text
LEO owns:
    policy
    permissions
    orchestration
    contracts
    domain state
    audit
    security

Providers own:
    provider-specific implementation

OwnPilot provides:
    foundational agent infrastructure

Workers own:
    asynchronous execution

```

This prevents LEO from becoming a collection of tightly coupled integrations.

---

# 79. Repository Baseline

The repository structure is now considered the baseline for implementation planning.

The next document should translate this structure into an executable development sequence:

`LEO_IMPLEMENTATION_ROADMAP.md`

That roadmap will define:

- Phase 0
- Phase 1 MVP
- Phase 2
- Phase 3
- milestones
- dependencies
- implementation order
- testing gates
- security gates
- provider rollout
- deployment milestones
- definition of done
- Antigravity checkpoints

After the roadmap, the final implementation document will be:

`ANTIGRAVITY_IMPLEMENTATION_SPEC.md`
