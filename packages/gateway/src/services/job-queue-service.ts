/**
 * JobQueueService — enqueue jobs and manage the worker pool.
 * Wraps JobsRepository with pg-boss-compatible API.
 *
 * Workers use FOR UPDATE SKIP LOCKED to claim jobs without contention,
 * enabling horizontal scaling across multiple gateway instances.
 */

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getErrorMessage } from '@ownpilot/core/services';
import { getLog } from './log.js';
import { getJobsRepository, type CreateJobInput, type JobRecord } from '../db/repositories/jobs.js';
import { getIdempotencyKeysRepository } from '../db/repositories/idempotency-keys.js';

export const jobExecutionContext = new AsyncLocalStorage<{
  jobId: string;
  leaseToken: string;
  signal: AbortSignal;
  effectIndex: number;
  depth?: number;
}>();

const log = getLog('JobQueueService');

const DEFAULT_QUEUE = 'default';
const MAX_ATTEMPTS_LIMIT = 10;
const MAX_CONCURRENCY_LIMIT = 50;
const MAX_EXECUTION_TIME_MS = 60 * 60 * 1000; // 1 hour
const MAX_JOB_DEPTH_LIMIT = 50;
const SYSTEM_QUEUE = 'system';

interface EnqueueOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  id?: string;
}

type JobHandler = (job: JobRecord, signal: AbortSignal) => Promise<Record<string, unknown>>;

interface WorkerOptions {
  queue?: string;
  concurrency?: number;
  name?: string;
}

interface RunningWorker {
  id: string;
  queue: string;
  concurrency: number;
  handler: JobHandler;
  activeJobs: Set<string>;
  stopped: boolean;
  /**
   * Re-entrancy guard. pollWorker is invoked concurrently for the SAME worker
   * from three sources (the 1 Hz pollAll, the immediate start poll, and each
   * job's finally re-poll). Without this, two overlapping claim-loops both read
   * the pre-claim activeJobs.size and can collectively claim up to 2×concurrency
   * jobs before either adds to the set — over-subscribing the worker. Only one
   * claim-loop may run per worker at a time.
   */
  polling: boolean;
}

/**
 * JobQueueService — singleton service for enqueueing and workers.
 *
 * Usage:
 *   const queue = JobQueueService.getInstance();
 *
 *   // Enqueue a job
 *   await queue.enqueue('workflow_node', { nodeId: 'node_1', runId: 'run_123' });
 *
 *   // Start a worker
 *   queue.startWorker('workflow_node', async (job) => {
 *     console.log('Executing', job.payload);
 *     return { result: 'ok' };
 *   });
 */
export class JobQueueService {
  private static _instance: JobQueueService | null = null;
  private workers: Map<string, RunningWorker> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private repo = getJobsRepository();
  private executions = new Map<
    string,
    { workerId: string; controller: AbortController; done: Promise<void> }
  >();

  static getInstance(): JobQueueService {
    if (!JobQueueService._instance) {
      JobQueueService._instance = new JobQueueService();
    }
    return JobQueueService._instance;
  }

  /**
   * Enqueue a job for async processing.
   */
  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {}
  ): Promise<string> {
    const jobId = options.id ?? randomUUID();
    const context = jobExecutionContext.getStore();
    const currentDepth = context?.depth ?? 0;
    if (currentDepth >= MAX_JOB_DEPTH_LIMIT) {
      throw new Error(`Job execution blocked: MAX_JOB_DEPTH_LIMIT (${MAX_JOB_DEPTH_LIMIT}) exceeded (recursive autonomous loop)`);
    }
    const payloadWithDepth = { ...payload, _depth: currentDepth + 1 } as Record<string, unknown>;
    const jobInput: CreateJobInput = {
      id: jobId,
      name,
      queue: options.queue ?? DEFAULT_QUEUE,
      priority: options.priority ?? 0,
      payload: payloadWithDepth,
      maxAttempts: Math.min(options.maxAttempts ?? 3, MAX_ATTEMPTS_LIMIT),
      runAfter: options.runAfter ?? new Date(),
    };
    try {
      const job = await this.repo.create(jobInput);
      log.debug('Job enqueued', { jobId: job.id, name, queue: job.queue });
      return job.id;
    } catch (error: unknown) {
      // Catch PostgreSQL UNIQUE constraint violation (23505) for idempotent enqueues
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505' && options.id) {
        log.debug('Job already enqueued, returning existing id', { jobId: options.id, name });
        return options.id;
      }
      throw error;
    }
  }

  /**
   * Enqueue a high-priority system job.
   */
  async enqueueSystem(name: string, payload: Record<string, unknown> = {}): Promise<string> {
    return this.enqueue(name, payload, { queue: SYSTEM_QUEUE, priority: 100 });
  }

  /**
   * Start a worker that polls for jobs and executes them.
   */
  startWorker(handler: JobHandler, options: WorkerOptions = {}): () => void {
    const queue = options.queue ?? DEFAULT_QUEUE;
    const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), MAX_CONCURRENCY_LIMIT);
    const workerId = options.name ?? `worker_${randomUUID().slice(0, 8)}`;

    const worker: RunningWorker = {
      id: workerId,
      queue,
      concurrency,
      handler,
      activeJobs: new Set(),
      stopped: false,
      polling: false,
    };

    this.workers.set(workerId, worker);
    log.info('Worker started', { workerId, queue, concurrency });

    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => this.pollAll(), 1000);
      // unref so the 1Hz poll never blocks process exit. stopWorker() still
      // clearIntervals on the last-worker-stop path.
      this.pollInterval.unref?.();
    }

    // Trigger first poll immediately
    this.safePoll(worker);

    // Return stop function
    return () => this.stopWorker(workerId);
  }

  private stopWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    worker.stopped = true;
    for (const execution of this.executions.values()) {
      if (execution.workerId === workerId) execution.controller.abort();
    }
    this.workers.delete(workerId);
    log.info('Worker stopped', { workerId });
    if (this.workers.size === 0 && this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.workers.values())
        .filter((w) => !w.stopped)
        .map((w) => this.pollWorker(w))
    );
  }

  /**
   * Fire-and-forget pollWorker invocation. pollWorker rejects if claimJob
   * throws (a transient DB error). The immediate-start poll and the per-job
   * re-poll don't await it, so without this wrapper that rejection surfaces as
   * an unhandled promise rejection. (pollAll already isolates rejections via
   * allSettled — this brings the other two callsites in line.)
   */
  private safePoll(worker: RunningWorker): void {
    this.pollWorker(worker).catch((err) => {
      log.error('pollWorker error', { workerId: worker.id, error: getErrorMessage(err) });
    });
  }

  private async pollWorker(worker: RunningWorker): Promise<void> {
    if (worker.stopped || worker.polling) return;
    if (worker.activeJobs.size >= worker.concurrency) return;

    // Serialize claim-loops per worker so activeJobs.size is read consistently
    // across the await on claimJob — otherwise an overlapping poll claims jobs
    // against a stale count and the worker exceeds its concurrency cap.
    worker.polling = true;
    try {
      const availableSlots = worker.concurrency - worker.activeJobs.size;
      for (let i = 0; i < availableSlots; i++) {
        if (worker.stopped) break;
        const job = await this.repo.claimJob(worker.queue);
        if (!job) break;

        if (worker.stopped) {
          await this.repo.fail(job.id, 'Worker stopped before execution', job.leaseToken!);
          break;
        }

        worker.activeJobs.add(job.id);
        // executeJob is guaranteed not to reject (it swallows + logs its own
        // errors); the finally frees the slot and re-polls via safePoll.
        const controller = new AbortController();
        const done = this.executeJob(worker, job, controller).finally(() => {
          worker.activeJobs.delete(job.id);
          this.executions.delete(job.id);
          this.safePoll(worker);
        });
        this.executions.set(job.id, { workerId: worker.id, controller, done });
      }
    } finally {
      worker.polling = false;
    }
  }

  private async executeJob(
    worker: RunningWorker,
    job: JobRecord,
    controller = new AbortController()
  ): Promise<void> {
    const logCtx = { workerId: worker.id, jobId: job.id, name: job.name };
    log.debug('Job started', logCtx);

    let renewing = false;
    const heartbeat = setInterval(async () => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      try {
        if (!(await this.repo.renewLease(job.id, job.leaseToken!))) controller.abort();
      } catch {
        controller.abort();
      } finally {
        renewing = false;
      }
    }, 1000);
    heartbeat.unref?.();

    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        log.warn('Job exceeded max execution time', logCtx);
        controller.abort(new Error(`Job exceeded MAX_EXECUTION_TIME_MS (${MAX_EXECUTION_TIME_MS}ms)`));
      }
    }, MAX_EXECUTION_TIME_MS);
    timeoutId.unref?.();
    try {
      controller.signal.throwIfAborted();
      const result = await jobExecutionContext.run(
        { jobId: job.id, leaseToken: job.leaseToken!, signal: controller.signal, effectIndex: 0, depth: typeof job.payload === 'object' && job.payload !== null && '_depth' in job.payload ? (job.payload as { _depth: number })._depth : 0 },
        async () => {
          const operations = getIdempotencyKeysRepository();
          const operationId = `job:${job.id}`;
          const owner = job.leaseToken!;
          const claim = await this.repo.withLease(job.id, owner, () =>
            operations.claimOperation('job-queue', operationId, job.name, owner)
          );
          if (!claim.claimed) {
            if (claim.state === 'success') return claim.result as Record<string, unknown>;
            throw new Error(`Job outcome ${claim.state}; reconciliation required before replay`);
          }
          try {
            controller.signal.throwIfAborted();
            const value = await worker.handler(job, controller.signal);
            controller.signal.throwIfAborted();
            await operations.finishOperation('job-queue', operationId, owner, 'success', value);
            return value;
          } catch (error) {
            await operations.finishOperation(
              'job-queue',
              operationId,
              owner,
              controller.signal.aborted ? 'cancelled' : 'unknown',
              { error: getErrorMessage(error) }
            );
            throw error;
          }
        }
      );
      controller.signal.throwIfAborted();
      if (!(await this.repo.complete(job.id, result, job.leaseToken!))) {
        throw new Error('Job lease lost before completion');
      }
      log.debug('Job completed', { ...logCtx });
    } catch (err) {
      const error = getErrorMessage(err);
      log.warn('Job failed', { ...logCtx, error });
      // repo.fail is itself a DB write that can throw (e.g. transient
      // connection loss). executeJob runs fire-and-forget from pollWorker, so
      // a throw here would surface as an unhandled rejection. Swallow + log so
      // executeJob never rejects and the slot is still freed by the caller's
      // finally.
      try {
        if (controller.signal.aborted) {
          // Stop local execution without cancelling a newer owner's claim.
          await this.repo.cancelClaim(job.id, job.leaseToken!);
        } else {
          await this.repo.fail(job.id, error, job.leaseToken!);
        }
      } catch (failErr) {
        log.error('Failed to persist job failure', {
          ...logCtx,
          error: getErrorMessage(failErr),
        });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  async cancel(jobId: string): Promise<void> {
    await this.repo.cancel(jobId);
    this.executions.get(jobId)?.controller.abort();
  }

  /**
   * Get queue statistics for monitoring.
   */
  async getStats(queue?: string) {
    return this.repo.getStats(queue);
  }

  /**
   * Stop all workers gracefully.
   */
  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    for (const [id] of this.workers) {
      this.stopWorker(id);
    }
    // Bound shutdown even if a trusted handler ignores cancellation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.executions.values()].map((entry) => entry.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timer);
    log.info('JobQueueService shut down');
  }
}
