import type { Capability, LeoRiskLevel } from './capabilities.js';
import type { LeoIdentityContext } from './identity.js';

export type PolicyDecisionType = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface PolicyDecision {
  decision: PolicyDecisionType;
  reason?: string;
  requiredApprovalRisk?: LeoRiskLevel;
}

export interface PolicyRequest {
  identity: LeoIdentityContext;
  action: string;
  resource: string;
  capability: Capability;
  risk: LeoRiskLevel;
  environment: 'development' | 'production' | 'test';
  autonomous: boolean;
  requestedParameters: Record<string, unknown>;
}

export class PolicyEngine {
  /**
   * Deterministically evaluate whether a capability action should proceed.
   */
  public evaluate(request: PolicyRequest): PolicyDecision {
    // 1. Identity validation
    if (!request.identity || !request.identity.userId) {
      return { decision: 'DENY', reason: 'Missing identity context' };
    }

    // 2. Cross-workspace access checks (fail closed)
    if (!request.identity.workspaceId) {
      return { decision: 'DENY', reason: 'Missing workspace binding' };
    }

    // 3. Risk-based constraints
    if (request.risk === 'CRITICAL') {
      // Critical operations must always require explicit approval, even in autonomous mode
      return {
        decision: 'REQUIRE_APPROVAL',
        requiredApprovalRisk: 'CRITICAL',
        reason: 'CRITICAL risk always requires explicit approval',
      };
    }

    if (request.risk === 'HIGH' && request.autonomous) {
      // High-risk autonomous actions require explicit approval.
      return {
        decision: 'REQUIRE_APPROVAL',
        requiredApprovalRisk: 'HIGH',
        reason: 'HIGH risk autonomous actions require approval',
      };
    }

    // 4. Fallback execution escape hatch guards
    if (request.capability === 'shell.execute' || request.capability === 'computer.control') {
      if (request.environment === 'production') {
        return { decision: 'DENY', reason: 'Host execution prohibited in production' };
      }
      return {
        decision: 'REQUIRE_APPROVAL',
        requiredApprovalRisk: 'CRITICAL',
        reason: 'Host execution requires explicit approval',
      };
    }

    // 5. Default allow for low/medium risk within workspace
    return { decision: 'ALLOW' };
  }
}
