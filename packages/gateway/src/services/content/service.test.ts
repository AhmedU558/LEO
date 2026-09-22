import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentService } from './service.js';

vi.mock('../../db/repositories/content.js', () => ({
  createContentRepository: vi.fn(() => ({
    insertItem: vi.fn(),
    listItems: vi.fn(() => []),
    getItem: vi.fn(() => ({ id: 'c1' })),
    getVariants: vi.fn(() => []),
    updateItem: vi.fn(),
    updateVariant: vi.fn(),
    insertVariant: vi.fn(),
  })),
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
    // Override getContent just for this test since default mock returns id='c1'
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
