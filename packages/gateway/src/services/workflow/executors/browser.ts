import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { ComputerService } from '../../computer/service.js';
import type { ComputerAction } from '@ownpilot/core/computer';
import { OpenAIComputerActionProposer } from '@ownpilot/core/computer';
import { getAggregatorProvider } from '@ownpilot/core';
import { runComputerVisionLoop } from '../../computer/vision-loop.js';
import { StructuralScreenshotRedactor } from '../../computer/screenshot-redactor.js';
import { getApiKey, resolveDefaultProviderAndModel } from '../../app-settings.js';
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
  if (type === 'vision_loop') {
    const { provider, model } = await resolveDefaultProviderAndModel(
      typeof params.provider === 'string' ? params.provider : 'openai',
      typeof params.model === 'string' ? params.model : 'default'
    );
    const apiKey = provider ? await getApiKey(provider) : undefined;
    if (!apiKey || !model || !provider) throw new Error('Computer vision model is not configured');
    // Any OpenAI-compatible endpoint may serve the vision model; the transport
    // is unchanged. `apiBase` is server-side configuration only.
    const baseUrl = getAggregatorProvider(provider)?.apiBase;
    const result = await runComputerVisionLoop({
      iterations: typeof params.iterations === 'number' ? params.iterations : 1,
      // The workflow author's goal for this node. It reaches the model as
      // delimited untrusted data and is never read back out of the page.
      ...(typeof params.objective === 'string' ? { objective: params.objective } : {}),
      proposer: new OpenAIComputerActionProposer({ apiKey, model, baseUrl, provider }),
      redactor: new StructuralScreenshotRedactor(),
    });
    if (result.outcome === 'WAITING_APPROVAL' && result.approvalId) {
      await createWorkflowsRepository(userId).updateLog(computerStepContext.getStore()!.runId, {
        status: 'awaiting_approval',
        nodeResults: nodeOutputs,
      });
      throw new ApprovalPauseError(result.approvalId);
    }
    return {
      nodeId: node.id,
      status: result.outcome === 'COMPLETED' ? 'success' : 'error',
      output: result,
      error: result.outcome === 'COMPLETED' ? undefined : `Computer vision ${result.outcome}`,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
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
