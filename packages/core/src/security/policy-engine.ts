import { type Capability, type LeoRiskLevel, CAPABILITY_RISKS } from './capabilities.js';
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

const RISK_WEIGHTS: Record<LeoRiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class PolicyEngine {
  /**
   * Deterministically evaluate whether a capability action should proceed.
   */
  public evaluate(request: PolicyRequest): PolicyDecision {
    const intrinsicRisk = CAPABILITY_RISKS[request.capability];
    const actualRisk =
      RISK_WEIGHTS[intrinsicRisk] > RISK_WEIGHTS[request.risk] ? intrinsicRisk : request.risk;
    // 1. Identity validation
    if (!request.identity || !request.identity.userId) {
      return { decision: 'DENY', reason: 'Missing identity context' };
    }

    // 2. Cross-workspace access checks (fail closed)
    if (!request.identity.workspaceId) {
      return { decision: 'DENY', reason: 'Missing workspace binding' };
    }

    // 3. Risk-based constraints
    if (actualRisk === 'CRITICAL') {
      // Critical operations must always require explicit approval, even in autonomous mode
      return {
        decision: 'REQUIRE_APPROVAL',
        requiredApprovalRisk: 'CRITICAL',
        reason: 'CRITICAL risk always requires explicit approval',
      };
    }

    if (actualRisk === 'HIGH' && request.autonomous) {
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
