const fs = require('fs');
let file = 'packages/gateway/src/services/job-queue-service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /export const jobExecutionContext = new AsyncLocalStorage<\{([\s\S]*?)\}>/m,
  "export const jobExecutionContext = new AsyncLocalStorage<{$1  depth?: number;\n}>"
);

code = code.replace(
  /const DEFAULT_QUEUE = 'default';/m,
  `const DEFAULT_QUEUE = 'default';
const MAX_ATTEMPTS_LIMIT = 10;
const MAX_CONCURRENCY_LIMIT = 50;
const MAX_EXECUTION_TIME_MS = 60 * 60 * 1000; // 1 hour
const MAX_JOB_DEPTH_LIMIT = 50;`
);

code = code.replace(
  /const jobId = options\.id \?\? randomUUID\(\);/m,
  `const jobId = options.id ?? randomUUID();
    const context = jobExecutionContext.getStore();
    const currentDepth = context?.depth ?? 0;
    if (currentDepth >= MAX_JOB_DEPTH_LIMIT) {
      throw new Error(\`Job execution blocked: MAX_JOB_DEPTH_LIMIT (\${MAX_JOB_DEPTH_LIMIT}) exceeded (recursive autonomous loop)\`);
    }
    const payloadWithDepth = { ...payload, _depth: currentDepth + 1 };`
);

code = code.replace(
  /payload,/m,
  "payload: payloadWithDepth,"
);

code = code.replace(
  /maxAttempts: options\.maxAttempts \?\? 3,/m,
  "maxAttempts: Math.min(options.maxAttempts ?? 3, MAX_ATTEMPTS_LIMIT),"
);

code = code.replace(
  /const concurrency = options\.concurrency \?\? 4;/m,
  "const concurrency = Math.min(Math.max(1, options.concurrency ?? 4), MAX_CONCURRENCY_LIMIT);"
);

code = code.replace(
  /heartbeat\.unref\?\.\(\);/m,
  `heartbeat.unref?.();

    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        log.warn('Job exceeded max execution time', logCtx);
        controller.abort(new Error(\`Job exceeded MAX_EXECUTION_TIME_MS (\${MAX_EXECUTION_TIME_MS}ms)\`));
      }
    }, MAX_EXECUTION_TIME_MS);
    timeoutId.unref?.();`
);

code = code.replace(
  /clearInterval\(heartbeat\);\n\s*\}\n\s*\}\n\s*private async safePoll/m,
  `clearInterval(heartbeat);\n        clearTimeout(timeoutId);\n      }\n    }\n\n    private async safePoll`
);

code = code.replace(
  /effectIndex: 0 \},/m,
  "effectIndex: 0, depth: (job.payload as any)?._depth ?? 0 },"
);

fs.writeFileSync(file, code, 'utf8');
