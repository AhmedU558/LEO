import type { SocialContent, SocialAccount, SocialPublishResult } from '@ownpilot/core/social';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';

export class SocialService {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  async publishWithPolicy(
    userId: string,
    workspaceId: string,
    content: SocialContent,
    account: SocialAccount
  ): Promise<SocialPublishResult> {
    const action = 'social.publish';
    const capability = 'social.write';
    const risk = this.riskEngine.classify(capability, action);

    // 1. Policy check
    const policyResult = this.policyEngine.evaluate({
      identity: {
        userId,
        workspaceId,
        roles: ['user'],
      },
      action,
      resource: content.id,
      capability,
      risk,
      environment: 'production',
      autonomous: false,
      requestedParameters: { platform: account.platform },
    });

    // 2. Action Ledger entry (pending)
    const ledgerEntry = await ActionLedger.record({
      userId,
      workspaceId,
      tool: 'social_service',
      action,
      resource: content.id,
      resourceType: 'social_content',
      capability,
      policyDecision: policyResult.decision,
      riskLevel: risk,
      executionEnvironment: 'production',
      // Recorded up-front; ActionLedger.updateResult() fills the real duration.
      durationMs: 0,
    });

    if (policyResult.decision === 'DENY') {
      const errorMsg = 'Social publish denied by policy.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg, retryable: false };
    }

    if (policyResult.decision === 'REQUIRE_APPROVAL') {
      const errorMsg = 'Approval required to publish.';
      ActionLedger.updateResult(ledgerEntry.actionId, { error: errorMsg }, 50);
      return { success: false, error: errorMsg, retryable: false };
    }

    // 3. Publish to provider logic (simulated for MVP)
    const startTime = Date.now();
    try {
      // Find provider based on platform and execute publish
      // This is a stub for the actual provider logic (e.g. Instagram, TikTok, YouTube)
      const providerResult = await this.simulateProviderPublish(content, account);

      const duration = Date.now() - startTime;
      if (providerResult.success) {
        ActionLedger.updateResult(
          ledgerEntry.actionId,
          { result: 'Published successfully' },
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
      return { success: false, error: errorMessage, retryable: true };
    }
  }

  private async simulateProviderPublish(
    _content: SocialContent,
    account: SocialAccount
  ): Promise<SocialPublishResult> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      success: true,
      providerPostId: 'sim_' + Date.now(),
      publishedUrl: 'https://' + account.platform + '.com/post/sim_' + Date.now(),
    };
  }
}
