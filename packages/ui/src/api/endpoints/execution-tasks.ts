import { apiClient } from '../client';
import type { ExecutionTask } from '@ownpilot/core/services';
export type { ExecutionTask };
export interface ExecutionTaskDetail {
  task: ExecutionTask;
  run: { id: string; status: string; nodeResults: Record<string, unknown>; error?: string } | null;
  approvals: {
    id: string;
    nodeId: string;
    status: string;
    message: string | null;
    expiresAt: string | null;
  }[];
  auditActionIds: string[];
}
export const executionTasksApi = {
  list: () => apiClient.get<{ tasks: ExecutionTask[] }>('/execution-tasks'),
  start: (workflowId: string, requestKey: string) =>
    apiClient.post<ExecutionTask>('/execution-tasks', { workflowId, requestKey }),
  detail: (id: string) =>
    apiClient.get<ExecutionTaskDetail>(`/execution-tasks/${encodeURIComponent(id)}`),
  cancel: (id: string) =>
    apiClient.post<ExecutionTask>(`/execution-tasks/${encodeURIComponent(id)}/cancel`),
  approve: (id: string, approvalId: string) =>
    apiClient.post<ExecutionTask>(
      `/execution-tasks/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}/approve`
    ),
  deny: (id: string, approvalId: string) =>
    apiClient.post<ExecutionTask>(
      `/execution-tasks/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}/deny`
    ),
};
