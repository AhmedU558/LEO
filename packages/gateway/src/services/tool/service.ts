/**
 * ToolService Implementation
 *
 * Wraps the existing ToolRegistry to provide IToolService interface.
 * This is an adapter — the existing tool registration code continues to work.
 *
 * When an execSource is provided, execution is routed through the shared
 * executeTool() function which applies ToolPermissionService checks.
 *
 * Usage:
 *   const tools = getToolService();
 *   const defs = tools.getDefinitions();
 *   await tools.execute('get_current_time', {});
 */

import type { IToolService, ToolServiceResult } from '@ownpilot/core/services';
import type { ToolDefinition, ToolMiddleware, ToolSource } from '@ownpilot/core/tools';
import { getSharedToolRegistry, executeTool } from './executor.js';
import type { ToolExecContext } from '../permission/utils.js';

/**
 * Render a tool result as the string content callers expect.
 *
 * A string passes through unchanged (including ''); anything else is JSON, so
 * an object result stays inspectable instead of collapsing to
 * '[object Object]'. `null` and `undefined` render as '' — that is what the
 * chat/plan/workflow callers already saw for an empty result and changing it
 * would alter their rendered output.
 */
function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ============================================================================
// ToolService Adapter
// ============================================================================

export class ToolService implements IToolService {
  private get registry() {
    return getSharedToolRegistry(this.userId);
  }

  constructor(private readonly userId: string = 'default') {}

  async execute(
    name: string,
    args: Record<string, unknown>,
    context?: {
      conversationId?: string;
      userId?: string;
      execSource?: string;
      operationId?: string;
      signal?: AbortSignal;
    }
  ): Promise<ToolServiceResult> {
    const userId = context?.userId ?? this.userId;

    // QA-016 / QA-007: every call routes through executeTool().
    //
    // This used to branch: with `execSource` it went through executeTool() and
    // got permission enforcement, the atomic idempotency claim and the audit
    // record; without it, it dropped straight to registry.executeToolCall()
    // and got none of them. That made the protection a property of the caller
    // rather than of the effect boundary — any caller could opt out of policy
    // and idempotency by simply omitting one optional field. `system` is the
    // default source for callers that do not declare one.
    const execContext: ToolExecContext = {
      source: (context?.execSource as ToolExecContext['source']) ?? 'system',
      operationId: context?.operationId,
      signal: context?.signal,
    };

    // Reject unserialisable arguments before claiming an operation: the claim
    // fingerprints the arguments, so they must be representable.
    try {
      JSON.stringify(args);
    } catch {
      return { content: 'Invalid tool arguments: cannot serialize to JSON', isError: true };
    }

    const result = await executeTool(name, args, userId, undefined, execContext);
    if (!result.success) {
      return { content: result.error ?? 'Tool execution failed', isError: true };
    }
    return { content: stringifyContent(result.result), isError: false };
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.registry.getDefinition(name);
  }

  getDefinitions(): readonly ToolDefinition[] {
    return this.registry.getDefinitions();
  }

  getDefinitionsBySource(source: ToolSource): readonly ToolDefinition[] {
    return this.registry.getToolsBySource(source).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getNames(): readonly string[] {
    return this.registry.getNames();
  }

  use(middleware: ToolMiddleware): void {
    this.registry.use(middleware);
  }

  getCount(): number {
    return this.registry.getNames().length;
  }
}

/**
 * Create a new ToolService instance.
 */
export function createToolService(userId?: string): IToolService {
  return new ToolService(userId);
}
