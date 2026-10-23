-- QA-012/QA-013: Harden workflow approvals with atomic bindings and strict IDOR/Replay prevention
ALTER TABLE workflow_approvals
ADD COLUMN workspace_id VARCHAR(50),
ADD COLUMN action VARCHAR(255),
ADD COLUMN capability VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_workspace ON workflow_approvals(workspace_id);
