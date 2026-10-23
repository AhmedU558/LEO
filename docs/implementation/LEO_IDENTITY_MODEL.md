# LEO Identity Model

## Foundation

The LEO Identity model establishes the fundamental subject executing any action. It is propagated through API requests, agent runs, tools, and audit events.

## Hierarchy

```text
User
 └── Workspace
      ├── Sessions
      ├── Agents
      ├── Credentials
      ├── Tasks
      ├── Workflows
      ├── Social Accounts
      ├── Media
      └── Audit Events
```

## Guiding Principles

- **Cross-workspace access MUST fail closed.** Agents and tools cannot query or interact with resources outside their authenticated workspace boundary.
- **Implicit Ownership is Disabled:** Unsafe passwordless remote-access shortcuts from the OwnPilot foundation are disabled for exposed deployments.
- **Session Validation:** Uses HttpOnly cookies, secure validation, trusted-origin protections, and password throttling.
