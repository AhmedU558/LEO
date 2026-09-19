import type { AutonomousTask, AutonomyStatus, AutonomyEvent } from './models.js';

export interface AutonomyEngine {
  startTask(task: AutonomousTask): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  killTask(taskId: string): Promise<void>;
  getTaskStatus(taskId: string): Promise<AutonomyStatus>;
  getTaskEvents(taskId: string): Promise<AutonomyEvent[]>;
}
