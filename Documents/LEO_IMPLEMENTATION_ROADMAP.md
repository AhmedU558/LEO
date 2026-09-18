# LEO

## Implementation Roadmap v1.0

**Project:** LEO — Autonomous Personal AI Operating System  
**Document:** Implementation Roadmap  
**Version:** 1.0  
**Status:** Implementation Baseline  
**Foundation:** OwnPilot  
**Primary Implementation Agent:** Antigravity  
**Date:** September 18, 2026

---

# 1. Purpose

This roadmap defines the implementation sequence for LEO.

The objective is not to build every feature simultaneously.

LEO will be developed in controlled phases:

```text
Foundation
   ↓
Security
   ↓
Core Execution
   ↓
Product UI
   ↓
Social Automation
   ↓
Computer / Browser
   ↓
Voice
   ↓
Advanced Autonomy
   ↓
Production Hardening

```

Every phase has:

- implementation objectives
- dependencies
- deliverables
- tests
- security gates
- acceptance criteria

---

# 2. Implementation Philosophy

LEO must be built as a real product rather than a collection of scripts.

The core principle is:

```text
Understand
    ↓
Plan
    ↓
Authorize
    ↓
Execute
    ↓
Verify
    ↓
Record
    ↓
Learn

```

No major subsystem should bypass this lifecycle.

---

# 3. Foundation

LEO will use:

```text
OwnPilot
   +
LEO Product Layer
   +
LEO Security Layer
   +
LEO Provider Layer

```

OwnPilot remains responsible for reusable foundational infrastructure.

LEO owns product-specific behavior.

---

# 4. Development Phases

```text
PHASE 0  Foundation & Repository
PHASE 1  Security & Identity
PHASE 2  Core Agent Platform
PHASE 3  Task & Workflow Engine
PHASE 4  LEO Web Product
PHASE 5  Social Automation MVP
PHASE 6  Browser & Computer Use
PHASE 7  Voice
PHASE 8  Advanced Autonomy
PHASE 9  Analytics & Learning
PHASE 10 Production Hardening
PHASE 11 Production Release

```

---

# 5. Phase 0 — Foundation & Repository

## Objective

Create the LEO development foundation without changing product behavior unnecessarily.

## Tasks

1. Fork/adapt OwnPilot.
2. Create LEO repository.
3. Establish monorepo.
4. Establish package boundaries.
5. Establish TypeScript configuration.
6. Establish pnpm workspace.
7. Establish Turbo/build pipeline.
8. Establish local development environment.
9. Establish PostgreSQL.
10. Establish Redis/queue infrastructure.
11. Establish object storage.
12. Establish test infrastructure.
13. Establish CI.

---

## Deliverables

```text
Repository
Development environment
Build system
Database connection
Queue connection
Storage abstraction
Testing framework
CI pipeline

```

---

## Gate

Must pass:

```text
pnpm install
pnpm build
pnpm typecheck
pnpm test

```

---

# 6. Phase 1 — Security & Identity

## Objective

Establish LEO's security foundation before autonomous execution.

---

## 6.1 Identity

Implement:

- users
- workspaces
- sessions
- devices
- authentication
- password management
- API authentication

---

## 6.2 Authorization

Implement:

```text
RBAC
+
ABAC
+
Capabilities
+
Resource scopes

```

---

## 6.3 Policy Engine

Implement:

```text
PolicyRequest
PolicyDecision
PolicyRule
RiskAssessment

```

Decisions:

```text
ALLOW
DENY
APPROVAL_REQUIRED

```

---

## 6.4 Approval Engine

Implement:

- approval requests
- approval expiration
- approval cancellation
- approval binding
- approval audit

---

## 6.5 Credential Security

Implement:

- encrypted credential storage
- OAuth state
- credential scopes
- token expiration
- credential revocation

---

## 6.6 Action Ledger

Implement:

```text
Audit Event
Hash Chain
Verification
Redaction

```

---

## Security Gate

The following must pass before Phase 2:

```text
No unauthorized resource access
No credential leakage
Policy cannot be bypassed
Approval cannot be bypassed
Audit events are generated
Cross-user access is denied

```

---

# 7. Phase 2 — Core Agent Platform

## Objective

Create LEO's controlled agent execution layer.

---

## Components

```text
Agent
AgentConfig
AgentRun
Planner
Executor
Context
Tool Registry
Tool Execution
Memory

```

---

## 7.1 Agent Lifecycle

Implement:

```text
CREATED
READY
RUNNING
PAUSED
WAITING_APPROVAL
COMPLETED
FAILED
CANCELLED
DISABLED

```

---

## 7.2 Intent Processing

Input:

```text
User message

```

Output:

```text
Intent
Entities
Constraints
Desired outcome

```

---

## 7.3 Planning

The planner produces:

```text
Goal
Steps
Required tools
Required permissions
Potential risks
Expected outputs

```

The plan must be validated before execution.

---

## 7.4 Tool Registry

Implement:

- tool discovery
- schemas
- trust level
- source
- capability requirements
- confirmation requirements
- execution metadata

---

## 7.5 Tool Execution

Implement:

```text
Validate
 ↓
Authorize
 ↓
Policy
 ↓
Approval
 ↓
Execute
 ↓
Verify
 ↓
Audit

```

---

## Gate

LEO should successfully perform:

```text
User
 ↓
Intent
 ↓
Plan
 ↓
Tool
 ↓
Policy
 ↓
Execution
 ↓
Result
 ↓
Audit

```

without social/computer integrations yet.

---

# 8. Phase 3 — Task & Workflow Engine

## Objective

Transform individual agent interactions into durable autonomous work.

---

## Task System

Implement:

- tasks
- task steps
- task states
- priorities
- retries
- timeouts
- cancellation
- pause/resume
- execution leases

---

## Worker System

Implement:

```text
Agent Worker
Task Worker
Workflow Worker
Maintenance Worker

```

---

## Queue

Implement:

```text
Queue
Retry
Backoff
Dead Letter
Concurrency Limits
Worker Lease

```

---

## Scheduler

Implement:

- one-time jobs
- recurring jobs
- cron-like schedules
- timezone support
- missed-job handling

---

## Workflow Engine

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

---

## Gate

A workflow such as:

```text
Every morning
 ↓
Run research task
 ↓
Analyze results
 ↓
Generate summary
 ↓
Notify user

```

must execute reliably without the web UI remaining open.

---

# 9. Phase 4 — LEO Web Product

## Objective

Turn the backend into a usable AI command center.

---

# 9.1 Main Interface

Build:

```text
Sidebar
Conversation
Agent status
Task trace
Approvals
Notifications

```

---

# 9.2 Command Center

User should be able to see:

```text
What LEO is doing
Why it is doing it
What it needs
What has completed
What failed

```

---

# 9.3 Task Dashboard

Display:

- active tasks
- queued tasks
- completed tasks
- failed tasks
- approvals
- scheduled tasks

---

# 9.4 Agent Dashboard

Display:

- agents
- autonomy levels
- current runs
- permissions
- budgets
- recent activity

---

# 9.5 Approval Center

Display:

```text
Action
Reason
Agent
Resource
Risk
Requested permission
Approve
Deny

```

---

# 9.6 Memory Interface

Users should be able to inspect and control relevant memory.

---

# 9.7 Settings

Include:

- account
- security
- integrations
- AI providers
- permissions
- autonomy
- notifications
- privacy

---

# 9.8 Realtime

Connect:

```text
WebSocket
 ↓
Task events
Agent events
Approval events
Notifications

```

---

# 10. Phase 5 — Social Automation MVP

## Objective

Deliver LEO's first major autonomous product capability.

Initial platforms:

```text
Instagram
TikTok
YouTube

```

Facebook can follow immediately after the foundational provider architecture is stable.

---

# 10.1 Social Accounts

Implement:

```text
Connect
Disconnect
Refresh
Capabilities
Credential status

```

---

# 10.2 Media Pipeline

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

---

# 10.3 Content Concept

User can provide:

```text
Video
Image
Idea
Prompt
Existing content

```

LEO creates a platform-neutral content concept.

---

# 10.4 Platform-Specific SEO

Pipeline:

```text
Media Analysis
 ↓
Topic
 ↓
Entities
 ↓
Audience
 ↓
Keywords
 ↓
Platform Rules
 ↓
SEO Variant

```

Generate separate variants for:

```text
Instagram
TikTok
YouTube

```

---

# 10.5 Draft Workflow

Default:

```text
Generate
 ↓
Draft
 ↓
Review
 ↓
Approve
 ↓
Schedule/Publish

```

LEO should not silently publish merely because content generation succeeded.

---

# 10.6 Scheduling

Implement:

- timezone
- scheduledAt
- provider validation
- collision handling
- cancellation
- rescheduling

---

# 10.7 Publishing

Publishing must be asynchronous.

```text
POST
 ↓
Policy
 ↓
Approval
 ↓
Queue
 ↓
Provider
 ↓
Provider Response
 ↓
Verification
 ↓
Reconciliation
 ↓
Audit

```

---

# 10.8 Analytics

Initial analytics:

```text
Views
Likes
Comments
Shares
Watch time where available
Engagement

```

Provider limitations must be preserved rather than fabricated.

---

# 10.9 Social Gate

A complete workflow must work:

```text
Upload video
 ↓
Analyze
 ↓
Generate platform-specific SEO
 ↓
Create drafts
 ↓
Approve
 ↓
Schedule
 ↓
Publish
 ↓
Verify
 ↓
Collect analytics

```

---

# 11. Phase 6 — Browser & Computer Use

## Objective

Give LEO controlled interaction with browsers and computers.

---

# 11.1 Browser

Implement:

```text
BrowserProvider
BrowserSession
Navigation
Extraction
Controlled Actions

```

Initial implementation:

```text
Playwright

```

---

# 11.2 Computer Provider

Implement:

```text
ComputerUseProvider
ComputerRouter
ComputerSession
ComputerAction

```

Initial local provider:

```text
Qwen Computer Use

```

Cloud provider:

```text
E2B Computer

```

---

# 11.3 Permission Levels

```text
READ_ONLY
 ↓
BROWSER_ONLY
 ↓
APP_CONTROL
 ↓
FILE_OPERATIONS
 ↓
SHELL_COMMANDS
 ↓
SYSTEM_CONTROL

```

---

# 11.4 Local Computer

Use cases:

```text
Open application
Search browser
Read visible information
Interact with UI
Perform approved desktop workflows

```

---

# 11.5 Cloud Computer

Use cases:

```text
Research
Isolated browser tasks
Long-running automation
Untrusted websites
Remote execution

```

---

# 11.6 Computer Security Gate

Before release:

- screenshot privacy controls
- application allowlists where appropriate
- action policy
- shell restrictions
- filesystem restrictions
- cancellation
- timeout
- emergency stop
- audit

must be tested.

---

# 12. Phase 7 — Voice

## Objective

Provide Siri/Alexa-like interaction with LEO.

---

# 12.1 Voice MVP

Implement:

```text
Voice session
 ↓
Speech
 ↓
LEO
 ↓
Tool execution
 ↓
Spoken response

```

---

# 12.2 Initial Provider

Use:

```text
OpenAI Realtime

```

through a provider abstraction.

---

# 12.3 Voice Tools

Only expose narrow application-owned tools.

Voice must not receive unrestricted system capabilities.

---

# 12.4 Future Local Voice

Potential components:

```text
Local STT
Local TTS
Wake word
VAD
Smart turn detection

```

These should remain optional.

---

# 13. Phase 8 — Advanced Autonomy

## Objective

Move from task automation to persistent autonomous agents.

---

# 13.1 Autonomy Levels

```text
LEVEL 0
Manual

LEVEL 1
Suggest

LEVEL 2
Execute approved tasks

LEVEL 3
Autonomous low-risk tasks

LEVEL 4
Autonomous workflows with bounded permissions

LEVEL 5
Persistent autonomous operation

```

---

# 13.2 Autonomous Agents

Implement:

- heartbeat
- schedules
- goals
- task queues
- budgets
- quiet hours
- autonomy policy
- failure thresholds
- checkpointing
- learning/evolution records

---

# 13.3 Autonomous Budget

Every autonomous agent should have limits for:

```text
Time
Tokens
Cost
Tool calls
Provider calls
Concurrent tasks
Daily actions
Monthly actions

```

---

# 13.4 Runaway Protection

Automatically stop or pause agents when:

```text
Repeated failures
Unexpected cost
Excessive tool usage
Policy violations
Provider failures
Approval anomalies

```

---

# 14. Phase 9 — Analytics & Learning

## Objective

Create feedback loops without allowing uncontrolled self-modification.

---

# 14.1 Analytics

Track:

```text
Task success
Task duration
Tool success
Provider success
Social performance
Agent cost
Approval rate
Failure rate

```

---

# 14.2 Social Learning

Use analytics to identify patterns such as:

```text
Content type
Posting time
Platform
Topic
Hook
Caption
Hashtags
Audience response

```

LEO may generate recommendations or improved future variants.

---

# 14.3 Agent Learning

Store:

```text
Outcome
Error
Correction
Learning
Confidence
Source

```

Learned information must remain subject to validation.

---

# 15. Phase 10 — Production Hardening

## Objective

Make LEO safe and reliable for real-world deployment.

---

# 15.1 Security

Complete:

- penetration testing
- authorization testing
- SSRF testing
- prompt injection testing
- MCP security testing
- credential security testing
- computer-use security testing
- dependency audit

---

# 15.2 Reliability

Test:

- worker crash
- database outage
- Redis outage
- provider outage
- network timeout
- duplicate requests
- duplicate webhooks
- partial publishing
- task cancellation
- restart recovery

---

# 15.3 Observability

Implement:

```text
Metrics
Logs
Tracing
Alerts
Provider health
Worker health
Queue health

```

---

# 15.4 Disaster Recovery

Test:

```text
Backup
Restore
Database recovery
Object recovery
Audit recovery
Worker recovery

```

---

# 16. Phase 11 — Production Release

Production release requires:

```text
Security Gate
+
Reliability Gate
+
Performance Gate
+
API Gate
+
Database Gate
+
Provider Gate
+
UX Gate
+
Operational Gate

```

Only after all gates pass should LEO be considered production-ready.

---

# 17. MVP Definition

The first meaningful LEO MVP should contain:

```text
✓ Authentication
✓ Web UI
✓ Chat
✓ Agent runtime
✓ Memory
✓ Tasks
✓ Workflows
✓ Policy engine
✓ Permissions
✓ Approvals
✓ Action Ledger
✓ Email
✓ Media library
✓ Social accounts
✓ Instagram
✓ TikTok
✓ YouTube
✓ Platform-specific SEO
✓ Scheduling
✓ Browser
✓ Local computer use
✓ Voice
✓ Notifications

```

---

# 18. MVP Exclusions

The following should not block the first MVP:

```text
Advanced multi-agent societies
Full local voice stack
Every social platform
Complex team collaboration
Full mobile applications
IoT
Robotics
Advanced self-modification

```

These can follow after the core is stable.

---

# 19. Milestone Structure

Each milestone should produce a working system.

```text
M0 — Repository
M1 — Security
M2 — Agent
M3 — Tasks
M4 — Web
M5 — Social
M6 — Computer
M7 — Voice
M8 — Autonomy
M9 — Analytics
M10 — Production

```

---

# 20. Milestone M0

## Deliverable

Working repository.

Acceptance:

```text
Clone
 ↓
Install
 ↓
Configure
 ↓
Start
 ↓
Health check

```

---

# 21. Milestone M1

## Deliverable

Secure identity and authorization.

Acceptance:

```text
Login
Session
Workspace
Permission
Policy
Approval
Audit

```

---

# 22. Milestone M2

## Deliverable

Controlled agent.

Acceptance:

```text
Prompt
 ↓
Intent
 ↓
Plan
 ↓
Policy
 ↓
Tool
 ↓
Result

```

---

# 23. Milestone M3

## Deliverable

Durable asynchronous execution.

Acceptance:

```text
Task
 ↓
Queue
 ↓
Worker
 ↓
Execution
 ↓
Recovery

```

---

# 24. Milestone M4

## Deliverable

Usable LEO web command center.

Acceptance:

User can see and control:

```text
Chat
Tasks
Agents
Approvals
Notifications
Memory

```

---

# 25. Milestone M5

## Deliverable

Social automation.

Acceptance:

```text
Media
 ↓
SEO
 ↓
Draft
 ↓
Approval
 ↓
Schedule
 ↓
Publish
 ↓
Analytics

```

---

# 26. Milestone M6

## Deliverable

Controlled computer interaction.

Acceptance:

```text
Browser
Computer
Permission
Approval
Execution
Cancellation
Audit

```

---

# 27. Milestone M7

## Deliverable

Voice assistant.

Acceptance:

```text
Speak
 ↓
Understand
 ↓
Plan
 ↓
Authorize
 ↓
Execute
 ↓
Respond

```

---

# 28. Milestone M8

## Deliverable

Bounded autonomous agents.

Acceptance:

```text
Goal
 ↓
Schedule
 ↓
Heartbeat
 ↓
Plan
 ↓
Execute
 ↓
Monitor
 ↓
Stop/Complete

```

---

# 29. Milestone M9

## Deliverable

Feedback and analytics.

Acceptance:

LEO can measure:

```text
Success
Cost
Latency
Failures
Provider performance
Social performance

```

---

# 30. Milestone M10

## Deliverable

Production-ready system.

Acceptance:

All production gates pass.

---

# 31. Parallel Development

Some work may happen in parallel.

Example:

```text
Database
     ├─────────────┐
Security           │
     ├─────────────┤
Agent              │
     ├─────────────┤
Workers            │
     └─────────────┤
                   ↓
                  API
                   ↓
                  Web

```

Provider integrations should begin only after their abstraction contracts exist.

---

# 32. Critical Dependency Chain

The most important dependency chain is:

```text
Identity
 ↓
Authorization
 ↓
Policy
 ↓
Approval
 ↓
Tool Execution
 ↓
Task Engine
 ↓
Workers
 ↓
Providers
 ↓
Autonomy

```

Do not reverse this order for convenience.

---

# 33. Testing Strategy

Testing occurs continuously.

```text
Every package
    ↓
Unit tests

Every service
    ↓
Integration tests

Every major workflow
    ↓
E2E tests

Every security boundary
    ↓
Security tests

Every agent capability
    ↓
Agent evaluation

```

---

# 34. CI Pipeline

Target:

```text
Install
 ↓
Lint
 ↓
Typecheck
 ↓
Unit tests
 ↓
Integration tests
 ↓
Security tests
 ↓
Build
 ↓
Migration validation
 ↓
E2E

```

---

# 35. Pull Request Requirements

Every significant PR should contain:

```text
Purpose
Changes
Tests
Security impact
Migration impact
API impact
Rollback considerations

```

---

# 36. Database Migration Rules

Migrations must be:

- versioned
- deterministic
- reviewable
- reversible where practical
- tested

Production migrations must never be generated casually during deployment.

---

# 37. API Stability

Once an API reaches a released contract:

```text
Breaking change
     ↓
New API version

```

Do not silently break frontend consumers.

---

# 38. Provider Rollout Strategy

Social providers should be introduced incrementally:

```text
Provider Interface
 ↓
Mock Provider
 ↓
One Real Provider
 ↓
Production Test
 ↓
Second Provider
 ↓
Multi-provider Validation

```

This prevents provider-specific assumptions from contaminating the core architecture.

---

# 39. Failure Strategy

LEO should prefer:

```text
Safe failure

```

over:

```text
False success

```

For example:

If Instagram reports an uncertain publishing state:

```text
UNKNOWN

```

must remain:

```text
UNKNOWN

```

until reconciliation confirms the result.

It must not become:

```text
SUCCESS

```

just because the request was accepted.

---

# 40. Cancellation Strategy

Cancellation must propagate:

```text
User
 ↓
Task
 ↓
Agent Run
 ↓
Tool Execution
 ↓
Provider

```

Pending approvals associated with the cancelled execution must become invalid.

---

# 41. Emergency Stop

LEO must provide a kill mechanism capable of stopping autonomous execution.

At minimum:

```text
Pause agent
Cancel task
Stop workflow
Revoke capability
Disable autonomous execution

```

A global emergency lockdown should also be supported for authorized administrators.

---

# 42. Security Gates

Before enabling higher autonomy:

```text
LEVEL 0 → Basic security
LEVEL 1 → Policy
LEVEL 2 → Approval
LEVEL 3 → Audit + limits
LEVEL 4 → Strong isolation
LEVEL 5 → Full production security review

```

Autonomy level should never increase merely because the agent requests it.

---

# 43. Performance Targets

Initial engineering targets:

```text
API health response: <500 ms typical
Normal API response: <2 seconds typical
Realtime event latency: <1 second typical
Task queue startup: <5 seconds typical

```

Long-running AI/provider operations are exempt from synchronous response targets.

The final targets should be validated using real production-like workloads.

---

# 44. Cost Controls

Track:

```text
LLM tokens
LLM cost
Provider API usage
Media processing cost
Computer runtime
Storage
Bandwidth

```

Budgets should exist at:

```text
User
Workspace
Agent
Task
Provider

```

---

# 45. Release Strategy

Use staged releases:

```text
Development
 ↓
Internal Alpha
 ↓
Private Beta
 ↓
Limited Production
 ↓
General Production

```

---

# 46. Alpha

Focus:

```text
Core execution
Security
Tasks
Agents
Basic UI

```

No broad autonomous permissions.

---

# 47. Private Beta

Add:

```text
Social
Browser
Computer
Voice

```

with tightly controlled permissions.

---

# 48. Limited Production

Enable:

```text
Bounded autonomy
Real provider accounts
Scheduling
Analytics

```

with monitoring.

---

# 49. General Production

Enable the complete validated MVP capability set.

---

# 50. Antigravity Working Model

Antigravity should work in small implementation units.

Recommended cycle:

```text
Read specification
 ↓
Inspect existing code
 ↓
Plan change
 ↓
Implement
 ↓
Run tests
 ↓
Run security checks
 ↓
Review diff
 ↓
Commit
 ↓
Update documentation

```

---

# 51. Antigravity Must Not

Antigravity must not:

- rewrite OwnPilot unnecessarily
- bypass policy for convenience
- put secrets in source code
- hardcode provider credentials
- expose raw credentials to agents
- directly execute arbitrary shell commands from LLM output
- make publishing synchronous by default
- report unverified provider success
- disable security checks to make tests pass
- silently change frozen architecture
- remove failing tests instead of fixing the implementation

---

# 52. Implementation Checkpoint

Before each major phase:

```text
Architecture
✓

API
✓

Database
✓

Security
✓

Tests
✓

Dependencies
✓

```

Only then proceed.

---

# 53. Definition of Done

A feature is complete only when:

```text
Implementation
+
Tests
+
Security
+
API
+
Database
+
UI
+
Observability
+
Documentation

```

are complete where applicable.

---

# 54. Final Roadmap

```text
                    LEO
                     │
              ┌──────┴──────┐
              ↓             ↓
          FOUNDATION      SECURITY
              │             │
              └──────┬──────┘
                     ↓
                 AGENT CORE
                     ↓
              TASKS / WORKFLOWS
                     ↓
                 WEB PRODUCT
                     ↓
              SOCIAL AUTOMATION
                     ↓
            BROWSER / COMPUTER
                     ↓
                    VOICE
                     ↓
                AUTONOMY
                     ↓
                 ANALYTICS
                     ↓
            PRODUCTION HARDENING
                     ↓
                  RELEASE

```

---

# 55. Final Implementation Principle

LEO should not be built as:

```text
AI + lots of tools

```

It should be built as:

```text
                    LEO
                     │
                 Intelligence
                     │
              ┌──────┴──────┐
              ↓             ↓
           Planning       Memory
              │             │
              └──────┬──────┘
                     ↓
                Governance
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
   Permissions      Policy      Approvals
       │             │             │
       └─────────────┼─────────────┘
                     ↓
                  Execution
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
      Tools        Agents       Providers
        │            │            │
        └────────────┼────────────┘
                     ↓
                 Verification
                     ↓
                    Audit
                     ↓
                  Learning

```

The intelligence can become more capable over time without weakening the governance layer.

---

# 56. Roadmap Completion

The following documents now form the LEO architecture baseline:

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

The final planning document is now:

```text
ANTIGRAVITY_IMPLEMENTATION_SPEC.md

```

That document will be the **actual instruction set for Antigravity** and will contain:

- repository initialization instructions
- exact implementation sequence
- coding rules
- architecture constraints
- package responsibilities
- database implementation order
- API implementation order
- security implementation requirements
- testing requirements
- Git workflow
- commit strategy
- environment setup
- provider integration rules
- acceptance tests
- checkpoints
- instructions for inspecting OwnPilot before modifying it
- rules for using the audited open-source repositories
- explicit "do not do this" constraints
- Phase 0 implementation prompt
- phase-by-phase Antigravity execution protocol
