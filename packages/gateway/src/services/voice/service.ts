import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import type { IToolService } from '@ownpilot/core/services';
import { createToolService } from '../tool/service.js';
import { determineCapabilityForTool } from '../tool/permission.js';

export interface VoiceToolCallOptions {
  signal?: AbortSignal;
  conversationId?: string;
}

export class VoiceService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  constructor(private readonly toolService?: IToolService) {}

  async handleVoiceToolCall(
    userId: string,
    workspaceId: string,
    sessionId: string,
    toolName: string,
    toolArgs: unknown,
    options?: VoiceToolCallOptions
  ): Promise<{ allowed: boolean; approvalRequired?: boolean; error?: string; result?: unknown }> {
    const action = 'voice.tool_execute';
    const capability = determineCapabilityForTool(toolName);
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
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
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
      return { allowed: false, approvalRequired: true, error: errorMsg };
    }

    // Check cancellation before initiating action
    if (options?.signal?.aborted) {
      const errorMsg = 'Voice tool execution aborted before starting.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 0);
      return { allowed: false, error: errorMsg };
    }

    // 3. Execute Tool
    const startTime = Date.now();
    try {
      let executor = this.toolService;
      let hasTool = false;
      if (executor) {
        try {
          hasTool = executor.has(toolName);
        } catch {
          hasTool = false;
        }
      } else {
        try {
          const fallback = createToolService(userId);
          hasTool = fallback.has(toolName);
          if (hasTool) executor = fallback;
        } catch {
          hasTool = false;
        }
      }

      if (!executor || !hasTool) {
        // Production paths must never fabricate success. QA-022 / QA-004 fix
        throw new Error('Voice tool execution provider is not configured.');
      }

      const toolResult = await executor.execute(
        toolName,
        (toolArgs as Record<string, unknown>) || {},
        {
          userId,
          conversationId: options?.conversationId,
          execSource: 'voice',
          signal: options?.signal,
        }
      );

      const duration = Date.now() - startTime;
      if (!toolResult.success) {
        const errorMsg = toolResult.error || 'Tool execution failed';
        ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, duration);
        return { allowed: false, error: errorMsg };
      }

      ActionLedger.updateResult(
        ledgerEntry.actionId,
        { success: true, result: toolResult.content },
        duration
      );
      return { allowed: true, result: toolResult.content };
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown tool error';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, duration);
      return { allowed: false, error: errorMsg };
    }
  }
}
