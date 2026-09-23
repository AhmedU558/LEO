import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { ComputerService } from '../../computer/service.js';
import type { ComputerAction } from '@ownpilot/core/computer';
import { resolveTemplates } from '../template-resolver.js';
import { executionTaskContext, assertExecutionTaskActive } from '../../execution-task-context.js';
import { ApprovalPauseError } from '../workflow-dispatch.js';
import { createWorkflowsRepository } from '../../../db/repositories/workflows/index.js';
import { computerStepContext } from '../../execution-task-context.js';

export async function executeBrowserNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  userId: string
): Promise<NodeResult> {
  const startTime = Date.now();
  await assertExecutionTaskActive();
  if (executionTaskContext.getStore()?.userId !== userId)
    throw new Error('Computer execution identity mismatch');
  const data = node.data as Record<string, unknown>;
  const {
    action,
    computerCapabilities: _capabilities,
    label: _label,
    ...params
  } = resolveTemplates(data, nodeOutputs, variables);
  const aliases: Record<string, string> = { back: 'navigate_back', forward: 'navigate_forward' };
  const type = aliases[String(action)] ?? String(action);
  if (params.amount !== undefined && params.pixels === undefined) params.pixels = params.amount;
  const result = await new ComputerService().executeAction({
    type: type as ComputerAction['type'],
    params,
  });
  if (result.outcome === 'WAITING_APPROVAL' && result.approvalId) {
    const step = computerStepContext.getStore()!;
    await createWorkflowsRepository(userId).updateLog(step.runId, {
      status: 'awaiting_approval',
      nodeResults: nodeOutputs,
    });
    throw new ApprovalPauseError(result.approvalId);
  }
  // Screenshots are transient observations. Never persist their bytes or input secrets in node logs.
  const output =
    type === 'screenshot'
      ? { captured: result.success, actionId: result.actionId, sessionId: result.sessionId }
      : {
          data: result.data,
          untrusted: true,
          actionId: result.actionId,
          sessionId: result.sessionId,
        };
  return {
    nodeId: node.id,
    status: result.success ? 'success' : 'error',
    output,
    error: result.error,
    durationMs: Date.now() - startTime,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
  };
}
