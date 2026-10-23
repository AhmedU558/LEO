import type { Readable } from 'node:stream';

export interface StorageProvider {
  /**
   * Save a stream to storage, returning the storage key.
   */
  upload(
    workspaceId: string,
    filename: string,
    stream: Readable,
    mimeType: string
  ): Promise<string>;

  /**
   * Get a readable stream for a storage key.
   */
  download(storageKey: string): Promise<Readable>;

  /**
   * Delete an object by storage key.
   */
  delete(storageKey: string): Promise<void>;

  /**
   * Ensure storage bucket/directory exists.
   */
  init(): Promise<void>;
}
