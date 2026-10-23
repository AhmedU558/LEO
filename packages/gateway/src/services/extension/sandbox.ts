import { executeIsolatedJavaScript } from '@ownpilot/core/sandbox';

export class ExtensionSandboxManager {
  setCallToolHandler(_handler: (...args: any[]) => Promise<any>) {}

  async execute(options: {
    extensionId: string;
    toolName: string;
    code: string;
    args: Record<string, unknown>;
    grantedPermissions?: string[];
    ownerUserId?: string;
    maxMemory?: number;
    maxExecutionTime?: number;
  }) {
    const startTime = Date.now();
    try {
      const globals = { args: options.args, utils: {} };

      const wrappedCode = `
        const module = { exports: {} };
        ${options.code}
        return await (async () => {
          if (typeof module.exports === 'function') {
            return await module.exports(args, utils);
          }
          return module.exports;
        })();
      `;

      const value = await executeIsolatedJavaScript(wrappedCode, globals, {
        timeout: options.maxExecutionTime ?? 30000,
        memoryMB: options.maxMemory ? Math.floor(options.maxMemory / 1024 / 1024) : 128,
      });
      return { success: true, result: value, executionTime: Date.now() - startTime };
    } catch (e) {
      return { success: false, error: String(e), executionTime: Date.now() - startTime };
    }
  }
}

let instance: ExtensionSandboxManager | null = null;
export function getExtensionSandbox() {
  if (!instance) instance = new ExtensionSandboxManager();
  return instance;
}
export function resetExtensionSandbox() {
  instance = null;
}
