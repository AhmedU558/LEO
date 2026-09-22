import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignService } from './campaign-service.js';
import { SocialRepository } from '../../db/repositories/social.js';
import { ContentService } from '../content/service.js';
import { MediaService } from '../media/service.js';
import { SocialService } from './service.js';

vi.mock('../../db/repositories/social.js');
vi.mock('../content/service.js');
vi.mock('../media/service.js');
vi.mock('../../db/client.js');
vi.mock('./service.js');

describe('CampaignService', () => {
  let service: CampaignService;

  beforeEach(() => {
    service = new CampaignService('user1', 'workspace1');
    vi.clearAllMocks();
  });

  it('createCampaign: validates and creates successfully', async () => {
    const mockContentService = {
      getContent: vi.fn().mockResolvedValue({
        item: { id: 'content1', workspaceId: 'workspace1', mediaAssetIds: ['media1'] },
        variants: [{ platform: 'youtube', title: 'Test', metadata: {} }],
      }),
    };
    (ContentService as any).mockImplementation(function () {
      return mockContentService;
    });

    const mockSocialRepo = {
      getAccount: vi.fn().mockResolvedValue({ id: 'acc1', platform: 'youtube' }),
      createCampaign: vi.fn().mockResolvedValue(undefined),
      createCampaignTarget: vi.fn().mockResolvedValue(undefined),
      getCampaign: vi.fn().mockResolvedValue({ id: 'camp1', status: 'READY' }),
      getCampaignTargets: vi.fn().mockResolvedValue([]),
      listCampaigns: vi.fn().mockResolvedValue([]),
    };
    (SocialRepository as any).mockImplementation(function () {
      return mockSocialRepo;
    });

    const mockMediaService = {
      getMedia: vi.fn().mockResolvedValue({ id: 'media1' }),
    };
    (MediaService as any).mockImplementation(function () {
      return mockMediaService;
    });

    const mockSocialService = {
      createPublishTask: vi.fn().mockResolvedValue({ request: { id: 'req1' }, taskId: 'task1' }),
    };
    (SocialService as any).mockImplementation(function () {
      return mockSocialService;
    });

    const campaign = await service.createCampaign({
      contentItemId: 'content1',
      accountIds: ['acc1'],
    });

    expect(campaign.status).toBe('READY');
    expect(mockContentService.getContent).toHaveBeenCalledWith('content1');
    expect(mockSocialRepo.createCampaign).toHaveBeenCalled();
    expect(mockSocialRepo.createCampaignTarget).toHaveBeenCalled();
    expect(mockSocialService.createPublishTask).toHaveBeenCalled();
  });

  it('createCampaign: fails if ContentItem missing', async () => {
    const mockContentService = { getContent: vi.fn().mockResolvedValue(null) };
    (ContentService as any).mockImplementation(function () {
      return mockContentService;
    });

    await expect(
      service.createCampaign({ contentItemId: 'none', accountIds: ['acc1'] })
    ).rejects.toThrow('ContentItem not found');
  });

  it('aggregateCampaignStatus: sets PUBLISHED if all published', async () => {
    const mockSocialRepo = {
      getCampaign: vi.fn().mockResolvedValue({ id: 'camp1', status: 'READY' }),
      getCampaignTargets: vi
        .fn()
        .mockResolvedValue([{ status: 'PUBLISHED' }, { status: 'PUBLISHED' }]),
      updateCampaign: vi.fn(),
    };
    (SocialRepository as any).mockImplementation(function () {
      return mockSocialRepo;
    });

    await service.aggregateCampaignStatus('camp1');

    expect(mockSocialRepo.updateCampaign).toHaveBeenCalledWith('camp1', { status: 'PUBLISHED' });
  });

  it('aggregateCampaignStatus: sets NEEDS_RECONCILIATION if any unknown', async () => {
    const mockSocialRepo = {
      getCampaign: vi.fn().mockResolvedValue({ id: 'camp1', status: 'READY' }),
      getCampaignTargets: vi
        .fn()
        .mockResolvedValue([{ status: 'PUBLISHED' }, { status: 'UNKNOWN' }]),
      updateCampaign: vi.fn(),
    };
    (SocialRepository as any).mockImplementation(function () {
      return mockSocialRepo;
    });

    await service.aggregateCampaignStatus('camp1');

    expect(mockSocialRepo.updateCampaign).toHaveBeenCalledWith('camp1', {
      status: 'NEEDS_RECONCILIATION',
    });
  });

  it('aggregateCampaignStatus: sets PARTIAL if published and failed', async () => {
    const mockSocialRepo = {
      getCampaign: vi.fn().mockResolvedValue({ id: 'camp1', status: 'READY' }),
      getCampaignTargets: vi
        .fn()
        .mockResolvedValue([{ status: 'PUBLISHED' }, { status: 'FAILED' }]),
      updateCampaign: vi.fn(),
    };
    (SocialRepository as any).mockImplementation(function () {
      return mockSocialRepo;
    });

    await service.aggregateCampaignStatus('camp1');

    expect(mockSocialRepo.updateCampaign).toHaveBeenCalledWith('camp1', { status: 'PARTIAL' });
  });
});
