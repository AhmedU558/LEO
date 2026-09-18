# LEO

## API Contracts v1.0

**Project:** LEO — Autonomous Personal AI Operating System  
**Document:** API Contracts  
**Version:** 1.0  
**Status:** API Baseline  
**Date:** September 18, 2026

---

# 1. Purpose

This document defines the external and internal API contracts for LEO.

The API layer connects:

```text
LEO Web UI
     ↓
LEO Gateway
     ↓
Agent / Task / Workflow Services
     ↓
Tools / MCP / Providers
     ↓
External Systems

```

The API must provide a stable contract between frontend and backend while allowing internal implementation to evolve.

---

# 2. API Design Principles

LEO APIs SHALL follow:

- versioning
- explicit schemas
- authentication
- authorization
- validation
- consistent errors
- pagination
- idempotency where required
- auditability
- resource ownership
- safe defaults

---

# 3. Base URL

Initial API namespace:

```text
/api/v1

```

Examples:

```text
/api/v1/tasks
/api/v1/agents
/api/v1/social

```

Future breaking versions:

```text
/api/v2

```

---

# 4. Authentication

Authenticated requests should use the LEO session mechanism.

Browser clients should preferably use secure HTTP-only cookies.

API clients may use a securely managed API key mechanism where explicitly enabled.

---

# 5. Authorization

Authentication does not imply authorization.

Every protected request must evaluate:

```text
User
Workspace
Resource
Action
Agent
Capability
Policy

```

---

# 6. Standard Response Envelope

Successful responses may follow:

```json
{
  "data": {},
  "meta": {}
}

```

For collections:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 100
  }
}

```

---

# 7. Standard Error Format

Errors SHALL use a consistent structure:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task was not found.",
    "requestId": "req_123"
  }
}

```

Do not expose:

- stack traces
- credentials
- internal secrets
- sensitive infrastructure details

in production responses.

---

# 8. HTTP Status Codes

LEO should use conventional HTTP semantics.

```text
200 OK
201 CREATED
202 ACCEPTED
204 NO CONTENT

400 BAD REQUEST
401 UNAUTHORIZED
403 FORBIDDEN
404 NOT FOUND
409 CONFLICT
422 UNPROCESSABLE ENTITY
429 TOO MANY REQUESTS

500 INTERNAL SERVER ERROR
502 BAD GATEWAY
503 SERVICE UNAVAILABLE
504 GATEWAY TIMEOUT

```

---

# 9. Request IDs

Every request should receive a unique request ID.

Example:

```text
X-Request-ID: req_abc123

```

The request ID should be propagated into logs and relevant task/tool execution records.

---

# 10. Workspace Context

Workspace-scoped APIs should determine the workspace from authenticated context.

Do not trust arbitrary client-supplied ownership identifiers without authorization checks.

---

# 11. Pagination

Collection endpoints should support:

```text
page
pageSize

```

Future cursor pagination may be introduced for high-volume endpoints.

Maximum page size must be enforced server-side.

---

# 12. Filtering

Where appropriate:

```text
status
createdAfter
createdBefore
type
provider
agentId
taskId

```

All filter values must be validated.

---

# 13. Sorting

Supported sorting should be explicitly declared per endpoint.

Example:

```text
sort=created_at
order=desc

```

Do not allow arbitrary database expressions through query parameters.

---

# 14. Authentication APIs

## POST `/api/v1/auth/login`

Authenticate a user.

Request:

```json
{
  "email": "user@example.com",
  "password": "password"
}

```

Response:

```json
{
  "data": {
    "user": {},
    "session": {}
  }
}

```

---

## POST `/api/v1/auth/logout`

Invalidates the current session.

Response:

```text
204 No Content

```

---

## GET `/api/v1/auth/me`

Returns authenticated user context.

---

# 15. User APIs

## GET `/api/v1/users/me`

Returns current user profile.

---

## PATCH `/api/v1/users/me`

Updates allowed profile settings.

Example:

```json
{
  "displayName": "Ahmed",
  "timezone": "Asia/Karachi",
  "locale": "en"
}

```

---

# 16. Workspace APIs

## GET `/api/v1/workspaces`

Returns accessible workspaces.

---

## POST `/api/v1/workspaces`

Creates a workspace.

Request:

```json
{
  "name": "My Workspace",
  "timezone": "Asia/Karachi"
}

```

---

## GET `/api/v1/workspaces/:workspaceId`

Returns workspace details after authorization.

---

## PATCH `/api/v1/workspaces/:workspaceId`

Updates workspace configuration.

---

# 17. Conversation APIs

## POST `/api/v1/conversations`

Creates a conversation.

Request:

```json
{
  "title": "Social Planning"
}

```

---

## GET `/api/v1/conversations`

Lists conversations.

---

## GET `/api/v1/conversations/:conversationId`

Returns conversation metadata and messages.

---

## POST `/api/v1/conversations/:conversationId/messages`

Sends a message to LEO.

Request:

```json
{
  "content": "Prepare this video for TikTok and Instagram.",
  "attachments": []
}

```

Response:

```json
{
  "data": {
    "messageId": "msg_x",
    "taskId": "task_x",
    "status": "PROCESSING"
  }
}

```

---

# 18. Agent APIs

## GET `/api/v1/agents`

Lists agents.

---

## POST `/api/v1/agents`

Creates an agent.

Request:

```json
{
  "name": "Social Manager",
  "description": "Manages social publishing.",
  "autonomyLevel": 2,
  "instructions": "Manage my social content."
}

```

---

## GET `/api/v1/agents/:agentId`

Returns agent configuration.

---

## PATCH `/api/v1/agents/:agentId`

Updates allowed agent configuration.

---

## POST `/api/v1/agents/:agentId/pause`

Pauses an agent.

---

## POST `/api/v1/agents/:agentId/resume`

Resumes an agent.

---

## POST `/api/v1/agents/:agentId/disable`

Disables an agent.

---

## GET `/api/v1/agents/:agentId/runs`

Lists agent executions.

---

# 19. Agent Run API

## GET `/api/v1/agent-runs/:runId`

Returns execution information.

Example:

```json
{
  "data": {
    "id": "run_123",
    "status": "RUNNING",
    "taskId": "task_123",
    "startedAt": "..."
  }
}

```

---

# 20. Task APIs

## POST `/api/v1/tasks`

Creates a task.

Request:

```json
{
  "title": "Research RTX 5090",
  "description": "Research current benchmarks.",
  "agentId": "agent_123",
  "priority": "NORMAL"
}

```

---

## GET `/api/v1/tasks`

Lists tasks.

---

## GET `/api/v1/tasks/:taskId`

Returns task details.

---

## PATCH `/api/v1/tasks/:taskId`

Updates permitted task properties.

---

## POST `/api/v1/tasks/:taskId/cancel`

Cancels a task.

---

## POST `/api/v1/tasks/:taskId/pause`

Pauses a task where supported.

---

## POST `/api/v1/tasks/:taskId/resume`

Resumes a paused task.

---

# 21. Task Plan API

## GET `/api/v1/tasks/:taskId/plan`

Returns the current validated plan.

---

## POST `/api/v1/tasks/:taskId/replan`

Requests a new plan.

The resulting plan must pass policy validation before execution.

---

# 22. Task Steps

## GET `/api/v1/tasks/:taskId/steps`

Returns execution steps.

Example:

```json
{
  "data": [
    {
      "id": "step_1",
      "name": "Analyze media",
      "status": "COMPLETED"
    },
    {
      "id": "step_2",
      "name": "Generate SEO",
      "status": "RUNNING"
    }
  ]
}

```

---

# 23. Workflow APIs

## GET `/api/v1/workflows`

Lists workflows.

---

## POST `/api/v1/workflows`

Creates a workflow.

Request:

```json
{
  "name": "Daily Social Report",
  "definition": {}
}

```

---

## GET `/api/v1/workflows/:workflowId`

Returns workflow details.

---

## PATCH `/api/v1/workflows/:workflowId`

Updates workflow configuration.

---

## POST `/api/v1/workflows/:workflowId/enable`

Enables a workflow.

---

## POST `/api/v1/workflows/:workflowId/disable`

Disables a workflow.

---

## POST `/api/v1/workflows/:workflowId/run`

Manually executes a workflow.

Returns:

```text
202 Accepted

```

with a task/run reference.

---

# 24. Approval APIs

## GET `/api/v1/approvals`

Lists pending/resolved approvals according to authorized scope.

---

## GET `/api/v1/approvals/:approvalId`

Returns approval details.

---

## POST `/api/v1/approvals/:approvalId/approve`

Approves the exact bound action.

---

## POST `/api/v1/approvals/:approvalId/deny`

Denies the action.

---

## POST `/api/v1/approvals/:approvalId/cancel`

Cancels the approval where authorized.

---

# 25. Approval Response

Approval resolution should return:

```json
{
  "data": {
    "approvalId": "approval_123",
    "status": "APPROVED",
    "taskId": "task_123"
  }
}

```

The executor must revalidate policy before execution.

---

# 26. Permission APIs

## GET `/api/v1/permissions`

Lists permissions visible to the authenticated user.

---

## POST `/api/v1/permissions`

Creates a permission.

Request:

```json
{
  "subjectType": "AGENT",
  "subjectId": "agent_123",
  "capability": "social.publish",
  "resourceType": "social_account",
  "resourceId": "account_123",
  "effect": "ALLOW",
  "requiresApproval": true
}

```

---

## DELETE `/api/v1/permissions/:permissionId`

Revokes a permission.

---

# 27. Capability Lease APIs

## GET `/api/v1/capability-leases`

Lists active leases where authorized.

---

## POST `/api/v1/capability-leases/:leaseId/revoke`

Revokes a temporary capability.

---

# 28. Tool APIs

## GET `/api/v1/tools`

Lists tools visible to the current context.

Tool visibility must be filtered by authorization.

---

## GET `/api/v1/tools/:toolId`

Returns tool metadata.

---

## POST `/api/v1/tools/:toolId/execute`

Direct tool execution should be highly restricted.

The request must pass through:

```text
Authentication
Authorization
Policy
Risk
Approval
Execution
Audit

```

---

# 29. MCP APIs

## GET `/api/v1/mcp/servers`

Lists configured MCP servers.

---

## POST `/api/v1/mcp/servers`

Registers an MCP server.

---

## GET `/api/v1/mcp/servers/:serverId`

Returns server information.

---

## POST `/api/v1/mcp/servers/:serverId/disable`

Disables an MCP server.

---

# 30. Integration APIs

## GET `/api/v1/integrations`

Lists connected integrations.

---

## GET `/api/v1/integrations/:integrationId`

Returns integration information.

---

## POST `/api/v1/integrations/:provider/connect`

Begins provider authentication.

---

## DELETE `/api/v1/integrations/:integrationId`

Disconnects an integration.

---

# 31. OAuth Callback

Provider callbacks should use dedicated routes.

Conceptually:

```text
/api/v1/oauth/:provider/callback

```

OAuth state must be validated.

---

# 32. Credential APIs

Raw credentials SHALL NOT be returned through ordinary API responses.

## GET `/api/v1/credentials`

Returns safe credential metadata.

Example:

```json
{
  "data": [
    {
      "id": "cred_123",
      "provider": "google",
      "status": "ACTIVE",
      "expiresAt": "..."
    }
  ]
}

```

---

## DELETE `/api/v1/credentials/:credentialId`

Revokes/removes a credential where authorized.

---

# 33. Social Account APIs

## GET `/api/v1/social/accounts`

Lists connected social accounts.

---

## GET `/api/v1/social/accounts/:accountId`

Returns account information and capabilities.

---

## POST `/api/v1/social/accounts/:accountId/refresh`

Refreshes provider/account state where supported.

---

## DELETE `/api/v1/social/accounts/:accountId`

Disconnects the account.

---

# 34. Media APIs

## POST `/api/v1/media/upload`

Creates an upload session.

Preferred response:

```json
{
  "data": {
    "mediaId": "media_123",
    "uploadUrl": "...",
    "expiresAt": "..."
  }
}

```

Upload URLs must be temporary and scoped.

---

## GET `/api/v1/media`

Lists media.

---

## GET `/api/v1/media/:mediaId`

Returns media metadata.

---

## DELETE `/api/v1/media/:mediaId`

Deletes media subject to authorization.

---

# 35. Media Analysis API

## POST `/api/v1/media/:mediaId/analyze`

Creates an asynchronous analysis job.

Response:

```text
202 Accepted

```

---

## GET `/api/v1/media/:mediaId/analysis`

Returns completed analysis.

---

# 36. Content Concept APIs

## POST `/api/v1/content-concepts`

Creates a platform-independent content concept.

---

## GET `/api/v1/content-concepts/:id`

Returns content concept.

---

# 37. Content Variant APIs

## POST `/api/v1/content-concepts/:id/variants`

Generates platform-specific variants.

Request:

```json
{
  "platforms": [
    "instagram",
    "tiktok",
    "youtube"
  ]
}

```

Response:

```text
202 Accepted

```

because generation may require asynchronous AI processing.

---

# 38. Social Post APIs

## GET `/api/v1/social/posts`

Lists social posts.

---

## POST `/api/v1/social/posts`

Creates a social draft.

Request:

```json
{
  "accountId": "account_123",
  "mediaId": "media_123",
  "variantId": "variant_123"
}

```

Default behavior should create a draft rather than immediately publish.

---

## GET `/api/v1/social/posts/:postId`

Returns post details.

---

## PATCH `/api/v1/social/posts/:postId`

Updates an editable draft.

---

# 39. Social Post Approval

## POST `/api/v1/social/posts/:postId/approve`

Marks a draft as approved if policy permits.

---

# 40. Social Scheduling

## POST `/api/v1/social/posts/:postId/schedule`

Request:

```json
{
  "scheduledAt": "2026-09-20T15:00:00Z",
  "timezone": "Asia/Karachi"
}

```

The backend must validate:

- account capability
- scheduling constraints
- permission
- policy
- post state

---

# 41. Social Publishing

## POST `/api/v1/social/posts/:postId/publish`

Attempts publication.

Response:

```text
202 Accepted

```

Publishing should be asynchronous.

The response should return an execution reference.

---

# 42. Social Publishing Attempts

## GET `/api/v1/social/posts/:postId/attempts`

Returns publishing attempts.

---

# 43. Social Analytics

## GET `/api/v1/social/posts/:postId/analytics`

Returns analytics snapshots.

---

## GET `/api/v1/social/accounts/:accountId/analytics`

Returns account-level analytics where supported.

---

# 44. Memory APIs

## GET `/api/v1/memory`

Lists memory available to the user.

---

## POST `/api/v1/memory`

Creates explicit memory.

Request:

```json
{
  "type": "PREFERENCE",
  "content": "Prefer short social captions."
}

```

---

## PATCH `/api/v1/memory/:memoryId`

Updates memory.

---

## DELETE `/api/v1/memory/:memoryId`

Requests deletion of a memory record subject to the product's retention/privacy model.

---

# 45. Memory Search

## POST `/api/v1/memory/search`

Request:

```json
{
  "query": "What are my social media preferences?"
}

```

Results must respect memory scope.

---

# 46. Notification APIs

## GET `/api/v1/notifications`

Lists notifications.

---

## POST `/api/v1/notifications/:id/read`

Marks notification as read.

---

# 47. Audit APIs

## GET `/api/v1/audit`

Returns authorized audit records.

Filters:

```text
agentId
taskId
toolId
action
result
createdAfter
createdBefore

```

Sensitive information must be redacted.

---

## GET `/api/v1/audit/:eventId`

Returns an individual audit event where permitted.

---

# 48. Usage APIs

## GET `/api/v1/usage`

Returns usage information.

---

## GET `/api/v1/usage/summary`

Returns aggregated usage and cost information.

---

# 49. Computer APIs

Computer operations should generally be initiated through tasks rather than arbitrary HTTP calls.

## POST `/api/v1/computer/sessions`

Creates a computer session if authorized.

---

## GET `/api/v1/computer/sessions`

Lists computer sessions.

---

## GET `/api/v1/computer/sessions/:sessionId`

Returns session state.

---

## POST `/api/v1/computer/sessions/:sessionId/stop`

Terminates the session.

---

# 50. Computer Action API

Direct computer actions should only be available through controlled execution contexts.

Potential internal action types:

```text
SNAPSHOT
LIST_APPS
GET_APP_STATE
PRESS_KEY
CLICK
TYPE

```

Each action must pass policy.

---

# 51. Browser APIs

## POST `/api/v1/browser/sessions`

Creates a browser session.

---

## GET `/api/v1/browser/sessions`

Lists browser sessions.

---

## POST `/api/v1/browser/sessions/:sessionId/stop`

Stops a browser session.

---

# 52. Voice APIs

## POST `/api/v1/voice/session`

Creates a voice session configuration.

The server should return only the minimum information required by the client.

Provider secrets must remain server-side.

---

## POST `/api/v1/voice/session/:sessionId/stop`

Stops the voice session.

---

# 53. Realtime Events

LEO should expose realtime events through WebSocket.

Connection:

```text
/api/v1/realtime

```

Authentication must be required.

---

# 54. Realtime Event Envelope

```json
{
  "event": "task.updated",
  "timestamp": "...",
  "data": {}
}

```

---

# 55. Task Events

Supported events:

```text
task.created
task.updated
task.started
task.step.started
task.step.completed
task.waiting_approval
task.completed
task.failed
task.cancelled

```

---

# 56. Agent Events

```text
agent.started
agent.paused
agent.resumed
agent.stopped
agent.failed

```

---

# 57. Approval Events

```text
approval.created
approval.updated
approval.approved
approval.denied
approval.expired
approval.cancelled

```

---

# 58. Social Events

```text
social.draft.created
social.post.scheduled
social.post.publishing
social.post.published
social.post.failed
social.analytics.updated

```

---

# 59. Media Events

```text
media.uploaded
media.processing
media.ready
media.failed
media.analysis.completed

```

---

# 60. Agent Stream

For active agent execution, the UI may receive events such as:

```text
plan.created
tool.requested
tool.approved
tool.started
tool.completed
tool.failed
agent.message
agent.waiting

```

Sensitive tool input/output should be redacted.

---

# 61. Webhook APIs

## POST `/api/v1/webhooks/:provider`

Receives provider events.

The endpoint must validate:

- signature
- provider
- event type
- timestamp
- payload

---

# 62. Idempotency

Side-effecting POST requests should support:

```text
Idempotency-Key

```

Examples:

```text
social publish
email send
calendar creation
payment-like future operations

```

---

# 63. Idempotency Response

Repeated requests with the same valid idempotency key should return the same logical result rather than creating duplicate side effects.

---

# 64. API Authorization Matrix

Example:


| Endpoint           | User          | Agent         | Admin            |
| ------------------ | ------------- | ------------- | ---------------- |
| Read tasks         | Yes           | Scoped        | Yes              |
| Create task        | Yes           | Scoped        | Yes              |
| Approve action     | Yes           | No            | Policy-dependent |
| Send email         | Policy        | Policy        | Policy           |
| Publish social     | Policy        | Policy        | Policy           |
| Read credentials   | Metadata only | No            | Restricted       |
| Modify permissions | Yes           | No            | Restricted       |
| Audit              | Own scope     | Own execution | Authorized scope |


The policy engine remains authoritative.

---

# 65. API Security Rules

Every endpoint must answer:

```text
Who can call it?
What resource can they access?
What action are they requesting?
What risk exists?
Does approval apply?
What gets audited?

```

---

# 66. API Rate Limits

Recommended categories:

```text
Authentication
Read APIs
Write APIs
AI generation
Media upload
Publishing
Webhooks

```

Provider-specific limits must also be respected.

---

# 67. Long-Running Operations

Operations such as:

- research
- media processing
- content generation
- social publishing
- browser automation
- computer use

should generally return:

```text
202 Accepted

```

with a task/execution reference.

---

# 68. Async Response Pattern

Example:

```json
{
  "data": {
    "taskId": "task_123",
    "status": "QUEUED"
  }
}

```

The client then subscribes to task events or polls the task endpoint.

---

# 69. API Versioning Rules

Breaking changes require a new API version.

Non-breaking changes may include:

- additional optional fields
- new event types
- new optional request parameters

Existing clients must continue functioning.

---

# 70. Schema Validation

All request bodies must be validated against explicit schemas.

Potential implementation:

```text
TypeScript
+
Zod

```

or the validation mechanism adopted by the underlying foundation.

Model-generated tool parameters must pass the same validation.

---

# 71. API to Service Boundary

Routes should remain thin.

```text
HTTP Route
 ↓
Validation
 ↓
Authorization
 ↓
Service
 ↓
Domain Logic
 ↓
Repository

```

Business logic should not be embedded inside route handlers.

---

# 72. API to Policy Boundary

For consequential actions:

```text
Route
 ↓
Service
 ↓
Policy Engine
 ↓
Decision
 ↓
Executor

```

---

# 73. API Audit Requirements

The following should generate audit events where appropriate:

- login
- permission changes
- approval decisions
- agent configuration changes
- credential operations
- social publishing
- destructive operations
- computer privileged actions
- integration changes

---

# 74. Error Taxonomy

Standard domain error codes should include:

```text
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
POLICY_DENIED
APPROVAL_REQUIRED
APPROVAL_EXPIRED
RESOURCE_NOT_FOUND
INVALID_INPUT
CONFLICT
RATE_LIMITED
PROVIDER_ERROR
PROVIDER_RATE_LIMIT
CREDENTIAL_EXPIRED
TASK_FAILED
TASK_CANCELLED
TOOL_UNAVAILABLE
BUDGET_EXCEEDED
EXECUTION_TIMEOUT

```

---

# 75. Sensitive Error Handling

The API should return safe errors.

Instead of:

```text
Database connection password abc123 failed...

```

return:

```text
Internal service error.

```

Detailed diagnostics remain server-side.

---

# 76. API Contract Testing

Every endpoint should eventually have:

- request validation tests
- response schema tests
- authorization tests
- ownership tests
- error tests
- rate-limit tests where relevant
- integration tests

---

# 77. OpenAPI

LEO should generate an OpenAPI specification from the API contract.

Target:

```text
/docs/openapi.yaml

```

The generated OpenAPI specification should become the machine-readable API reference.

---

# 78. API Client Generation

Where useful, TypeScript clients can be generated from OpenAPI.

This prevents frontend/backend contract drift.

---

# 79. Contract-First Development

The recommended workflow:

```text
Define Contract
 ↓
Schema
 ↓
Backend
 ↓
Tests
 ↓
Frontend

```

Not:

```text
Build Backend
 ↓
Guess Frontend Contract

```

---

# 80. API Acceptance Criteria

The API layer is considered ready when:

- endpoints are defined
- request schemas are defined
- response schemas are defined
- authentication is defined
- authorization is defined
- error taxonomy is defined
- realtime events are defined
- idempotency is defined
- webhook handling is defined
- OpenAPI generation is supported
- security tests exist

---

# 81. Critical API Invariants

```text
API-SEC-001
Authentication is required for protected resources.

API-SEC-002
Authentication does not imply authorization.

API-SEC-003
Ownership is validated server-side.

API-SEC-004
LLM output cannot bypass API policy.

API-SEC-005
Raw credentials are never returned through normal APIs.

API-SEC-006
Side-effecting requests support idempotency where required.

API-SEC-007
Long-running work is asynchronous.

API-SEC-008
Sensitive operations are auditable.

API-SEC-009
Cancelled tasks cannot continue through stale approvals.

API-SEC-010
External provider success is verified before reporting completion.

```

---

# 82. Final API Architecture

```text
                    CLIENT
                      │
                      ↓
                LEO API Gateway
                      │
             ┌────────┴────────┐
             ↓                 ↓
          REST API          WebSocket
             │                 │
             └────────┬────────┘
                      ↓
                Domain Services
                      │
                Policy Engine
                      │
                Execution Engine
                      │
           ┌──────────┼───────────┐
           ↓          ↓           ↓
         Tools       MCP       Providers

```

The API layer is therefore a **controlled interface to LEO**, not a shortcut around its security architecture.

---

# 83. Next Document

The next file is:

`LEO_REPOSITORY_STRUCTURE.md`

It will translate the architecture into the actual codebase:

```text
apps/
packages/
workers/
infrastructure/
tests/
docs/

```

and define exactly where:

- agents
- policy
- permissions
- social
- computer
- voice
- browser
- memory
- database
- API
- UI
- workers
- tests

belong.

After that comes the **implementation roadmap**, followed by the final **Antigravity implementation specification**.