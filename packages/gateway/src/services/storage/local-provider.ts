import type { StorageProvider } from '@ownpilot/core/storage';
import type { Readable } from 'node:stream';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), '.ownpilot', 'storage');
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async upload(
    workspaceId: string,
    filename: string,
    stream: Readable,
    _mimeType: string
  ): Promise<string> {
    const key = `${workspaceId}/${randomUUID()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fullPath = join(this.baseDir, key);

    // Ensure workspace dir exists
    await mkdir(join(this.baseDir, workspaceId), { recursive: true });

    const writeStream = createWriteStream(fullPath);
    await pipeline(stream, writeStream);
    return key;
  }

  async download(storageKey: string): Promise<Readable> {
    this.validateKey(storageKey);
    const fullPath = join(this.baseDir, storageKey);
    return createReadStream(fullPath);
  }

  async delete(storageKey: string): Promise<void> {
    this.validateKey(storageKey);
    const fullPath = join(this.baseDir, storageKey);
    try {
      await unlink(fullPath);
    } catch (e: unknown) {
      if ((e as Error & { code?: string }).code !== 'ENOENT') throw e;
    }
  }

  private validateKey(key: string) {
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error('Invalid storage key: Path traversal attempt detected');
    }
  }
}
