import { createHash, randomUUID } from 'node:crypto';
import type {
  ComputerAction,
  ComputerActionResult,
  ComputerSessionBinding,
  ComputerUseProvider,
  BrowserProvider,
  ComputerActionProposer,
  ComputerActionProposal,
  ComputerModelObservation,
  ComputerScreenshot,
  ScreenshotRedactor,
} from '@ownpilot/core/computer';
import {
  COMPUTER_VIEWPORT,
  COMPUTER_MAX_SCREENSHOT_BYTES,
  COMPUTER_KEYS,
  COMPUTER_HOTKEYS,
  validateComputerPoint,
  parseComputerProposal,
  validateComputerObservation,
  validateComputerObjective,
  COMPUTER_MODEL_LIMITS,
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
import { closeComputerVisionLoops } from './vision-loop.js';
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
  modelBusy: boolean;
  buttonDown: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export interface BoundComputerProposal {
  readonly binding: Readonly<ComputerSessionBinding>;
  readonly action: ComputerActionProposal;
  readonly observationActionId: string;
  readonly observationId: string;
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
  private static observations = new WeakMap<
    ComputerActionResult,
    {
      binding: ComputerSessionBinding;
      screenshot: string;
      actionId: string;
      version: number;
      image: ComputerScreenshot;
      observationId: string;
    }
  >();
  private static proposals = new WeakMap<
    BoundComputerProposal,
    {
      runId: string;
      nodeId: string;
      effectIndex: number;
      state: 'pending' | 'running' | 'waiting' | 'done';
      approvalId?: string;
      version: number;
      revision?: string;
    }
  >();
  constructor(
    private factory: (ctx: ExecutionTaskContext, binding: ComputerSessionBinding) => Provider = (
      ctx,
      binding
    ) => new PuppeteerComputerUseProvider(ctx, binding)
  ) {}

  private async assertModelScope(binding: ComputerSessionBinding): Promise<Session> {
    const ctx = executionTaskContext.getStore();
    const step = computerStepContext.getStore();
    if (
      !ctx ||
      !step ||
      !ctx.jobId ||
      !ctx.leaseToken ||
      ctx.userId !== binding.userId ||
      ctx.workspaceId !== binding.workspaceId ||
      ctx.taskId !== binding.executionTaskId
    )
      throw new Error('Invalid model execution scope');
    await assertExecutionTaskActive();
    await new ExecutionTasksRepository(ctx.userId, ctx.workspaceId).assertComputerWorker(
      ctx.taskId,
      ctx.jobId,
      ctx.leaseToken,
      step.runId
    );
    const session = ComputerService.sessions.get(
      JSON.stringify([ctx.userId, ctx.workspaceId, ctx.taskId])
    );
    if (
      !session ||
      session.closed ||
      session.busy ||
      session.binding.sessionId !== binding.sessionId
    )
      throw new Error('Stale model session');
    return session;
  }

  /** One proposal only. A trusted redactor must explicitly approve the transient screenshot disclosure. */
  async proposeAction(
    observation: ComputerActionResult,
    proposer: ComputerActionProposer,
    redact:
      | ScreenshotRedactor
      | ((
          image: { screenshot: string; viewport: typeof COMPUTER_VIEWPORT },
          signal: AbortSignal
        ) => Promise<ComputerModelObservation>),
    /**
     * The trusted caller's task goal. Supplied as an explicit argument by the
     * loop that owns the task, never read out of the ambient context and never
     * derived from the page.
     */
    objective?: string
  ): Promise<
    { outcome: 'PROPOSED'; proposal: BoundComputerProposal } | { outcome: 'DENIED'; error: string }
  > {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    let modelSession: Session | undefined;
    try {
      const captured = ComputerService.observations.get(observation);
      if (!captured) throw new Error('Unverified model observation');
      ComputerService.observations.delete(observation);
      const session = await this.assertModelScope(captured.binding);
      if (session.count !== captured.version || session.modelBusy)
        throw new Error('Stale model observation');
      session.modelBusy = true;
      modelSession = session;
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), COMPUTER_MODEL_LIMITS.timeoutMs);
      signal = AbortSignal.any([executionTaskContext.getStore()!.signal, controller.signal]);
      const stopped = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Model request stopped'));
        signal!.addEventListener('abort', onAbort, { once: true });
      });
      signal.throwIfAborted();
      const proposal = await Promise.race([
        (async () => {
          const prepared =
            typeof redact === 'function'
              ? await redact(
                  { screenshot: captured.screenshot, viewport: { ...COMPUTER_VIEWPORT } },
                  signal!
                )
              : (
                  await redact.redact({
                    image: captured.image,
                    binding: captured.binding,
                    observationId: captured.observationId,
                    signal: signal!,
                  })
                ).observation;
          signal!.throwIfAborted();
          validateComputerObservation(prepared);
          if ((await this.assertModelScope(captured.binding)).count !== captured.version)
            throw new Error('Stale model observation');
          if (
            captured.image.layout &&
            (await session.provider.inspectForRedaction?.())?.revision !==
              captured.image.layout.revision
          )
            throw new Error('Browser changed before model disclosure');
          // Construct a fresh allowlisted request: never forward the caller's context or extra fields.
          const response = await proposer.propose({
            observation: {
              screenshot: prepared.screenshot,
              viewport: { ...COMPUTER_VIEWPORT },
              untrusted: true,
              disclosure: 'redacted',
            },
            ...(objective !== undefined ? { objective: validateComputerObjective(objective) } : {}),
            signal: signal!,
          });
          signal!.throwIfAborted();
          return parseComputerProposal(JSON.stringify(response));
        })(),
        stopped,
      ]);
      if ((await this.assertModelScope(captured.binding)).count !== captured.version)
        throw new Error('Stale model observation');
      if (
        captured.image.layout &&
        (await session.provider.inspectForRedaction?.())?.revision !==
          captured.image.layout.revision
      )
        throw new Error('Browser changed during inference');
      const bound = Object.freeze({
        binding: Object.freeze({ ...captured.binding }),
        action: proposal,
        observationActionId: captured.actionId,
        observationId: captured.observationId,
      });
      const step = computerStepContext.getStore()!;
      ComputerService.proposals.set(bound, {
        runId: step.runId,
        nodeId: step.nodeId,
        effectIndex: step.effectIndex++,
        state: 'pending',
        version: captured.version,
        revision: captured.image.layout?.revision,
      });
      return { outcome: 'PROPOSED', proposal: bound };
    } catch {
      return { outcome: 'DENIED', error: 'Computer model proposal denied or unavailable' };
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (modelSession) modelSession.modelBusy = false;
    }
  }

  async executeProposal(proposal: BoundComputerProposal): Promise<ComputerActionResult> {
    try {
      const record = ComputerService.proposals.get(proposal);
      if (!record) throw new Error('Unverified proposal');
      const session = await this.assertModelScope(proposal.binding);
      if (session.modelBusy || session.count !== record.version) throw new Error('Stale proposal');
      if (
        record.revision &&
        (await session.provider.inspectForRedaction?.())?.revision !== record.revision
      )
        throw new Error('Browser changed after proposal');
      const step = computerStepContext.getStore()!;
      if (
        record.runId !== step.runId ||
        record.nodeId !== step.nodeId ||
        (record.state !== 'pending' && record.state !== 'waiting')
      )
        throw new Error('Proposal already dispatched');
      if (
        record.state === 'waiting' &&
        executionTaskContext.getStore()!.approvalId !== record.approvalId
      )
        throw new Error('Proposal requires its original approval');
      const action = parseComputerProposal(JSON.stringify(proposal.action));
      record.state = 'running';
      try {
        const result = await computerStepContext.run(
          {
            ...step,
            effectIndex: record.effectIndex,
            observationId: proposal.observationId,
            expectedRevision: record.revision,
          },
          () => this.executeAction({ type: action.type, params: action.params })
        );
        record.state = result.outcome === 'WAITING_APPROVAL' ? 'waiting' : 'done';
        record.approvalId = result.approvalId;
        record.version = session.count;
        return result;
      } finally {
        if (record.state === 'running') record.state = 'done';
      }
    } catch {
      return { success: false, outcome: 'DENIED', error: 'Invalid computer proposal context' };
    }
  }

  static async closeTask(userId: string, workspaceId: string, taskId: string) {
    closeComputerVisionLoops(userId, workspaceId, taskId);
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
      modelBusy: false,
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
        if (session.busy || session.modelBusy) throw new Error('Computer session is busy');
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
          observationId: step.observationId,
          iteration: step.iteration,
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
        const result: ComputerActionResult = {
          success: true,
          outcome: 'SUCCESS',
          data,
          actionId: ledgerId,
          sessionId: current.binding.sessionId,
          observationId:
            step.observationId ?? (action.type === 'screenshot' ? randomUUID() : undefined),
        };
        if (action.type === 'screenshot')
          ComputerService.observations.set(result, {
            binding: { ...current.binding },
            screenshot: (data as { screenshot: string }).screenshot,
            actionId: ledgerId!,
            version: current.count,
            image: structuredClone(data as ComputerScreenshot),
            observationId: result.observationId!,
          });
        return result;
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
    const revision = computerStepContext.getStore()?.expectedRevision;
    if (revision && (await provider.inspectForRedaction?.())?.revision !== revision)
      throw new Error('Browser state changed before action');
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
