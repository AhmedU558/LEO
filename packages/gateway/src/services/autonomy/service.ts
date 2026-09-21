import type {
  AutonomousTask,
  AutonomyStatus,
  AutonomyEvent,
  AutonomyEngine,
} from '@ownpilot/core/autonomy';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';

export class AutonomyService implements AutonomyEngine {
  private policyEngine = new PolicyEngine();
  private riskEngine = new RiskEngine();

  // In-memory stubs
  private tasks = new Map<string, AutonomousTask>();
  private events = new Map<string, AutonomyEvent[]>();

  async startTask(task: AutonomousTask): Promise<void> {
    const action = 'autonomy.start';
    const capability = 'ai.execute';
    const risk = this.riskEngine.classify(capability, 'autonomous_loop');

    // 1. Policy check before starting autonomy loop
    const policyResult = this.policyEngine.evaluate({
      identity: {
        userId: task.userId,
        workspaceId: task.workspaceId,
        roles: ['user'],
      },
      action,
      resource: task.id,
      capability,
      risk,
      environment: 'production',
      autonomous: true,
      requestedParameters: { goal: task.goal },
    });

    const ledgerEntry = await ActionLedger.record({
      userId: task.userId,
      workspaceId: task.workspaceId,
      tool: 'autonomy_engine',
      action,
      resource: task.id,
      resourceType: 'autonomous_task',
      capability,
      policyDecision: policyResult.decision,
      riskLevel: risk,
      executionEnvironment: 'production',
      // Recorded up-front; ActionLedger.updateResult() fills the real duration.
      durationMs: 0,
    });

    if (policyResult.decision === 'DENY' || policyResult.decision === 'REQUIRE_APPROVAL') {
      task.status = 'failed';
      this.tasks.set(task.id, task);
      ActionLedger.updateResult(
        ledgerEntry.actionId,
        { error: 'Autonomy start denied or needs approval' },
        10
      );
      return;
    }

    task.status = 'planning';
    this.tasks.set(task.id, task);
    ActionLedger.updateResult(ledgerEntry.actionId, { result: 'Autonomy started' }, 10);

    // Simulate background agent loop
    setTimeout(() => this.runLoop(task.id), 100);
  }

  private async runLoop(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'stopped' || task.status === 'failed' || task.status === 'paused')
      return;

    if (task.status === 'planning') {
      task.plan = ['Analyze', 'Execute steps', 'Verify'];
      task.status = 'executing';
      this.tasks.set(taskId, task);
      setTimeout(() => this.runLoop(taskId), 1000);
      return;
    }

    if (task.status === 'executing') {
      task.currentStepIndex++;
      if (task.currentStepIndex >= task.plan.length) {
        task.status = 'verifying';
      }
      this.tasks.set(taskId, task);
      setTimeout(() => this.runLoop(taskId), 1000);
      return;
    }

    if (task.status === 'verifying') {
      task.status = 'completed';
      this.tasks.set(taskId, task);
    }
  }

  async pauseTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'paused';
      this.tasks.set(taskId, task);
    }
  }

  async resumeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'paused') {
      task.status = 'executing';
      this.tasks.set(taskId, task);
      setTimeout(() => this.runLoop(taskId), 100);
    }
  }

  async killTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'stopped';
      this.tasks.set(taskId, task);
    }
  }

  async getTaskStatus(taskId: string): Promise<AutonomyStatus> {
    return this.tasks.get(taskId)?.status || 'failed';
  }

  async getTaskEvents(taskId: string): Promise<AutonomyEvent[]> {
    return this.events.get(taskId) || [];
  }
}
