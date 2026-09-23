import { createHash, randomUUID } from 'node:crypto';
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerSessionBinding,
  ComputerUseProvider,
  BrowserProvider,
} from '@ownpilot/core/computer';
import {
  COMPUTER_VIEWPORT,
  COMPUTER_MAX_SCREENSHOT_BYTES,
  COMPUTER_KEYS,
  COMPUTER_HOTKEYS,
  validateComputerPoint,
} from '@ownpilot/core/computer';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import type { Capability } from '@ownpilot/core/security';
import {
  executionTaskContext,
  computerStepContext,
  assertExecutionTaskActive,
} from '../execution-task-context.js';
import type { ExecutionTaskContext } from '../execution-task-context.js';
import { ExecutionTasksRepository } from '../../db/repositories/execution-tasks.js';
import { getIdempotencyKeysRepository } from '../../db/repositories/idempotency-keys.js';
import { createWorkflowApprovalsRepository } from '../../db/repositories/workflows/approvals.js';
import { PuppeteerComputerUseProvider } from './computer-use-provider.js';
import { getLog } from '../log.js';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_SESSION_TIMEOUT_MS,
  BROWSER_MAX_PAGES,
  BROWSER_MAX_TEXT_LENGTH,
} from '../../config/defaults.js';

type Provider = ComputerUseProvider & BrowserProvider;
const log = getLog('ComputerService');
export const COMPUTER_LIMITS = {
  lifetimeMs: BROWSER_SESSION_TIMEOUT_MS,
  timeoutMs: BROWSER_ACTION_TIMEOUT_MS,
  actions: 100,
  captures: 30,
  sessions: BROWSER_MAX_PAGES,
  totalSessions: 20,
} as const;
interface Session {
  binding: ComputerSessionBinding;
  provider: Provider;
  count: number;
  captures: number;
  closed: boolean;
  busy: boolean;
  buttonDown: boolean;
  timer: ReturnType<typeof setTimeout>;
}

function hash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, canonical(val)])
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function computerCapability(action: ComputerAction): Capability {
  if (['execute_shell', 'read_file', 'write_file'].includes(action.type))
    throw new Error('Host computer actions are prohibited');
  if (action.type === 'screenshot') return 'computer.read';
  if (
    ['click', 'doubleClick', 'mouseDown', 'mouseUp', 'mouseMove', 'hover', 'scroll'].includes(
      action.type
    )
  )
    return 'computer.mouse';
  if (
    ['type', 'typeText', 'press_key', 'keyPress', 'hotkey', 'select', 'fill_form'].includes(
      action.type
    )
  )
    return 'computer.keyboard';
  if (
    ['inspect_page', 'find', 'extract', 'get_state', 'accessibility_tree', 'wait'].includes(
      action.type
    )
  )
    return 'browser.read';
  if (['navigate', 'navigate_back', 'navigate_forward', 'reload'].includes(action.type))
    return 'browser.navigate';
  throw new Error('Unsupported computer action');
}

function validate(action: ComputerAction) {
  computerCapability(action);
  const p = action.params;
  if (!p || typeof p !== 'object' || Array.isArray(p))
    throw new Error('Invalid computer parameters');
  if (JSON.stringify(p).length > BROWSER_MAX_TEXT_LENGTH * 2)
    throw new Error('Computer input too large');
  if (
    ['mouseMove', 'doubleClick', 'mouseDown', 'mouseUp'].includes(action.type) ||
    (action.type === 'click' && p.selector === undefined)
  )
    validateComputerPoint(p.x, p.y);
  if (
    ['keyPress', 'press_key'].includes(action.type) &&
    !COMPUTER_KEYS.some((key) => key === p.key)
  )
    throw new Error('Unsupported computer key');
  if (
    action.type === 'hotkey' &&
    (!Array.isArray(p.keys) ||
      !COMPUTER_HOTKEYS.some((key) => key === (p.keys as unknown[]).join('+')))
  )
    throw new Error('Unsupported computer hotkey');
  if (
    ['type', 'typeText'].includes(action.type) &&
    (typeof p.text !== 'string' || p.text.length > BROWSER_MAX_TEXT_LENGTH)
  )
    throw new Error('Invalid computer text');
  if (action.type === 'screenshot' && Object.keys(p).length)
    throw new Error('Computer screenshots are viewport-only');
  if (
    action.type === 'scroll' &&
    p.deltaY !== undefined &&
    (typeof p.deltaX !== 'number' ||
      typeof p.deltaY !== 'number' ||
      !Number.isFinite(p.deltaX) ||
      !Number.isFinite(p.deltaY) ||
      Math.abs(p.deltaX) > 1280 ||
      Math.abs(p.deltaY) > 800)
  )
    throw new Error('Invalid computer scroll');
}

export class ComputerService {
  private static sessions = new Map<string, Session>();
  constructor(
    private factory: (ctx: ExecutionTaskContext, binding: ComputerSessionBinding) => Provider = (
      ctx,
      binding
    ) => new PuppeteerComputerUseProvider(ctx, binding)
  ) {}

  static async closeTask(userId: string, workspaceId: string, taskId: string) {
    const key = JSON.stringify([userId, workspaceId, taskId]);
    const session = this.sessions.get(key);
    if (session) {
      session.closed = true;
      clearTimeout(session.timer);
      await session.provider.cancel();
      this.sessions.delete(key);
    }
  }

  private session(ctx: ExecutionTaskContext): Session {
    const key = JSON.stringify([ctx.userId, ctx.workspaceId, ctx.taskId]);
    const existing = ComputerService.sessions.get(key);
    if (existing) {
      if (existing.closed) throw new Error('Closed or stale computer session');
      return existing;
    }
    const active = [...ComputerService.sessions.values()];
    if (
      active.length >= COMPUTER_LIMITS.totalSessions ||
      active.filter((s) => s.binding.userId === ctx.userId).length >= COMPUTER_LIMITS.sessions
    )
      throw new Error('Computer concurrent session limit');
    const binding = {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      executionTaskId: ctx.taskId,
      sessionId: randomUUID(),
    };
    const session: Session = {
      binding,
      provider: this.factory(ctx, binding),
      count: 0,
      captures: 0,
      busy: false,
      buttonDown: false,
      closed: false,
      timer: setTimeout(() => {
        session.closed = true;
        void session.provider
          .cancel()
          .then(() => ComputerService.sessions.delete(key))
          .catch(() => log.warn('Browser resource cleanup failed'));
      }, COMPUTER_LIMITS.lifetimeMs),
    };
    session.timer.unref?.();
    ComputerService.sessions.set(key, session);
    return session;
  }

  async executeAction(action: ComputerAction): Promise<ComputerActionResult> {
    const ctx = executionTaskContext.getStore();
    const step = computerStepContext.getStore();
    if (
      !ctx?.userId ||
      !ctx.workspaceId ||
      !ctx.taskId ||
      !ctx.jobId ||
      !ctx.leaseToken ||
      !step?.runId ||
      !step.nodeId
    )
      return {
        success: false,
        outcome: 'DENIED',
        error: 'Missing durable computer execution context',
      };
    let session: Session | undefined;
    let ledgerId: string | undefined;
    let claimed = false;
    let attempted = false;
    let operationId = '';
    let release = false;
    const started = Date.now();
    const repo = new ExecutionTasksRepository(ctx.userId, ctx.workspaceId);
    const effects = getIdempotencyKeysRepository();
    try {
      await assertExecutionTaskActive();
      await repo.assertComputerWorker(ctx.taskId, ctx.jobId, ctx.leaseToken, step.runId);
      validate(action);
      const capability = computerCapability(action);
      const permitted =
        !capability.startsWith('computer.') || step.capabilities.includes(capability);
      if (permitted) {
        session = this.session(ctx);
        if (session.busy) throw new Error('Computer session is busy');
        session.busy = true;
        release = true;
      }
      const intrinsicRisk = new RiskEngine().classify(capability, `computer.${action.type}`);
      // Moving a held mouse button is a drag, not a read-only pointer movement.
      const risk = session?.buttonDown && capability === 'computer.mouse' ? 'HIGH' : intrinsicRisk;
      const policy = new PolicyEngine().evaluate({
        identity: { userId: ctx.userId, workspaceId: ctx.workspaceId, roles: ['user'] },
        action: `computer.${action.type}`,
        resource: ctx.taskId,
        capability,
        risk,
        environment: 'production',
        autonomous: true,
        requestedParameters: action.params,
      });
      const decision = permitted ? policy.decision : 'DENY';
      // Audit only structural metadata; never text, selectors, URLs, screenshots or provider errors.
      const entry = await ActionLedger.record({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        executionTaskId: ctx.taskId,
        runId: step.runId,
        sessionId: session?.binding.sessionId,
        tool: 'computer_service',
        action: `computer.${action.type}`,
        resource: JSON.stringify({
          nodeId: step.nodeId,
          x: typeof action.params.x === 'number' ? action.params.x : undefined,
          y: typeof action.params.y === 'number' ? action.params.y : undefined,
          viewport: COMPUTER_VIEWPORT,
        }),
        resourceType: 'computer_session',
        capability,
        policyDecision: decision,
        riskLevel: risk,
        executionEnvironment: 'isolated_browser',
        durationMs: 0,
      });
      ledgerId = entry.actionId;
      if (decision === 'DENY') throw new Error('Computer capability or policy denied');
      session = this.session(ctx);
      if (++session.count > COMPUTER_LIMITS.actions)
        throw new Error('Computer action/iteration limit');
      if (action.type === 'screenshot' && ++session.captures > COMPUTER_LIMITS.captures)
        throw new Error('Computer capture limit');
      operationId = JSON.stringify([
        'computer',
        ctx.workspaceId,
        ctx.taskId,
        step.runId,
        step.nodeId,
        step.effectIndex++,
      ]);
      const requestHash = hash({ action, binding: session.binding, operationId });
      const approvals = createWorkflowApprovalsRepository(ctx.userId);
      const priorApproval = ctx.approvalId
        ? await approvals.get(ctx.approvalId, ctx.workspaceId)
        : null;
      const resumingThisNode =
        priorApproval?.nodeId === step.nodeId && priorApproval.workflowLogId === step.runId;
      if (decision === 'REQUIRE_APPROVAL' && !resumingThisNode) {
        const approval = await approvals.create({
          workflowId: ctx.workflowId,
          workflowLogId: step.runId,
          nodeId: step.nodeId,
          workspaceId: ctx.workspaceId,
          action: `computer.${action.type}`,
          capability,
          message: `Approve ${action.type} in isolated computer session`,
          expiresAt: new Date(Date.now() + COMPUTER_LIMITS.lifetimeMs),
          context: { sessionId: session.binding.sessionId, requestHash, operationId },
        });
        await ActionLedger.updateResult(
          ledgerId,
          { result: 'WAITING_APPROVAL' },
          Date.now() - started
        );
        return {
          success: false,
          outcome: 'WAITING_APPROVAL',
          approvalId: approval.id,
          sessionId: session.binding.sessionId,
        };
      }
      await repo.whileRunning(ctx.taskId, async () => {
        await repo.assertComputerWorker(ctx.taskId, ctx.jobId!, ctx.leaseToken!, step.runId);
        if (
          decision === 'REQUIRE_APPROVAL' &&
          !(await approvals.consumeComputerApproval(
            ctx.approvalId!,
            ctx.workspaceId,
            step.runId,
            step.nodeId,
            ctx.taskId,
            session!.binding.sessionId,
            requestHash,
            capability
          ))
        )
          throw new Error('Computer approval expired, mismatched or replayed');
        const claim = await effects.claimOperation(
          ctx.userId,
          operationId,
          requestHash,
          ctx.leaseToken!
        );
        if (!claim.claimed)
          throw new Error('Computer operation already claimed; replay prohibited');
        claimed = true;
      });
      // Persist session identity as an effect too: a restarted worker must not silently create a new UI.
      const sessionEffect = await effects.claimOperation(
        ctx.userId,
        JSON.stringify(['computer-session', ctx.workspaceId, ctx.taskId]),
        hash(session.binding),
        session.binding.sessionId
      );
      if (!sessionEffect.claimed && sessionEffect.requestHash !== hash(session.binding))
        throw new Error('Computer session lost after restart');
      const current = session;
      const actionController = new AbortController();
      const abort = () => {
        actionController.abort();
        current.closed = true;
        void current.provider.cancel().catch(() => log.warn('Browser resource cleanup failed'));
      };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: () => void = () => {};
      const stopped = new Promise<never>((_, reject) => {
        rejectAbort = () => {
          abort();
          reject(new Error('Computer execution cancelled'));
        };
        timeout = setTimeout(
          () => {
            abort();
            reject(new Error('Computer action timeout'));
          },
          Math.min(
            action.timeoutMs && action.timeoutMs > 0 ? action.timeoutMs : COMPUTER_LIMITS.timeoutMs,
            COMPUTER_LIMITS.timeoutMs
          )
        );
      });
      ctx.signal.addEventListener('abort', rejectAbort, { once: true });
      try {
        ctx.signal.throwIfAborted();
        attempted = true;
        const data = await Promise.race([
          this.perform(current.provider, action, actionController.signal),
          stopped,
        ]);
        ctx.signal.throwIfAborted();
        await assertExecutionTaskActive();
        await repo.assertComputerWorker(ctx.taskId, ctx.jobId, ctx.leaseToken, step.runId);
        if (current.closed) throw new Error('Computer session closed during action');
        if (action.type === 'mouseDown') current.buttonDown = true;
        if (['mouseUp', 'click', 'doubleClick'].includes(action.type)) current.buttonDown = false;
        await repo.whileRunning(ctx.taskId, async () => {
          await repo.assertComputerWorker(ctx.taskId, ctx.jobId!, ctx.leaseToken!, step.runId);
          await effects.finishOperation(ctx.userId, operationId, ctx.leaseToken!, 'success', {
            actionId: ledgerId,
            sessionId: current.binding.sessionId,
          });
          await ActionLedger.updateResult(ledgerId!, { result: 'SUCCESS' }, Date.now() - started);
        });
        return {
          success: true,
          outcome: 'SUCCESS',
          data,
          actionId: ledgerId,
          sessionId: current.binding.sessionId,
        };
      } finally {
        clearTimeout(timeout);
        ctx.signal.removeEventListener('abort', rejectAbort);
      }
    } catch {
      const outcome = attempted ? 'UNKNOWN' : 'DENIED';
      try {
        if (claimed)
          await effects.finishOperation(
            ctx.userId,
            operationId,
            ctx.leaseToken,
            attempted ? 'unknown' : 'failed',
            { outcome }
          );
        if (ledgerId)
          await ActionLedger.updateResult(ledgerId, { result: outcome }, Date.now() - started);
      } finally {
        if (session && attempted) {
          session.closed = true;
          await session.provider.cancel();
        }
      }
      return {
        success: false,
        outcome,
        actionId: ledgerId,
        error: attempted
          ? 'Computer outcome UNKNOWN; automatic retry prohibited'
          : 'Computer action denied: context, capability, policy, approval or resource limit',
      };
    } finally {
      if (release && session) session.busy = false;
    }
  }

  private async perform(
    provider: Provider,
    action: ComputerAction,
    signal: AbortSignal
  ): Promise<unknown> {
    await provider.initialize(signal);
    signal.throwIfAborted();
    const p = action.params;
    switch (action.type) {
      case 'screenshot': {
        const shot = await provider.screenshot();
        if (
          typeof shot.screenshot !== 'string' ||
          shot.screenshot.length > Math.ceil(COMPUTER_MAX_SCREENSHOT_BYTES / 3) * 4
        )
          throw new Error('Computer screenshot limit');
        const bytes = Buffer.from(shot.screenshot, 'base64');
        if (
          shot.width !== COMPUTER_VIEWPORT.width ||
          shot.height !== COMPUTER_VIEWPORT.height ||
          bytes.byteLength > COMPUTER_MAX_SCREENSHOT_BYTES ||
          bytes.length < 24 ||
          !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          bytes.readUInt32BE(16) !== shot.width ||
          bytes.readUInt32BE(20) !== shot.height
        )
          throw new Error('Computer screenshot limit');
        return shot;
      }
      case 'mouseMove':
        return provider.mouseMove(p.x as number, p.y as number);
      case 'doubleClick':
        return provider.doubleClick(p.x as number, p.y as number);
      case 'mouseDown':
        return provider.mouseDown(p.x as number, p.y as number);
      case 'mouseUp':
        return provider.mouseUp(p.x as number, p.y as number);
      case 'keyPress':
      case 'press_key':
        return provider.keyPress(p.key as string);
      case 'typeText':
        return provider.typeText(p.text as string);
      case 'hotkey':
        return provider.hotkey(p.keys as string[]);
      case 'click':
        if (p.selector === undefined) return provider.click(p.x as number, p.y as number);
        break;
      case 'scroll':
        if (p.deltaY !== undefined) return provider.scroll(p.deltaX as number, p.deltaY as number);
        break;
    }
    const result =
      action.type === 'navigate'
        ? await provider.navigate(p.url as string)
        : await provider.executeAction(action);
    if (!result.success) throw new Error('Computer provider failed');
    return result.data;
  }
}
