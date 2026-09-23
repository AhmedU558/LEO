import { randomUUID, createHash } from 'node:crypto';
import type {
  ComputerActionProposer,
  ScreenshotRedactor,
  ComputerVisionResult,
  ComputerVisionOutcome,
  ComputerActionResult,
} from '@ownpilot/core/computer';
import { ComputerService, type BoundComputerProposal } from './service.js';
import {
  executionTaskContext,
  computerStepContext,
  assertExecutionTaskActive,
} from '../execution-task-context.js';
import { ExecutionTasksRepository } from '../../db/repositories/execution-tasks.js';
import { getIdempotencyKeysRepository } from '../../db/repositories/idempotency-keys.js';
import { getLog } from '../log.js';

export const VISION_LIMITS = {
  iterations: 5,
  screenshots: 5,
  modelRequests: 5,
  actions: 10,
  durationMs: 120000,
} as const;
type Limits = { [K in keyof typeof VISION_LIMITS]: number };
interface State {
  result: ComputerVisionResult;
  nextEffect: number;
  captureEffect: number;
  phase: 'capture' | 'propose' | 'execute';
  proposal?: BoundComputerProposal;
  capture?: ComputerActionResult;
  busy: boolean;
  startedAt: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  fingerprint: string;
  marker: string;
  owner: string;
}
const states = new Map<string, State>();
const log = getLog('ComputerVisionLoop');

export function closeComputerVisionLoops(userId: string, workspaceId: string, taskId: string) {
  const prefix = JSON.stringify([userId, workspaceId, taskId]).slice(0, -1) + ',';
  for (const [key, state] of states) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(state.timer);
    state.controller.abort('CANCELLED');
    states.delete(key);
  }
}

/** Bounded orchestration inside the existing workflow worker, never a queue or autonomous scheduler. */
export async function runComputerVisionLoop(
  options: {
    iterations: number;
    proposer: ComputerActionProposer;
    redactor: ScreenshotRedactor;
    limits?: Partial<Limits>;
  },
  service = new ComputerService()
): Promise<ComputerVisionResult> {
  const ctx = executionTaskContext.getStore();
  const step = computerStepContext.getStore();
  const failed = (outcome: ComputerVisionOutcome): ComputerVisionResult => ({
    outcome,
    iterations: 0,
    screenshots: 0,
    modelRequests: 0,
    actions: 0,
  });
  if (!ctx?.jobId || !ctx.leaseToken || !step || !options.redactor?.redact) return failed('FAILED');
  const repo = new ExecutionTasksRepository(ctx.userId, ctx.workspaceId);
  const key = JSON.stringify([ctx.userId, ctx.workspaceId, ctx.taskId, step.runId, step.nodeId]);
  const limits: Limits = { ...VISION_LIMITS, ...options.limits };
  if (
    !Number.isSafeInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > VISION_LIMITS.iterations ||
    Object.entries(limits).some(
      ([k, n]) => !Number.isSafeInteger(n) || n < 1 || n > VISION_LIMITS[k as keyof Limits]
    )
  )
    return failed('LIMIT_REACHED');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ iterations: options.iterations, limits }))
    .digest('hex');
  let state = states.get(key);
  if (state?.busy) return failed('FAILED');
  try {
    await assertExecutionTaskActive();
    await repo.assertComputerWorker(ctx.taskId, ctx.jobId, ctx.leaseToken, step.runId);
    // Recheck after asynchronous authorization so two cold starts cannot install two loops.
    if (states.get(key)?.busy) return failed('FAILED');
    state = states.get(key);
    if (!state) {
      if (ctx.approvalId) return failed('UNKNOWN');
      const marker = JSON.stringify([
        'vision-loop',
        ctx.workspaceId,
        ctx.taskId,
        step.runId,
        step.nodeId,
      ]);
      const claim = await getIdempotencyKeysRepository().claimOperation(
        ctx.userId,
        marker,
        fingerprint,
        ctx.leaseToken
      );
      if (!claim.claimed) return failed('UNKNOWN');
      const controller = new AbortController();
      const initial: State = {
        result: failed('FAILED'),
        nextEffect: step.effectIndex,
        captureEffect: step.effectIndex,
        phase: 'capture',
        busy: true,
        startedAt: Date.now(),
        controller,
        fingerprint,
        marker,
        owner: ctx.leaseToken,
        timer: setTimeout(() => {
          controller.abort('TIMEOUT');
          void repo
            .cancel(ctx.taskId, 'Vision loop duration exceeded', 'UNKNOWN')
            .finally(() => ComputerService.closeTask(ctx.userId, ctx.workspaceId, ctx.taskId))
            .catch(() => log.warn('Vision timeout cleanup failed'));
          states.delete(key);
        }, limits.durationMs),
      };
      initial.timer.unref?.();
      state = initial;
      states.set(key, state);
    } else {
      if (state.fingerprint !== fingerprint || state.result.approvalId !== ctx.approvalId)
        return failed('FAILED');
      state.busy = true;
    }
    const current = state;
    const signal = AbortSignal.any([ctx.signal, current.controller.signal]);
    const finish = async (outcome: ComputerVisionOutcome) => {
      current.result.outcome = outcome;
      if (outcome !== 'WAITING_APPROVAL') {
        clearTimeout(current.timer);
        current.controller.abort();
        states.delete(key);
        current.capture = undefined;
        current.proposal = undefined;
        await getIdempotencyKeysRepository().finishOperation(
          ctx.userId,
          current.marker,
          current.owner,
          outcome === 'COMPLETED' ? 'success' : 'unknown',
          { outcome, iterations: current.result.iterations }
        );
        if (outcome !== 'COMPLETED') {
          await repo.cancel(
            ctx.taskId,
            `Vision loop ${outcome}`,
            outcome === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN'
          );
          await ComputerService.closeTask(ctx.userId, ctx.workspaceId, ctx.taskId);
        }
      }
      return { ...current.result };
    };
    const stopped = () =>
      ctx.signal.aborted || current.controller.signal.reason === 'CANCELLED'
        ? ('CANCELLED' as const)
        : ('TIMEOUT' as const);
    try {
      return await executionTaskContext.run({ ...ctx, signal }, async () => {
        for (let remaining = 0; remaining <= VISION_LIMITS.iterations; remaining++) {
          if (signal.aborted || Date.now() - current.startedAt >= limits.durationMs)
            return finish(stopped());
          if (current.result.iterations >= options.iterations) return finish('COMPLETED');
          if (current.result.iterations >= limits.iterations) return finish('LIMIT_REACHED');
          const iteration = current.result.iterations + 1;
          if (current.phase === 'capture') {
            if (!current.result.approvalId) {
              if (
                current.result.screenshots >= limits.screenshots ||
                current.result.actions >= limits.actions
              )
                return finish('LIMIT_REACHED');
              current.result.screenshots++;
              current.result.actions++;
              current.result.observationId = randomUUID();
              current.captureEffect = current.nextEffect++;
            }
            const capture = await computerStepContext.run(
              {
                ...step,
                iteration,
                observationId: current.result.observationId,
                effectIndex: current.captureEffect,
              },
              () =>
                executionTaskContext.run(
                  {
                    ...ctx,
                    signal,
                    approvalId: current.result.approvalId ? ctx.approvalId : undefined,
                  },
                  () => service.executeAction({ type: 'screenshot', params: {} })
                )
            );
            current.result.sessionId = capture.sessionId ?? current.result.sessionId;
            if (signal.aborted) return finish(stopped());
            if (capture.outcome === 'WAITING_APPROVAL') {
              current.result.approvalId = capture.approvalId;
              return finish('WAITING_APPROVAL');
            }
            if (!capture.success)
              return finish(capture.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED');
            current.result.approvalId = undefined;
            current.capture = capture;
            current.phase = 'propose';
          }
          if (current.phase === 'propose') {
            if (
              current.result.modelRequests >= limits.modelRequests ||
              current.result.actions >= limits.actions
            )
              return finish('LIMIT_REACHED');
            current.result.modelRequests++;
            const proposalStep = {
              ...step,
              iteration,
              effectIndex: current.nextEffect,
              observationId: current.result.observationId,
            };
            const proposal = await computerStepContext.run(proposalStep, () =>
              service.proposeAction(current.capture!, options.proposer, options.redactor)
            );
            current.capture = undefined;
            current.nextEffect = proposalStep.effectIndex;
            if (signal.aborted) return finish(stopped());
            if (proposal.outcome !== 'PROPOSED') return finish('FAILED');
            current.proposal = proposal.proposal;
            current.phase = 'execute';
            current.result.actions++;
          }
          const action = await computerStepContext.run(
            {
              ...step,
              iteration,
              effectIndex: current.nextEffect,
              observationId: current.result.observationId,
            },
            () =>
              executionTaskContext.run(
                {
                  ...ctx,
                  signal,
                  approvalId: current.result.approvalId ? ctx.approvalId : undefined,
                },
                () => service.executeProposal(current.proposal!)
              )
          );
          if (signal.aborted) return finish(stopped());
          if (action.outcome === 'WAITING_APPROVAL') {
            current.result.approvalId = action.approvalId;
            return finish('WAITING_APPROVAL');
          }
          if (!action.success || action.outcome !== 'SUCCESS')
            return finish(action.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED');
          current.result.iterations++;
          current.result.approvalId = undefined;
          current.proposal = undefined;
          current.phase = 'capture';
        }
        return finish('LIMIT_REACHED');
      });
    } catch {
      return finish(signal.aborted ? stopped() : 'UNKNOWN');
    } finally {
      current.busy = false;
    }
  } catch {
    if (state) {
      clearTimeout(state.timer);
      state.controller.abort();
      states.delete(key);
    }
    await ComputerService.closeTask(ctx.userId, ctx.workspaceId, ctx.taskId);
    return failed(ctx.signal.aborted ? 'CANCELLED' : 'UNKNOWN');
  }
}
