const fs = require('fs');
let file = 'packages/core/src/security/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/getEntries\(userId\?: string\): Promise<ActionLedgerEntry\[\]>;/g, "getEntries(userId?: string, limit?: number, offset?: number): Promise<ActionLedgerEntry[]>;");
code = code.replace(/getByWorkspaceId\(workspaceId: string, userId\?: string\): Promise<ActionLedgerEntry\[\]>;/g, "getByWorkspaceId(workspaceId: string, userId?: string, limit?: number, offset?: number): Promise<ActionLedgerEntry[]>;");

code = code.replace(/public static async getEntries\(userId\?: string\): Promise<ActionLedgerEntry\[\]> \{/g, "public static async getEntries(userId?: string, limit?: number, offset?: number): Promise<ActionLedgerEntry[]> {");
code = code.replace(/if \(this\.provider\) return this\.provider\.getEntries\(userId\);/g, "if (this.provider) return this.provider.getEntries(userId, limit, offset);");

code = code.replace(/public static async getByWorkspaceId\(workspaceId: string, userId\?: string\): Promise<ActionLedgerEntry\[\]> \{/g, "public static async getByWorkspaceId(workspaceId: string, userId?: string, limit?: number, offset?: number): Promise<ActionLedgerEntry[]> {");
code = code.replace(/if \(this\.provider\) return this\.provider\.getByWorkspaceId\(workspaceId, userId\);/g, "if (this.provider) return this.provider.getByWorkspaceId(workspaceId, userId, limit, offset);");

// apply limit and offset to in-memory fallback
code = code.replace(/return filtered\.map\(\(e\) => \(\{ \.\.\.e \}\)\);/g, "const res = filtered.slice(offset || 0, limit ? (offset || 0) + limit : undefined); return res.map((e) => ({ ...e }));");
code = code.replace(/return entries\.map\(\(e\) => \(\{ \.\.\.e \}\)\);/g, "const res = entries.slice(offset || 0, limit ? (offset || 0) + limit : undefined); return res.map((e) => ({ ...e }));");


fs.writeFileSync(file, code, 'utf8');
