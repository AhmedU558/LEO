import { Readable } from 'node:stream';

/** Bridge Node's stream/web types to the Web API without buffering the file. */
export function toWebByteStream(stream: Readable): ReadableStream<Uint8Array> {
  const reader = Readable.toWeb(stream).getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) controller.close();
      else if (chunk.value instanceof Uint8Array) controller.enqueue(chunk.value);
      else if (typeof chunk.value === 'string')
        controller.enqueue(new TextEncoder().encode(chunk.value));
      else throw new TypeError('Expected a byte stream');
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
