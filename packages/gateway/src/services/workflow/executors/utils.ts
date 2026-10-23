/**
 * Workflow Node Executor — Shared Utilities
 *
 * Helpers used by multiple executor families:
 *  - `safeVmEval`            — hardened vm.runInContext for user-supplied expressions
 *  - `toToolExecResult`      — convert ToolServiceResult to ToolExecutionResult
 *  - `resolveWorkflowToolName` — handle dot-stripped tool names from the AI copilot
 *
 * Also exports the constants shared between filter/map/aggregate/etc.
 */

import { validateToolCode, executeIsolatedJavaScript } from '@ownpilot/core/sandbox';
import type { IToolService, ToolServiceResult } from '@ownpilot/core/services';
import { getLog } from '../../log.js';
import type { ToolExecutionResult } from '../types.js';

export const log = getLog('WorkflowService');

/** Maximum array size for per-element VM evaluation (filter/map nodes). */
export const MAX_ARRAY_EVAL_SIZE = 10_000;

/** Maximum expression length for VM evaluation (prevent memory exhaustion). */
const MAX_EXPRESSION_LENGTH = 10_000;

/**
 * Safe VM expression evaluator — isolated via Docker to satisfy QA-009 requirements.
 */
export async function safeVmEval(
  expression: string,
  context: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`);
  }

  const validation = validateToolCode(expression);
  if (!validation.valid) {
    throw new Error(`Expression blocked: ${validation.errors.join('; ')}`);
  }

  // Ensure JSON-serializable context
  try {
    JSON.stringify(context ?? {});
  } catch {
    throw new Error(
      'Transformer input must be JSON-serializable. Functions, Symbols, and circular values are not supported.'
    );
  }

  return await executeIsolatedJavaScript(`return (${expression});`, context, {
    timeout: timeoutMs,
  });
}

/** Convert ToolServiceResult to ToolExecutionResult. */
export function toToolExecResult(r: ToolServiceResult): ToolExecutionResult {
  if (r.isError) {
    return { success: false, error: r.content };
  }
  try {
    return { success: true, result: JSON.parse(r.content) };
  } catch {
    return { success: true, result: r.content };
  }
}

/**
 * Resolve a tool name that may have dots stripped by the AI copilot.
 * e.g. "mcpgithublist_repositories" -> "mcp.github.list_repositories"
 */
export function resolveWorkflowToolName(name: string, toolService: IToolService): string {
  if (toolService.has(name)) return name;

  const normalized = name.replace(/\./g, '').toLowerCase();
  for (const def of toolService.getDefinitions()) {
    const defNormalized = def.name.replace(/\./g, '').toLowerCase();
    if (defNormalized === normalized) {
      log.info(`Resolved workflow tool name "${name}" -> "${def.name}"`);
      return def.name;
    }
  }

  return name;
}
