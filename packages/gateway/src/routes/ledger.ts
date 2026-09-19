import { Hono } from 'hono';
import { ActionLedger } from '@ownpilot/core/security';
import { apiResponse } from './helpers.js';

export const ledgerRoutes = new Hono();

// =============================================================================
// GET / - Get action ledger entries
// =============================================================================

ledgerRoutes.get('/', (c) => {
  const entries = ActionLedger.getEntries();
  const reversed = [...entries].reverse();

  return apiResponse(c, {
    entries: reversed,
    total: reversed.length,
  });
});
