import { Hono } from 'hono';
import { ActionLedger } from '@ownpilot/core/security';
import { apiResponse } from './helpers.js';

export const ledgerRoutes = new Hono();

// =============================================================================
// GET / - Get action ledger entries
// =============================================================================

ledgerRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string;
  const workspaceId = c.req.query('workspaceId');
  
  let entries;
  if (workspaceId) {
    entries = await ActionLedger.getByWorkspaceId(workspaceId, userId);
  } else {
    entries = await ActionLedger.getEntries(userId);
  }
  
  const reversed = [...entries].reverse();

  return apiResponse(c, {
    entries: reversed,
    total: reversed.length,
  });
});
