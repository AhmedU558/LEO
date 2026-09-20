import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { executeIsolatedJavaScript } from './docker.js';
import { executeDynamicTool } from '../agent/tools/dynamic-tool-executor.js';

const exec = promisify(execFile);
describe.skipIf(process.env.LEO_QA_DOCKER !== '1')('Priority 4 real isolation', () => {
  it('executes pure dynamic tools outside the core and preserves their result', async () => {
    const result = await executeDynamicTool(
      {
        name: 'qa_add',
        description: 'QA',
        parameters: { type: 'object', properties: {} },
        code: 'return args.x + 1;',
      },
      { x: 4 },
      { callId: 'qa', conversationId: 'qa' }
    );
    expect(result).toMatchObject({ content: 5, isError: false });
  });
  it('cannot mutate host memory or access environment, filesystem, process, or host constructors', async () => {
    process.env.LEO_QA_SECRET = 'local-test-secret';
    try {
      expect(
        await executeIsolatedJavaScript(
          'globalThis.qaIsolationMarker = true; return [typeof process, typeof require, typeof fetch];'
        )
      ).toEqual(['undefined', 'undefined', 'undefined']);
      expect('qaIsolationMarker' in globalThis).toBe(false);
      await expect(
        executeIsolatedJavaScript(
          "return args.constructor.constructor('return process.env.LEO_QA_SECRET')();",
          { args: {} }
        )
      ).rejects.toThrow();
    } finally {
      delete process.env.LEO_QA_SECRET;
    }
  });
  it('rejects host-function transfer before executing', async () => {
    let called = false;
    await expect(
      executeIsolatedJavaScript('return callback()', {
        callback: () => {
          called = true;
        },
      })
    ).rejects.toThrow('Host functions');
    expect(called).toBe(false);
  });
  it('bounds native-buffer allocations without exhausting the core heap', async () => {
    await expect(
      executeIsolatedJavaScript(
        'const blocks = []; while (true) blocks.push(new Uint8Array(8 * 1024 * 1024).fill(1));',
        {},
        { timeout: 10_000, memoryMB: 50 }
      )
    ).rejects.toThrow(/Memory limit exceeded/);
    expect(await executeIsolatedJavaScript('return 7;')).toBe(7);
  });
  it('timeouts terminate containers, including asynchronous hangs', async () => {
    await expect(
      executeIsolatedJavaScript('while(true) {}', {}, { timeout: 600 })
    ).rejects.toThrow();
    await expect(
      executeIsolatedJavaScript('return await new Promise(() => {});', {}, { timeout: 600 })
    ).rejects.toThrow();
    const { stdout } = await exec('docker', [
      'ps',
      '--filter',
      'name=leo-sandbox-',
      '--format',
      '{{.Names}}',
    ]);
    expect(stdout.trim()).toBe('');
  });
  it('cancellation terminates execution and leaves no running container', async () => {
    const controller = new AbortController();
    const pending = executeIsolatedJavaScript(
      'while(true) {}',
      {},
      { timeout: 15_000, signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 700);
    await expect(pending).rejects.toThrow();
    const { stdout } = await exec('docker', [
      'ps',
      '--filter',
      'name=leo-sandbox-',
      '--format',
      '{{.Names}}',
    ]);
    expect(stdout.trim()).toBe('');
  });
});
