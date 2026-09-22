import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { ComputerService } from '../../computer/service.js';
import type { ComputerAction } from '@ownpilot/core/computer';
import { resolveTemplates } from '../template-resolver.js';
import { executionTaskContext, assertExecutionTaskActive } from '../../execution-task-context.js';
import { getIdempotencyKeysRepository } from '../../../db/repositories/idempotency-keys.js';
import { createHash } from 'node:crypto';
import { createWorkflowApprovalsRepository } from '../../../db/repositories/workflows/approvals.js';
import { ApprovalPauseError } from '../workflow-dispatch.js';

export interface BrowserNodeData {
  action:
    | 'navigate'
    | 'inspect_page'
    | 'find'
    | 'click'
    | 'type'
    | 'select'
    | 'scroll'
    | 'wait'
    | 'screenshot'
    | 'extract'
    | 'back'
    | 'forward'
    | 'reload';
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  direction?: string;
  amount?: number;
  duration?: number;
}

/** Deterministic JSON serialization for idempotency hashing. */
function stableHash(obj: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort()))
    .digest('hex');
}

export async function executeBrowserNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  userId: string,
  execContextJob?: { jobId: string; leaseToken: string; effectIndex: number }
): Promise<NodeResult> {
  const startTime = Date.now();

  try {
    const data = node.data as unknown as BrowserNodeData;

    // Check execution task context
    await assertExecutionTaskActive();
    const taskContext = executionTaskContext.getStore()!;

    // Build computer action
    const args: Record<string, unknown> = {
      action: data.action,
      url: data.url,
      selector: data.selector,
      text: data.text,
      value: data.value,
      direction: data.direction,
      amount: data.amount,
      duration: data.duration,
    };

    // Filter undefined
    const cleanArgs = Object.fromEntries(Object.entries(args).filter(([_, v]) => v !== undefined));
    const resolvedArgs = resolveTemplates(cleanArgs, nodeOutputs, variables);

    // Build the ComputerAction with params sub-object
    const actionType = String(resolvedArgs.action);
    const { action: _action, ...params } = resolvedArgs;
    const actionObj: ComputerAction = {
      type: actionType as ComputerAction['type'],
      params,
    };

    // Idempotency: Safe operations vs side-effecting
    const isSafe = [
      'navigate',
      'inspect_page',
      'find',
      'screenshot',
      'extract',
      'back',
      'forward',
      'reload',
      'wait',
      'scroll',
    ].includes(actionObj.type);

    const idempotencyRepo = getIdempotencyKeysRepository();
    const requestHash = stableHash(actionObj);
    const operationId = execContextJob
      ? `job:${execContextJob.jobId}:node:${node.id}:effect:${execContextJob.effectIndex++}`
      : `workflow:browser:${node.id}:${Date.now()}`;

    if (!isSafe && execContextJob) {
      const claim = await idempotencyRepo.claimOperation(
        userId,
        operationId,
        requestHash,
        execContextJob.leaseToken
      );
      if (!claim.claimed) {
        if (claim.state === 'success') {
          return {
            nodeId: node.id,
            status: 'success',
            output: claim.result,
            resolvedArgs,
            durationMs: Date.now() - startTime,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
          };
        }

        throw new Error(
          `Operation is ${claim.state}; automatic replay of side-effecting browser action denied`
        );
      }
    }

    let result;
    try {
      const computerService = new ComputerService();
      const res = await computerService.executeAction(actionObj);

      if (!res.success) {
        if (res.error?.includes('Approval required')) {
          const approvalRepo = createWorkflowApprovalsRepository(userId);
          // Extract run ID from job ID pattern: wfnode:<runId>:<nodeId>
          const runIdMatches = execContextJob
            ? execContextJob.jobId.match(/wfnode:([^:]+):/)
            : null;
          const logId = runIdMatches?.[1] ?? 'unknown';
          const approval = await approvalRepo.create({
            workflowLogId: logId,
            workflowId: taskContext.workflowId,
            nodeId: node.id,
            workspaceId: taskContext.workspaceId,
            action: actionObj.type,
            capability: 'browser.navigate',
            context: {
              nodeType: node.type,
              action: actionObj.type,
            },
            message: res.error,
          });
          throw new ApprovalPauseError(approval.id);
        }
        throw new Error(res.error || 'Browser action failed');
      }

      result = res.data;

      if (!isSafe && execContextJob) {
        await idempotencyRepo.finishOperation(
          userId,
          operationId,
          execContextJob.leaseToken,
          'success',
          result
        );
      }
    } catch (err) {
      if (err instanceof ApprovalPauseError) throw err;
      if (!isSafe && execContextJob) {
        await idempotencyRepo.finishOperation(
          userId,
          operationId,
          execContextJob.leaseToken,
          'unknown',
          null
        );
      }
      throw err;
    }

    return {
      nodeId: node.id,
      status: 'success',
      output: result,
      resolvedArgs,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    // If it's an ApprovalPauseError, let it propagate to the job handler
    if (error instanceof ApprovalPauseError) {
      throw error;
    }

    return {
      nodeId: node.id,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
