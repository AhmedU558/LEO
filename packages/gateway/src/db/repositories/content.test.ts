/**
 * ContentRepository tests.
 *
 * Reads are scoped to the tenant here; the writes (updateItem, updateVariant)
 * key on id alone and rely on ContentService.getContent's scoped lookup having
 * run first. That is how every current caller uses them -- see the service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();
vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { ContentRepository, createContentRepository } = await import('./content.js');

const created = new Date('2026-01-01T00:00:00Z');
const updated = new Date('2026-01-02T00:00:00Z');
const scheduled = new Date('2026-05-01T09:00:00Z');

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 'item-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    title: 'Launch',
    description: 'D',
    caption: 'C',
    hashtags: ['launch'],
    tags: ['t'],
    mediaAssetIds: ['m-1'],
    scheduledFor: scheduled,
    status: 'draft',
    executionTaskId: 'task-1',
    createdAt: created,
    updatedAt: updated,
    ...over,
  }) as never;

const variant = (over: Record<string, unknown> = {}) =>
  ({
    id: 'var-1',
    contentId: 'item-1',
    platform: 'youtube',
    title: 'T',
    caption: 'C',
    description: 'D',
    hashtags: ['h'],
    tags: ['t'],
    privacyStatus: 'public',
    metadata: { k: 1 },
    validationState: 'valid',
    validationErrors: [],
    createdAt: created,
    updatedAt: updated,
    ...over,
  }) as never;

const lastParams = () => mockAdapter.execute.mock.calls.at(-1)![1] as unknown[];

describe('ContentRepository', () => {
  let repo: InstanceType<typeof ContentRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    repo = new ContentRepository();
  });

  it('is created by its factory', () => {
    expect(createContentRepository()).toBeInstanceOf(ContentRepository);
  });

  describe('items', () => {
    it('inserts an item with JSON collections and ISO timestamps', async () => {
      await repo.insertItem(item());
      expect(lastParams()).toEqual([
        'item-1',
        'user-1',
        'ws-1',
        'Launch',
        'D',
        'C',
        '["launch"]',
        '["t"]',
        '["m-1"]',
        '2026-05-01T09:00:00.000Z',
        'draft',
        'task-1',
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      ]);
    });

    it('defaults missing collections and schedule on insert', async () => {
      await repo.insertItem(
        item({
          hashtags: undefined,
          tags: undefined,
          mediaAssetIds: undefined,
          scheduledFor: undefined,
        })
      );
      expect(lastParams().slice(6, 10)).toEqual(['[]', '[]', '[]', null]);
    });

    it('lists a tenant’s items, reviving dates', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: 'a',
          scheduledFor: scheduled.toISOString(),
          createdAt: created.toISOString(),
          updatedAt: updated.toISOString(),
        },
        {
          id: 'b',
          scheduledFor: null,
          createdAt: created.toISOString(),
          updatedAt: updated.toISOString(),
        },
      ]);
      const [a, b] = await repo.listItems('ws-1', 'user-1');
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['ws-1', 'user-1']);
      expect(a!.scheduledFor).toEqual(scheduled);
      expect(a!.createdAt).toEqual(created);
      expect(b!.scheduledFor).toBeUndefined();
    });

    it('reads one item within its tenant, or undefined', async () => {
      expect(await repo.getItem('missing', 'ws-1', 'user-1')).toBeUndefined();
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['missing', 'ws-1', 'user-1']);
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: 'item-1',
          scheduledFor: null,
          createdAt: created.toISOString(),
          updatedAt: updated.toISOString(),
        },
      ]);
      const found = await repo.getItem('item-1', 'ws-1', 'user-1');
      expect(found).toMatchObject({
        id: 'item-1',
        scheduledFor: undefined,
        createdAt: created,
        updatedAt: updated,
      });
    });

    it('reads a scheduled item with its schedule revived', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: 'item-1',
          scheduledFor: scheduled.toISOString(),
          createdAt: created.toISOString(),
          updatedAt: updated.toISOString(),
        },
      ]);
      expect((await repo.getItem('item-1', 'ws-1', 'user-1'))!.scheduledFor).toEqual(scheduled);
    });

    it('updates an item’s editable fields', async () => {
      await repo.updateItem('item-1', item({ scheduledFor: undefined, hashtags: undefined }));
      expect(lastParams()).toEqual([
        'Launch',
        'D',
        'C',
        '[]',
        '["t"]',
        '["m-1"]',
        null,
        'draft',
        'task-1',
        '2026-01-02T00:00:00.000Z',
        'item-1',
      ]);
      expect(String(mockAdapter.execute.mock.calls.at(-1)![0])).toContain('WHERE id = $11');
    });

    it('updates a scheduled item with an ISO schedule and default collections', async () => {
      await repo.updateItem('item-1', item({ tags: undefined, mediaAssetIds: undefined }));
      expect(lastParams().slice(3, 7)).toEqual([
        '["launch"]',
        '[]',
        '[]',
        '2026-05-01T09:00:00.000Z',
      ]);
    });
  });

  describe('variants', () => {
    it('lists a content item’s variants, reviving dates', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { id: 'var-1', createdAt: created.toISOString(), updatedAt: updated.toISOString() },
      ]);
      const [v] = await repo.getVariants('item-1');
      expect(v).toEqual({ id: 'var-1', createdAt: created, updatedAt: updated });
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['item-1']);
    });

    it('inserts a variant with encoded fields', async () => {
      await repo.insertVariant(variant());
      expect(lastParams()).toEqual([
        'var-1',
        'item-1',
        'youtube',
        'T',
        'C',
        'D',
        '["h"]',
        '["t"]',
        'public',
        '{"k":1}',
        'valid',
        '[]',
        '2026-01-01T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      ]);
    });

    it('defaults missing variant collections on insert and update', async () => {
      const bare = variant({
        hashtags: undefined,
        tags: undefined,
        metadata: undefined,
        validationErrors: undefined,
      });
      await repo.insertVariant(bare);
      const inserted = lastParams();
      expect([inserted[6], inserted[7], inserted[9], inserted[11]]).toEqual([
        '[]',
        '[]',
        '{}',
        '[]',
      ]);
      await repo.updateVariant('var-1', bare);
      const updatedParams = lastParams();
      expect([updatedParams[3], updatedParams[4], updatedParams[6], updatedParams[8]]).toEqual([
        '[]',
        '[]',
        '{}',
        '[]',
      ]);
      expect(updatedParams[10]).toBe('var-1');
    });

    it('updates a variant’s fields', async () => {
      await repo.updateVariant('var-1', variant({ validationErrors: ['too long'] }));
      expect(lastParams()).toEqual([
        'T',
        'C',
        'D',
        '["h"]',
        '["t"]',
        'public',
        '{"k":1}',
        'valid',
        '["too long"]',
        '2026-01-02T00:00:00.000Z',
        'var-1',
      ]);
    });
  });
});
