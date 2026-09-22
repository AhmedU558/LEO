import type { ComputerAction, ComputerActionResult, ComputerTask } from '@ownpilot/core/computer';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import type { Capability } from '@ownpilot/core/security';

export class ComputerService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  /**
   * Route an action to the global Capability the policy layer authorises.
   *
   * QA-007: this returned `ComputerCapability` ('shell', 'file_operations',
   * 'app_control', 'system_control'), which is a different, coarser vocabulary
   * than the one PolicyEngine / RiskEngine / ActionLedger grade. Feeding it in
   * meant the risk table never matched and every action fell through to the
   * unknown-capability path. The mapping below names the concrete effect, and
   * splits read from write rather than grading both as one bucket.
   */
  private determineCapability(actionType: string): Capability {
    switch (actionType) {
      case 'execute_shell':
        return 'shell.execute';
      case 'read_file':
        return 'filesystem.read';
      case 'write_file':
        return 'filesystem.write';
      case 'screenshot':
        return 'browser.read';
      case 'navigate':
      case 'click':
      case 'type':
      case 'scroll':
      case 'hover':
        return 'browser.navigate';
      // Synthetic keystrokes reach whatever application holds focus, so this
      // is host control, not a browser action.
      case 'press_key':
        return 'computer.control';
      default:
        return 'computer.control';
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
      // Recorded up-front; ActionLedger.updateResult() fills the real duration.
      durationMs: 0,
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

    // 3. Execution logic routing
    const startTime = Date.now();
    try {
      // Production paths must never fabricate success.
      // Explicitly fail if no real provider is injected/available.
      const providerResult: ComputerActionResult = {
        success: false,
        error: 'No production computer execution provider configured.',
        data: { simulated: true, status: 'not_implemented' }
      };

      const duration = Date.now() - startTime;
      if (providerResult.success) {
        ActionLedger.updateResult(
          ledgerEntry.actionId,
          { result: `Executed successfully: ${JSON.stringify(providerResult.data ?? null)}` },
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
}
