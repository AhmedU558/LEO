import type {
  ComputerAction,
  ComputerActionResult,
  ComputerCapability,
  ComputerTask,
} from '@ownpilot/core/computer';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';

export class ComputerService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  // Route action to required capability
  private determineCapability(actionType: string): ComputerCapability {
    switch (actionType) {
      case 'execute_shell':
        return 'shell';
      case 'read_file':
      case 'write_file':
        return 'file_operations';
      case 'navigate':
      case 'click':
      case 'type':
      case 'scroll':
      case 'hover':
      case 'screenshot':
        return 'browser.navigate';
      case 'press_key':
        return 'app_control';
      default:
        return 'system_control';
    }
  }

  async executeTaskAction(
    userId: string,
    workspaceId: string,
    task: ComputerTask,
    action: ComputerAction
  ): Promise<ComputerActionResult> {
    const actionName = 'computer.' + action.type;
    const capability = this.determineCapability(action.type);
    const risk = this.riskEngine.classify(capability, actionName);

    // 1. Policy check
    const policyResult = this.policyEngine.evaluate({
      identity: {
        userId,
        workspaceId,
        roles: ['user'],
      },
      action: actionName,
      resource: task.id,
      capability,
      risk,
      environment: 'production',
      autonomous: false,
      requestedParameters: action.params,
    });

    // 2. Action Ledger entry
    const ledgerEntry = await ActionLedger.record({
      userId,
      workspaceId,
      tool: 'computer_service',
      action: actionName,
      resource: task.id,
      resourceType: 'computer_task',
      capability,
      policyDecision: policyResult.decision,
      riskLevel: risk,
      executionEnvironment: 'production',
      context: action.params,
    });

    if (policyResult.decision === 'DENY') {
      const errorMsg = 'Computer action denied by policy.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg };
    }

    if (policyResult.decision === 'REQUIRE_APPROVAL') {
      const errorMsg = 'Approval required to execute computer action.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg };
    }

    // 3. Execution logic routing (simulated MVP)
    const startTime = Date.now();
    try {
      // Stub: in reality we would route to Playwright/CDP or Qwen Open Computer Use
      const providerResult = await this.simulateProviderExecution(action);

      const duration = Date.now() - startTime;
      if (providerResult.success) {
        ActionLedger.updateResult(
          ledgerEntry.actionId,
          { result: 'Executed successfully', data: providerResult.data },
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

  private async simulateProviderExecution(action: ComputerAction): Promise<ComputerActionResult> {
    // Simulate execution delay (e.g., Playwright or Qwen backend)
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      success: true,
      data: { status: 'mock_success', executed: action.type },
      screenshotBase64: 'mock_base64_screenshot_data',
    };
  }
}
