import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, apiResponse, getUserId, getWorkspaceId } from './helpers.js';
import { ExecutionTaskService } from '../services/execution-task-service.js';

const submission = z
  .object({
    workflowId: z.string().min(1).max(200),
    requestKey: z.string().min(1).max(200),
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const executionTaskRoutes = new Hono();
executionTaskRoutes.use('*', async (c, next) => {
  if (!c.get('userId')) return apiError(c, 'Authentication required', 401);
  if (!/^[\w.-]{1,200}$/.test(getWorkspaceId(c))) return apiError(c, 'Invalid workspace', 400);
  return next();
});
executionTaskRoutes.onError((error, c) => {
  const message = error.message;
  if (/not found|access denied/i.test(message))
    return apiError(c, 'Execution task or workflow not found', 404);
  if (/conflict|transition|changed|stale|approval|waiting/i.test(message))
    return apiError(c, message, 409);
  return apiError(c, 'Execution task operation failed', 500);
});
executionTaskRoutes.get('/', async (c) =>
  apiResponse(c, {
    tasks: await new ExecutionTaskService(getUserId(c), getWorkspaceId(c)).repo.list(),
  })
);
executionTaskRoutes.post('/', async (c) => {
  const parsed = submission.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return apiError(c, 'workflowId, requestKey and valid inputs are required', 400);
  return apiResponse(
    c,
    await new ExecutionTaskService(getUserId(c), getWorkspaceId(c)).start(parsed.data),
    202
  );
});
executionTaskRoutes.get('/:id', async (c) =>
  apiResponse(
    c,
    await new ExecutionTaskService(getUserId(c), getWorkspaceId(c)).repo.detail(c.req.param('id'))
  )
);
executionTaskRoutes.post('/:id/cancel', async (c) =>
  apiResponse(
    c,
    await new ExecutionTaskService(getUserId(c), getWorkspaceId(c)).cancel(c.req.param('id'))
  )
);
executionTaskRoutes.post('/:id/approvals/:approvalId/approve', async (c) =>
  apiResponse(
    c,
    await new ExecutionTaskService(getUserId(c), getWorkspaceId(c)).approve(
      c.req.param('id'),
      c.req.param('approvalId')
    ),
    202
  )
);
executionTaskRoutes.post('/:id/approvals/:approvalId/deny', async (c) => {
  const service = new ExecutionTaskService(getUserId(c), getWorkspaceId(c));
  const detail = await service.repo.detail(c.req.param('id'));
  if (!detail.approvals.some((a) => a.id === c.req.param('approvalId') && a.status === 'pending'))
    return apiError(c, 'Approval not found', 404);
  return apiResponse(c, await service.cancel(detail.task.id));
});
