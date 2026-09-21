import { getUserId, getWorkspaceId } from './helpers.js';
import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { AutonomyService } from '../services/autonomy/service.js';
import type { AutonomousTask } from '@ownpilot/core/autonomy';


export const autonomyRoutes = new Hono();
const autonomyService = new AutonomyService();

// Mock memory for UI
const allTasks: AutonomousTask[] = [];

autonomyRoutes.get('/tasks', (c) => {
  return apiResponse(c, { tasks: allTasks });
});

autonomyRoutes.post('/tasks', async (c) => {
  const body = (await parseJsonBody(c)) as { goal: string } | null;
  if (!body || !body.goal)
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing goal' }, 400);

  const newTask: AutonomousTask = {
    id: 'auto_' + Date.now(),
    goal: body.goal,
    profileId: 'default',
    status: 'idle',
    userId: getUserId(c),
    workspaceId: getWorkspaceId(c),
    plan: [],
    currentStepIndex: 0,
    failures: 0,
    spentUsd: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  allTasks.push(newTask);
  await autonomyService.startTask(newTask);

  return apiResponse(c, newTask);
});

autonomyRoutes.post('/tasks/:id/action', async (c) => {
  const id = c.req.param('id');
  const task = allTasks.find((t) => t.id === id);
  if (!task) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);

  const body = (await parseJsonBody(c)) as { action: 'pause' | 'resume' | 'kill' } | null;
  if (!body) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'No action' }, 400);

  if (body.action === 'pause') await autonomyService.pauseTask(id);
  if (body.action === 'resume') await autonomyService.resumeTask(id);
  if (body.action === 'kill') await autonomyService.killTask(id);

  task.status = await autonomyService.getTaskStatus(id);

  return apiResponse(c, task);
});
