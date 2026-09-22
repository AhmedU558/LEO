import type { ComputerAction, ComputerActionResult, ComputerTask } from '@ownpilot/core/computer';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import type { Capability } from '@ownpilot/core/security';
import { executionTaskContext } from '../execution-task-context.js';
import { PuppeteerBrowserProvider } from './puppeteer-provider.js';

export class ComputerService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  private determineCapability(actionType: string): Capability {
    switch (actionType) {
      case 'execute_shell':
        return 'shell.execute';
      case 'read_file':
        return 'filesystem.read';
      case 'write_file':
        return 'filesystem.write';
      case 'screenshot':
      case 'extract':
      case 'get_state':
      case 'accessibility_tree':
        return 'browser.read';
      case 'navigate':
      case 'click':
      case 'type':
      case 'scroll':
      case 'hover':
      case 'select':
      case 'wait':
      case 'navigate_back':
        return 'browser.navigate';
      case 'press_key':
        return 'computer.control';
      default:
        return 'computer.control';
    }
  }

  async executeAction(action: ComputerAction): Promise<ComputerActionResult> {
    const ctx = executionTaskContext.getStore();
    if (!ctx) {
      return {
        success: false,
        error:
          'Missing execution context: browser/computer actions must run within an active ExecutionTask.',
      };
    }

    if (ctx.signal.aborted) {
      return { success: false, error: 'Execution task cancelled' };
    }

    const actionName = 'computer.' + action.type;
    const capability = this.determineCapability(action.type);
    const risk = this.riskEngine.classify(capability, actionName);

    // For navigation, the resource is the URL. For other actions, it's the target element or just the task id.
    const resource =
      action.type === 'navigate' ? String(action.params.url || ctx.taskId) : ctx.taskId;

    // 1. Policy check
    const policyResult = this.policyEngine.evaluate({
      identity: {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        roles: ['user'],
      },
      action: actionName,
      resource: resource,
      capability,
      risk,
      environment: 'production',
      autonomous: false,
      requestedParameters: action.params,
    });

    // 2. Action Ledger entry
    const ledgerEntry = await ActionLedger.record({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      tool: 'computer_service',
      action: actionName,
      resource: resource,
      resourceType: 'computer_task',
      capability,
      policyDecision: policyResult.decision,
      riskLevel: risk,
      executionEnvironment: 'production',
      durationMs: 0,
      sessionId: ctx.taskId,
      executionTaskId: ctx.taskId,
    });

    if (policyResult.decision === 'DENY') {
      const errorMsg = 'Computer action denied by policy: ' + policyResult.reason;
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg };
    }

    if (policyResult.decision === 'REQUIRE_APPROVAL') {
      const errorMsg = 'Approval required to execute computer action.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg };
    }

    // 3. Execution logic routing
    const startTime = Date.now();
    try {
      let providerResult: ComputerActionResult;

      const isBrowserAction = [
        'navigate',
        'click',
        'type',
        'screenshot',
        'extract',
        'wait',
        'scroll',
        'select',
        'navigate_back',
        'hover',
        'get_state',
        'accessibility_tree',
        'press_key',
      ].includes(action.type);

      if (isBrowserAction) {
        const provider = new PuppeteerBrowserProvider(ctx);
        if (action.type === 'navigate') {
          providerResult = await provider.navigate(action.params.url as string);
        } else {
          providerResult = await provider.executeAction(action);
        }
      } else {
        providerResult = {
          success: false,
          error: 'No production computer execution provider configured for ' + action.type,
          data: { simulated: true, status: 'not_implemented' },
        };
      }

      const duration = Date.now() - startTime;
      if (providerResult.success) {
        ActionLedger.updateResult(
          ledgerEntry.actionId,
          { result: 'Executed successfully' },
          duration
        );
      } else {
        ActionLedger.updateResult(ledgerEntry.actionId, { error: providerResult.error }, duration);
      }

      return providerResult;
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMessage }, duration);
      return { success: false, error: errorMessage };
    }
  }

  // Backwards compatibility for MVP endpoint
  async executeTaskAction(
    userId: string,
    workspaceId: string,
    task: ComputerTask,
    action: ComputerAction
  ): Promise<ComputerActionResult> {
    return executionTaskContext.run(
      {
        taskId: task.id,
        userId,
        workspaceId,
        workflowId: 'mvp',
        signal: new AbortController().signal,
      },
      () => this.executeAction(action)
    );
  }
}
