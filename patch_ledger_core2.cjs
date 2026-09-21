const fs = require('fs');
let file = 'packages/core/src/security/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/public static async getByWorkspaceId\(\s*workspaceId: string,\s*userId\?: string\s*\): Promise<ActionLedgerEntry\[\]> \{/g, "public static async getByWorkspaceId(workspaceId: string, userId?: string, limit?: number, offset?: number): Promise<ActionLedgerEntry[]> {");

code = code.replace(/return arr\.map\(\(e\) => \(\{ \.\.\.e \}\)\);/g, "const res = arr.slice(offset || 0, limit ? (offset || 0) + limit : undefined); return res.map((e) => ({ ...e }));");

fs.writeFileSync(file, code, 'utf8');
