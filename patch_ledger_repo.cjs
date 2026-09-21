const fs = require('fs');
let file = 'packages/gateway/src/db/repositories/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/async getEntries\(userId\?: string\): Promise<ActionLedgerEntry\[\]> \{/g, "async getEntries(userId?: string, limit: number = 100, offset: number = 0): Promise<ActionLedgerEntry[]> {");

code = code.replace(
  /'SELECT \* FROM action_ledger WHERE user_id = \$1 ORDER BY timestamp ASC',/g,
  "'SELECT * FROM action_ledger WHERE user_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3',"
);
code = code.replace(
  /\[userId\]/g,
  "[userId, limit, offset]"
);

code = code.replace(
  /const rows = await this\.query<LedgerRow>\('SELECT \* FROM action_ledger ORDER BY timestamp ASC'\);/g,
  "const rows = await this.query<LedgerRow>('SELECT * FROM action_ledger ORDER BY timestamp ASC LIMIT $1 OFFSET $2', [limit, offset]);"
);


code = code.replace(/async getByWorkspaceId\(workspaceId: string, userId\?: string\): Promise<ActionLedgerEntry\[\]> \{/g, "async getByWorkspaceId(workspaceId: string, userId?: string, limit: number = 100, offset: number = 0): Promise<ActionLedgerEntry[]> {");

code = code.replace(
  /'SELECT \* FROM action_ledger WHERE workspace_id = \$1 AND user_id = \$2 ORDER BY timestamp ASC',/g,
  "'SELECT * FROM action_ledger WHERE workspace_id = $1 AND user_id = $2 ORDER BY timestamp ASC LIMIT $3 OFFSET $4',"
);
code = code.replace(
  /\[workspaceId, userId\]/g,
  "[workspaceId, userId, limit, offset]"
);

code = code.replace(
  /'SELECT \* FROM action_ledger WHERE workspace_id = \$1 ORDER BY timestamp ASC',/g,
  "'SELECT * FROM action_ledger WHERE workspace_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3',"
);
code = code.replace(
  /\[workspaceId\]/g,
  "[workspaceId, limit, offset]"
);

fs.writeFileSync(file, code, 'utf8');
