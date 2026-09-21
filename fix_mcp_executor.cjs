const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/client.ts';
let code = fs.readFileSync(file, 'utf8');

const newExecutor = `      const executor = async (
        args: Record<string, unknown>,
        context?: import('@ownpilot/core/tools').ToolContext
      ): Promise<ToolExecutionResult> => {
        // QA-025/QA-026: Workspace/User Isolation
        const userId = context?.userId || context?.metadata?.userId;
        if (!userId) {
          return {
            content: 'PolicyEngine DENY: Missing execution context (userId) for MCP tool execution',
            isError: true,
          };
        }

        // Verify provider ownership
        const repo = getMcpServersRepo();
        const serverRecord = await repo.getByName(serverName, userId as string);
        if (!serverRecord) {
          return {
            content: \`PolicyEngine DENY: MCP server "\${serverName}" is not authorized or not found for user \${userId}\`,
            isError: true,
          };
        }
        if (!serverRecord.enabled) {
          return {
            content: \`PolicyEngine DENY: MCP server "\${serverName}" is disabled\`,
            isError: true,
          };
        }

        try {
          const result = await this.callTool(serverName, tool.name, args);`;

code = code.replace(/const executor = async \(args: Record<string, unknown>\): Promise<ToolExecutionResult> => \{\s*try \{\s*const result = await this\.callTool\(serverName, tool\.name, args\);/g, newExecutor);
fs.writeFileSync(file, code, 'utf8');
