import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { toWebByteStream } from './web-stream.js';

describe('Node to Web byte stream', () => {
  it('streams bytes without changing binary content', async () => {
    const body = toWebByteStream(Readable.from([Buffer.from([0, 127, 255]), Buffer.from([42])]));
    expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqual(
      new Uint8Array([0, 127, 255, 42])
    );
  });
  it('propagates source read failures', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('read failed'));
      },
    });
    await expect(new Response(toWebByteStream(stream)).text()).rejects.toThrow('read failed');
  });
  it('destroys the source when the consumer cancels', async () => {
    const source = new Readable({ read() {} });
    await toWebByteStream(source).cancel();
    expect(source.destroyed).toBe(true);
  });
});
