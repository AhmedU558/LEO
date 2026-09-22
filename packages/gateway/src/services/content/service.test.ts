import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentService } from './service.js';

vi.mock('../../db/client.js', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn() })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => []) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
  },
}));

describe('ContentService', () => {
  let service: ContentService;

  beforeEach(() => {
    service = new ContentService('user1', 'ws1');
    vi.clearAllMocks();
  });

  it('creates content item', async () => {
    const item = await service.createContent({ title: 'Test Title' });
    expect(item.id).toContain('content_');
    expect(item.title).toBe('Test Title');
    expect(item.status).toBe('DRAFT');
  });

  it('sets platform variant', async () => {
    // Because getContent is mocked to return undefined by default, we have to mock it directly
    service.getContent = vi.fn(async () => ({
      item: { id: 'c1' } as any,
      variants: [],
    }));

    const variant = await service.setVariant('c1', 'youtube', { title: 'YT Title' });
    expect(variant.platform).toBe('youtube');
    expect(variant.title).toBe('YT Title');
    expect(variant.validationState).toBe('unchecked');
  });
});
