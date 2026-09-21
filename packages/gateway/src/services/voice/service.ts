import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';

export class VoiceService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  async handleVoiceToolCall(
    userId: string,
    workspaceId: string,
    sessionId: string,
    toolName: string,
    toolArgs: unknown
  ): Promise<{ allowed: boolean; error?: string; result?: unknown }> {
    const action = 'voice.tool_execute';
    const capability = 'ai.execute'; // Assuming executing tools implies this capability
    const risk = this.riskEngine.classify(capability, toolName);

    // 1. Policy Check
    const policyResult = this.policyEngine.evaluate({
      identity: {
        userId,
        workspaceId,
        roles: ['user'],
      },
      action,
      resource: sessionId,
      capability,
      risk,
      environment: 'production',
      autonomous: false,
      requestedParameters: { toolName, toolArgs },
    });

    // 2. Audit Log
    const ledgerEntry = await ActionLedger.record({
      userId,
      workspaceId,
      tool: toolName,
      action,
      resource: sessionId,
      resourceType: 'voice_session',
      capability,
      policyDecision: policyResult.decision,
      riskLevel: risk,
      executionEnvironment: 'production',
      // Recorded up-front; ActionLedger.updateResult() fills the real duration.
      durationMs: 0,
    });

    if (policyResult.decision === 'DENY') {
      const errorMsg = 'Voice tool execution denied by policy.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 10);
      return { allowed: false, error: errorMsg };
    }

    if (policyResult.decision === 'REQUIRE_APPROVAL') {
      const errorMsg = 'Approval required for voice tool execution.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 10);
      return { allowed: false, error: errorMsg };
    }

    // 3. Execute Tool (stubbed for MVP)
    const startTime = Date.now();
    try {
      const mockResult = { status: 'success', data: `Executed ${toolName}` };
      const duration = Date.now() - startTime;
      ActionLedger.updateResult(
        ledgerEntry.actionId,
        { result: JSON.stringify(mockResult) },
        duration
      );
      return { allowed: true, result: mockResult };
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown tool error';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, duration);
      return { allowed: false, error: errorMsg };
    }
  }
}
