import type { Capability, LeoRiskLevel } from './capabilities.js';

export class RiskEngine {
  /**
   * Deterministically classify risk based on capability and action.
   */
  public classify(capability: Capability, _action: string): LeoRiskLevel {
    switch (capability) {
      // LOW
      case 'memory.read':
      case 'agent.execute':
      case 'task.execute':
        return 'LOW';

      // MEDIUM
      case 'browser.read':
      case 'browser.navigate':
      case 'memory.write':
      case 'workflow.execute':
        return 'MEDIUM';

      // HIGH
      case 'email.send':
      case 'email.read':
      case 'social.post.publish':
      case 'social.post.schedule':
      case 'social.content.create':
      case 'social.account.read':
      case 'filesystem.read':
      case 'filesystem.write':
      case 'credential.read':
      case 'credential.use':
        return 'HIGH';

      // CRITICAL
      case 'shell.execute':
      case 'computer.control':
      case 'computer.read':
        return 'CRITICAL';

      default:
        // Unknown capabilities fail closed (CRITICAL)
        return 'CRITICAL';
    }
  }
}
