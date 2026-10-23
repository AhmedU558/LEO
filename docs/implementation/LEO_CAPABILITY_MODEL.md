# LEO Capability Model

## Abstract

A capability grants permission to perform an action on a resource (but does not directly grant access to raw credential strings).

## Default Capabilities

```text
agent.execute
task.execute
workflow.execute

email.read
email.send

browser.read
browser.navigate

computer.read
computer.control

filesystem.read
filesystem.write

shell.execute

social.account.read
social.content.create
social.post.schedule
social.post.publish

credential.read
credential.use

memory.read
memory.write
```

## Capability Leases

Capabilities can be granted temporarily via a **lease**.

- Properties: `lease_id`, `subject_id`, `workspace_id`, `capability`, `resource_scope`, `issued_at`, `expires_at`, `issued_by`, `risk_limit`, `status`.
- Statuses: `ACTIVE`, `EXPIRED`, `REVOKED`.
- Expired or revoked leases immediately fail authorization.
- Agents cannot create or extend their own capability leases.
