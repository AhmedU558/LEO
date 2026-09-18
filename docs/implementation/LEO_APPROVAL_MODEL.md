# LEO Approval Model

## Abstract
Provides explicit user authorization for high-risk actions. An approval grants specific execution limits and must not generalize to unrelated actions.

## States
* **PENDING:** Awaiting user interaction.
* **APPROVED:** User has authorized the action.
* **DENIED:** User has rejected the action.
* **EXPIRED:** Time window for approval elapsed.
* **CANCELLED:** The underlying task or run was cancelled.

## Invariants
* Cancelled tasks or runs automatically invalidate pending approvals.
* Approvals strictly bind to the exact task, capability, resource, and parameters requested.
* No "approve everything" behavior exists.
