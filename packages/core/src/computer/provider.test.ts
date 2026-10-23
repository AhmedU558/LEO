import { describe, expect, it } from 'vitest';
import { validateComputerPoint } from './provider.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { RiskEngine } from '../security/risk-engine.js';

describe('computer capability and viewport contract', () => {
  it('allows only viewport coordinates', () => {
    expect(() => validateComputerPoint(0, 0)).not.toThrow();
    expect(() => validateComputerPoint(1279, 799)).not.toThrow();
    expect(() => validateComputerPoint(Infinity, 0)).toThrow();
    expect(() => validateComputerPoint(0, -1)).toThrow();
  });
  it('requires approval for mouse effects and keyboard input in autonomous execution', () => {
    const risk = new RiskEngine();
    for (const [capability, action] of [
      ['computer.mouse', 'computer.click'],
      ['computer.keyboard', 'computer.typeText'],
    ] as const) {
      expect(
        new PolicyEngine().evaluate({
          identity: { userId: 'u', workspaceId: 'w', roles: [] },
          capability,
          action,
          risk: risk.classify(capability, action),
          resource: 'session',
          environment: 'production',
          autonomous: true,
          requestedParameters: {},
        }).decision
      ).toBe('REQUIRE_APPROVAL');
    }
    expect(risk.classify('computer.mouse', 'computer.mouseMove')).toBe('MEDIUM');
    expect(risk.classify('computer.clipboard', 'anything')).toBe('CRITICAL');
  });
});
