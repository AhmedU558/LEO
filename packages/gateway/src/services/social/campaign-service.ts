import type {
  PublishingCampaign,
  CampaignTarget,
  CreateCampaignRequest,
  CampaignStatus,
} from '@ownpilot/core/social';
import { SocialRepository } from '../../db/repositories/social.js';
import { ContentService } from '../content/service.js';
import { SocialService } from './service.js';
import { MediaService } from '../media/service.js';
import { randomUUID } from 'node:crypto';
import { getLog } from '../log.js';

const log = getLog('CampaignService');

export class CampaignService {
  constructor(
    private userId: string,
    private workspaceId: string
  ) {}

  async createCampaign(request: CreateCampaignRequest): Promise<PublishingCampaign> {
    const socialRepo = new SocialRepository(this.userId, this.workspaceId);
    const contentService = new ContentService(this.userId, this.workspaceId);
    const mediaService = new MediaService(this.userId, this.workspaceId);

    const contentData = await contentService.getContent(request.contentItemId);
    if (!contentData) throw new Error('ContentItem not found');
    const contentItem = contentData.item;
    const variants = contentData.variants;

    if (contentItem.workspaceId !== this.workspaceId)
      throw new Error('ContentItem belongs to a different workspace');

    if (!request.accountIds || request.accountIds.length === 0) {
      throw new Error('No targets specified for campaign');
    }

    // 1. Resolve and validate
    const accounts = [];
    for (const accountId of request.accountIds) {
      const account = await socialRepo.getAccount(accountId);
      if (!account) throw new Error(`Account ${accountId} not found`);
      accounts.push(account);

      const variant = variants.find((v) => v.platform === account.platform);
      if (!variant) throw new Error(`No PlatformVariant found for platform: ${account.platform}`);
    }

    // Load media assets
    const mediaAssets = [];
    for (const mediaId of contentItem.mediaAssetIds || []) {
      const asset = await mediaService.getMedia(mediaId);
      if (!asset) throw new Error(`MediaAsset ${mediaId} not found`);
      mediaAssets.push(asset);
    }

    // Recover existing campaign if one exists (idempotency/crash recovery)
    const existingCampaigns = await socialRepo.listCampaigns();
    let campaign = existingCampaigns.find(
      (camp) =>
        camp.contentItemId === contentItem.id &&
        camp.scheduledFor === request.scheduledFor &&
        camp.status !== 'CANCELLED'
    );

    let existingTargets: CampaignTarget[] = [];

    if (!campaign) {
      const campaignId = `camp_${randomUUID()}`;
      campaign = {
        id: campaignId,
        userId: this.userId,
        workspaceId: this.workspaceId,
        contentItemId: contentItem.id,
        status: 'READY',
        scheduledFor: request.scheduledFor,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await socialRepo.createCampaign(campaign);
    } else {
      existingTargets = await socialRepo.getCampaignTargets(campaign.id);
    }

    const socialService = new SocialService(this.userId, this.workspaceId);

    // 3. Create independent targets and publish tasks ONLY if they don't already exist
    for (const account of accounts) {
      // Check if target already exists for this account
      const existingTarget = existingTargets.find((t) => t.accountId === account.id);
      if (existingTarget) {
        continue; // Skip, already created
      }

      const variant = variants.find((v) => v.platform === account.platform);
      const targetId = `tgt_${randomUUID()}`;

      try {
        const publishResult = await socialService.createPublishTask({
          accountId: account.id,
          platform: account.platform,
          text: variant!.title || variant!.caption || '',
          hashtags: variant!.hashtags || [],
          media: mediaAssets,
          metadata: variant!.metadata || {},
          scheduledFor: request.scheduledFor,
        });

        const target: CampaignTarget = {
          id: targetId,
          campaignId: campaign.id,
          userId: this.userId,
          workspaceId: this.workspaceId,
          accountId: account.id,
          platform: account.platform,
          publishRequestId: publishResult.request.id,
          status: 'QUEUED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await socialRepo.createCampaignTarget(target);
      } catch (e: unknown) {
        log.error(`Target creation failed for ${account.id}: ${(e as Error).message}`);
        const target: CampaignTarget = {
          id: targetId,
          campaignId: campaign.id,
          userId: this.userId,
          workspaceId: this.workspaceId,
          accountId: account.id,
          platform: account.platform,
          publishRequestId: `failed_${randomUUID()}`,
          status: 'FAILED',
          error: { code: 'INTERNAL', message: (e as Error).message, retryable: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await socialRepo.createCampaignTarget(target);
      }
    }

    await this.aggregateCampaignStatus(campaign.id);
    return (await socialRepo.getCampaign(campaign.id))!;
  }

  async getCampaign(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    return repo.getCampaign(id);
  }

  async listCampaigns() {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    return repo.listCampaigns();
  }

  async getCampaignTargets(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    return repo.getCampaignTargets(id);
  }

  async cancelCampaign(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const campaign = await repo.getCampaign(id);
    if (!campaign) throw new Error('Campaign not found');

    const targets = await repo.getCampaignTargets(id);
    const socialService = new SocialService(this.userId, this.workspaceId);

    for (const target of targets) {
      if (
        target.status !== 'PUBLISHED' &&
        target.status !== 'CANCELLED' &&
        target.status !== 'FAILED' &&
        target.status !== 'UNKNOWN'
      ) {
        try {
          await socialService.cancelPublish(target.publishRequestId);
          await repo.updateCampaignTarget(target.id, { status: 'CANCELLED' });
        } catch (e) {
          log.warn(`Failed to cancel target ${target.id}: ${e}`);
        }
      }
    }

    await repo.updateCampaign(id, { status: 'CANCELLED' });
    await this.aggregateCampaignStatus(id);
  }

  async reconcileCampaign(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const targets = await repo.getCampaignTargets(id);
    const socialService = new SocialService(this.userId, this.workspaceId);

    for (const target of targets) {
      if (target.status === 'UNKNOWN' || target.status === 'PUBLISHING') {
        try {
          const result = await socialService.reconcilePublish(target.publishRequestId);
          await repo.updateCampaignTarget(target.id, {
            status: this.mapPublishStatusToCampaign(result.status),
          });
        } catch (e) {
          log.warn(`Failed to reconcile target ${target.id}: ${e}`);
        }
      } else {
        const request = await repo.getPublishRequest(target.publishRequestId);
        if (request && this.mapPublishStatusToCampaign(request.status) !== target.status) {
          await repo.updateCampaignTarget(target.id, {
            status: this.mapPublishStatusToCampaign(request.status),
          });
        }
      }
    }

    await this.aggregateCampaignStatus(id);
  }

  private mapPublishStatusToCampaign(status: string): CampaignStatus {
    switch (status) {
      case 'pending':
        return 'QUEUED';
      case 'publishing':
        return 'PUBLISHING';
      case 'published':
        return 'PUBLISHED';
      case 'failed':
        return 'FAILED';
      case 'cancelled':
        return 'CANCELLED';
      case 'unknown':
        return 'UNKNOWN';
      default:
        return 'UNKNOWN';
    }
  }

  async aggregateCampaignStatus(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const campaign = await repo.getCampaign(id);
    if (!campaign) return;

    const targets = await repo.getCampaignTargets(id);
    if (targets.length === 0) return;

    const statuses = targets.map((t) => t.status);

    let nextStatus: CampaignStatus = 'UNKNOWN';

    if (statuses.every((s) => s === 'PUBLISHED')) {
      nextStatus = 'PUBLISHED';
    } else if (statuses.every((s) => s === 'CANCELLED')) {
      nextStatus = 'CANCELLED';
    } else if (statuses.every((s) => s === 'FAILED')) {
      nextStatus = 'FAILED';
    } else if (statuses.some((s) => s === 'UNKNOWN')) {
      nextStatus = 'NEEDS_RECONCILIATION';
    } else if (statuses.some((s) => s === 'PUBLISHING')) {
      nextStatus = 'PUBLISHING';
    } else if (
      statuses.some((s) => s === 'PUBLISHED') &&
      statuses.some((s) => s === 'FAILED' || s === 'CANCELLED')
    ) {
      nextStatus = 'PARTIAL';
    } else if (statuses.some((s) => s === 'WAITING_APPROVAL')) {
      nextStatus = 'WAITING_APPROVAL';
    } else if (statuses.some((s) => s === 'QUEUED')) {
      nextStatus = 'QUEUED';
    } else {
      nextStatus = 'READY';
    }

    if (campaign.status !== nextStatus) {
      await repo.updateCampaign(id, { status: nextStatus });
    }
  }
}

