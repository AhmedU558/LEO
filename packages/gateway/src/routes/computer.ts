import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { ComputerService } from '../services/computer/service.js';
import type { ComputerTask, ComputerAction } from '@ownpilot/core/computer';
import { LOCAL_OWNER_ID, LOCAL_WORKSPACE_ID } from '../config/defaults.js';

export const computerRoutes = new Hono();
const computerService = new ComputerService();

// In-memory stubs for MVP (Production would use Postgres)
const tasks: ComputerTask[] = [];

computerRoutes.get('/tasks', (c) => {
  return apiResponse(c, { tasks });
});

computerRoutes.post('/tasks', async (c) => {
  const body = (await parseJsonBody(c)) as Partial<ComputerTask> | null;

  const newTask: ComputerTask = {
    id: 'ctask_' + Date.now(),
    userId: LOCAL_OWNER_ID,
    status: 'pending',
    actions: [],
    results: [],
    targetUrl: body?.targetUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  return apiResponse(c, newTask);
});

computerRoutes.post('/tasks/:id/execute', async (c) => {
  const id = c.req.param('id');
  const task = tasks.find((t) => t.id === id);
  if (!task) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Task not found' }, 404);

  const body = (await parseJsonBody(c)) as { action: ComputerAction } | null;
  if (!body || !body.action) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing action' }, 400);
  }

  task.status = 'running';
  task.actions.push(body.action);

  const result = await computerService.executeTaskAction(
    LOCAL_OWNER_ID,
    LOCAL_WORKSPACE_ID,
    task,
    body.action
  );

  task.results.push(result);
  task.status = result.success ? 'completed' : 'failed';
  task.updatedAt = new Date().toISOString();

  return apiResponse(c, { success: result.success, task, result });
});
