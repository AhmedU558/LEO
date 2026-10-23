/**
 * Permission Utilities
 *
 * Shared helpers for tool permission enforcement across execution contexts.
 */

import type { ExecutionPermissions } from '@ownpilot/core/tools';
import type { ToolRegistry } from '@ownpilot/core/tools';

/**
 * Downgrade 'prompt' permissions to 'blocked' for non-interactive contexts.
 * Used by triggers, plans, and workflows where there is no UI to prompt the user.
 */
export function downgradePromptToBlocked(perms: ExecutionPermissions): ExecutionPermissions {
  return {
    ...perms,
    execute_javascript:
      perms.execute_javascript === 'prompt' ? 'blocked' : perms.execute_javascript,
    execute_python: perms.execute_python === 'prompt' ? 'blocked' : perms.execute_python,
    execute_shell: perms.execute_shell === 'prompt' ? 'blocked' : perms.execute_shell,
    compile_code: perms.compile_code === 'prompt' ? 'blocked' : perms.compile_code,
    package_manager: perms.package_manager === 'prompt' ? 'blocked' : perms.package_manager,
  };
}

/**
 * Execution context for tool permission checks.
 * Identifies WHERE a tool is being called from, enabling
 * context-appropriate permission enforcement.
 */
export interface ToolExecContext {
  /** Stable caller-generated effect identity, reused only for retries of this operation. */
  operationId?: string;
  signal?: AbortSignal;
  /** The execution source requesting the tool */
  source: 'chat' | 'trigger' | 'plan' | 'workflow' | 'skill' | 'coding-agent' | 'system' | 'mcp';
  /** Code-execution category permissions (from user settings) */
  executionPermissions?: ExecutionPermissions;
  /** Agent ID if called from an agent */
  agentId?: string;
  /** Skill/extension ID if called from a skill context */
  skillId?: string;
  /** Allowed tools declared by the active skill (undefined = no restriction) */
  skillAllowedTools?: string[];
  /** Specific CLI tool name (for run_cli_tool policy check) */
  cliToolName?: string;
  /**
   * Parent ToolContext to forward to the executor.
   *
   * Nested dispatch (`use_tool`, `batch_use_tool`, the CLI tool bridge) has a
   * live caller context carrying executionPermissions, approval callbacks,
   * workspace root and the config/credential bridges. Those callers used to
   * invoke the registry directly so they could pass it through — which also
   * meant they skipped the idempotency claim and the audit record. Carrying it
   * here lets them go through executeTool() without losing it.
   */
  parentContext?: Record<string, unknown>;
  /**
   * Registry to execute against, instead of the shared one.
   *
   * Chat agents and CLI coding agents each build their own `new ToolRegistry()`
   * with their own tool set. Routing them through the shared registry to gain
   * the idempotency claim would silently change WHICH tools resolve, so the
   * caller hands its own registry to the boundary rather than the boundary
   * assuming there is only one.
   */
  registry?: ToolRegistry;
}

/** Whether the context is non-interactive (no UI to prompt the user) */
export function isNonInteractiveContext(source: ToolExecContext['source']): boolean {
  // 'mcp' is non-interactive: an external MCP client (Claude Desktop, Cursor)
  // has no OwnPilot UI to satisfy an approval prompt, so prompt-policy tools must
  // downgrade to blocked rather than pass through as if a human could approve.
  return (
    source === 'trigger' ||
    source === 'plan' ||
    source === 'workflow' ||
    source === 'system' ||
    source === 'mcp'
  );
}
