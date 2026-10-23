import { Hono } from 'hono';
import { apiError, ERROR_CODES } from './helpers.js';

export const computerRoutes = new Hono();
// Legacy in-memory tasks cannot prove a durable execution/approval binding.
computerRoutes.all('/tasks', (c) =>
  apiError(
    c,
    {
      code: ERROR_CODES.INVALID_INPUT,
      message:
        'Use authenticated /execution-tasks with a browser workflow and explicit computerCapabilities.',
    },
    410
  )
);
computerRoutes.all('/tasks/:id/execute', (c) =>
  apiError(
    c,
    {
      code: ERROR_CODES.INVALID_INPUT,
      message: 'Computer actions require the durable execution task worker.',
    },
    410
  )
);
