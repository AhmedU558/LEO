export type MediaType = 'video' | 'image' | 'audio' | 'unknown';
export type MediaStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETING' | 'DELETED';

export interface MediaAsset {
  id: string;
  userId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  mediaType: MediaType;
  sizeBytes: number;
  storageKey: string;
  checksum: string;
  metadata: Record<string, unknown>;
  dimensions?: { width: number; height: number };
  durationSeconds?: number;
  status: MediaStatus;
  createdAt: Date;
  updatedAt: Date;
}
