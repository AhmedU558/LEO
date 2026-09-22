import { BaseRepository } from './base.js';
import type {
  SocialAccount,
  SocialPost,
  PublishRequest,
  PublishingCampaign,
  CampaignTarget,
} from '@ownpilot/core/social';

export class SocialRepository extends BaseRepository {
  constructor(
    readonly userId: string,
    readonly workspaceId: string
  ) {
    super();
    if (!userId || !workspaceId) throw new Error('Social identity required');
  }

  async getAccount(accountId: string): Promise<SocialAccount | null> {
    return this.queryOne<SocialAccount>(
      `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", platform, account_id AS "accountId", account_name AS "accountName", profile_url AS "profileUrl", status, created_at AS "createdAt", updated_at AS "updatedAt" FROM social_accounts WHERE id=$1 AND user_id=$2 AND workspace_id=$3`,
      [accountId, this.userId, this.workspaceId]
    );
  }

  async listAccounts(): Promise<SocialAccount[]> {
    return this.query<SocialAccount>(
      `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", platform, account_id AS "accountId", account_name AS "accountName", profile_url AS "profileUrl", status, created_at AS "createdAt", updated_at AS "updatedAt" FROM social_accounts WHERE user_id=$1 AND workspace_id=$2 ORDER BY created_at DESC`,
      [this.userId, this.workspaceId]
    );
  }

  async createAccount(
    account: Omit<SocialAccount, 'createdAt' | 'updatedAt'> & {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
    }
  ): Promise<SocialAccount> {
    const row = await this.queryOne<SocialAccount>(
      `INSERT INTO social_accounts (id, user_id, workspace_id, platform, account_id, account_name, profile_url, status, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, workspace_id, platform, account_id) DO UPDATE SET
       account_name=EXCLUDED.account_name, profile_url=EXCLUDED.profile_url, status=EXCLUDED.status, access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at, updated_at=CURRENT_TIMESTAMP
       RETURNING id, user_id AS "userId", workspace_id AS "workspaceId", platform, account_id AS "accountId", account_name AS "accountName", profile_url AS "profileUrl", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        account.id,
        this.userId,
        this.workspaceId,
        account.platform,
        account.accountId,
        account.accountName,
        account.profileUrl,
        account.status,
        account.accessToken,
        account.refreshToken,
        account.expiresAt,
      ]
    );
    return row!;
  }

  async getAccountCredentials(
    accountId: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date } | null> {
    const row = await this.queryOne<{
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
    }>(
      `SELECT access_token AS "accessToken", refresh_token AS "refreshToken", expires_at AS "expiresAt" FROM social_accounts WHERE id=$1 AND user_id=$2 AND workspace_id=$3`,
      [accountId, this.userId, this.workspaceId]
    );
    return row;
  }

  async createPost(post: Omit<SocialPost, 'createdAt' | 'updatedAt'>): Promise<SocialPost> {
    const row = await this.queryOne<SocialPost>(
      `INSERT INTO social_posts (id, user_id, workspace_id, account_id, platform, title, text, hashtags, media, metadata, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, user_id AS "userId", workspace_id AS "workspaceId", account_id AS "accountId", platform, title, text, hashtags, media, metadata, scheduled_for AS "scheduledFor", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        post.id,
        this.userId,
        this.workspaceId,
        post.accountId,
        post.platform,
        post.title,
        post.text,
        JSON.stringify(post.hashtags),
        JSON.stringify(post.media),
        JSON.stringify(post.metadata),
        post.scheduledFor,
      ]
    );
    return row!;
  }

  async createPublishRequest(
    req: Omit<PublishRequest, 'createdAt' | 'updatedAt'>
  ): Promise<PublishRequest> {
    const row = await this.queryOne<PublishRequest>(
      `INSERT INTO social_publish_requests (id, user_id, workspace_id, post_id, account_id, status, execution_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id AS "userId", workspace_id AS "workspaceId", post_id AS "postId", account_id AS "accountId", status, execution_task_id AS "executionTaskId", provider_post_id AS "providerPostId", published_url AS "publishedUrl", error, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        req.id,
        this.userId,
        this.workspaceId,
        req.postId,
        req.accountId,
        req.status,
        req.executionTaskId,
      ]
    );
    return row!;
  }

  async getPublishRequest(id: string): Promise<PublishRequest | null> {
    return this.queryOne<PublishRequest>(
      `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", post_id AS "postId", account_id AS "accountId", status, execution_task_id AS "executionTaskId", provider_post_id AS "providerPostId", published_url AS "publishedUrl", error, created_at AS "createdAt", updated_at AS "updatedAt" FROM social_publish_requests WHERE id=$1 AND user_id=$2 AND workspace_id=$3`,
      [id, this.userId, this.workspaceId]
    );
  }

  async updatePublishRequest(
    id: string,
    updates: Partial<PublishRequest>
  ): Promise<PublishRequest> {
    const current = await this.getPublishRequest(id);
    if (!current) throw new Error('Publish request not found');
    const row = await this.queryOne<PublishRequest>(
      `UPDATE social_publish_requests SET status=$1, provider_post_id=$2, published_url=$3, error=$4, execution_task_id=$5, updated_at=CURRENT_TIMESTAMP
       WHERE id=$6 AND user_id=$7 AND workspace_id=$8
       RETURNING id, user_id AS "userId", workspace_id AS "workspaceId", post_id AS "postId", account_id AS "accountId", status, execution_task_id AS "executionTaskId", provider_post_id AS "providerPostId", published_url AS "publishedUrl", error, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        updates.status ?? current.status,
        updates.providerPostId ?? current.providerPostId,
        updates.publishedUrl ?? current.publishedUrl,
        updates.error
          ? JSON.stringify(updates.error)
          : current.error
            ? JSON.stringify(current.error)
            : null,
        updates.executionTaskId ?? current.executionTaskId,
        id,
        this.userId,
        this.workspaceId,
      ]
    );
    return row!;
  }
  async listPublishRequests(): Promise<PublishRequest[]> {
    return this.query<PublishRequest>(
      `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", post_id AS "postId", account_id AS "accountId", status, execution_task_id AS "executionTaskId", provider_post_id AS "providerPostId", published_url AS "publishedUrl", error, created_at AS "createdAt", updated_at AS "updatedAt" FROM social_publish_requests WHERE user_id=$1 AND workspace_id=$2 ORDER BY created_at DESC`,
      [this.userId, this.workspaceId]
    );
  }
  async getPost(id: string): Promise<SocialPost | null> {
    return this.queryOne<SocialPost>(
      `SELECT id, user_id AS "userId", workspace_id AS "workspaceId", account_id AS "accountId", platform, title, text, hashtags, media, metadata, scheduled_for AS "scheduledFor", created_at AS "createdAt", updated_at AS "updatedAt" FROM social_posts WHERE id=$1`,
      [id]
    );
  }
  // --- Campaigns ---
  async createCampaign(campaign: PublishingCampaign): Promise<void> {
    await this.run(
      `INSERT INTO social_campaigns (id, user_id, workspace_id, content_item_id, execution_task_id, status, scheduled_for, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        campaign.id,
        this.userId,
        this.workspaceId,
        campaign.contentItemId,
        campaign.executionTaskId || null,
        campaign.status,
        campaign.scheduledFor ? new Date(campaign.scheduledFor) : null,
        campaign.version,
        new Date(campaign.createdAt),
        new Date(campaign.updatedAt),
      ]
    );
  }

  async getCampaign(id: string): Promise<PublishingCampaign | null> {
    const res = await this.query(
      `SELECT * FROM social_campaigns WHERE id = $1 AND user_id = $2 AND workspace_id = $3`,
      [id, this.userId, this.workspaceId]
    );
    if (!res.rows[0]) return null;
    return this.mapCampaign(res.rows[0]);
  }

  async updateCampaign(id: string, updates: Partial<PublishingCampaign>): Promise<void> {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    const setClauses = [];
    const values: unknown[] = [];
    let i = 1;

    for (const key of keys) {
      if (key === 'status') {
        setClauses.push(`status = ${i++}`);
        values.push(updates.status);
      }
      if (key === 'executionTaskId') {
        setClauses.push(`execution_task_id = ${i++}`);
        values.push(updates.executionTaskId);
      }
      if (key === 'scheduledFor') {
        setClauses.push(`scheduled_for = ${i++}`);
        values.push(updates.scheduledFor ? new Date(updates.scheduledFor) : null);
      }
      if (key === 'version') {
        setClauses.push(`version = ${i++}`);
        values.push(updates.version);
      }
    }

    if (setClauses.length === 0) return;
    setClauses.push(`updated_at = ${i++}`);
    values.push(new Date());

    values.push(id, this.userId, this.workspaceId);
    await this.run(
      `UPDATE social_campaigns SET ${setClauses.join(', ')} WHERE id = ${i - 2} AND user_id = ${i - 1} AND workspace_id = ${i}`,
      values
    );
  }

  async listCampaigns(): Promise<PublishingCampaign[]> {
    const res = await this.query(
      `SELECT * FROM social_campaigns WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC`,
      [this.userId, this.workspaceId]
    );
    return res.rows.map((r) => this.mapCampaign(r));
  }

  async createCampaignTarget(target: CampaignTarget): Promise<void> {
    await this.run(
      `INSERT INTO social_campaign_targets (id, campaign_id, user_id, workspace_id, account_id, platform, publish_request_id, status, error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        target.id,
        target.campaignId,
        this.userId,
        this.workspaceId,
        target.accountId,
        target.platform,
        target.publishRequestId,
        target.status,
        target.error ? JSON.stringify(target.error) : null,
        new Date(target.createdAt),
        new Date(target.updatedAt),
      ]
    );
  }

  async getCampaignTargets(campaignId: string): Promise<CampaignTarget[]> {
    const res = await this.query(
      `SELECT * FROM social_campaign_targets WHERE campaign_id = $1 AND user_id = $2 AND workspace_id = $3`,
      [campaignId, this.userId, this.workspaceId]
    );
    return res.rows.map((r) => this.mapTarget(r));
  }

  async updateCampaignTarget(id: string, updates: Partial<CampaignTarget>): Promise<void> {
    const setClauses = [];
    const values: unknown[] = [];
    let i = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = ${i++}`);
      values.push(updates.status);
    }
    if (updates.error !== undefined) {
      setClauses.push(`error = ${i++}`);
      values.push(updates.error ? JSON.stringify(updates.error) : null);
    }

    if (setClauses.length === 0) return;
    setClauses.push(`updated_at = ${i++}`);
    values.push(new Date());

    values.push(id, this.userId, this.workspaceId);
    await this.run(
      `UPDATE social_campaign_targets SET ${setClauses.join(', ')} WHERE id = ${i - 2} AND user_id = ${i - 1} AND workspace_id = ${i}`,
      values
    );
  }

  private mapCampaign(row: unknown): PublishingCampaign {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      contentItemId: row.content_item_id,
      executionTaskId: row.execution_task_id || undefined,
      status: row.status,
      scheduledFor: row.scheduled_for?.toISOString(),
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapTarget(row: unknown): CampaignTarget {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      accountId: row.account_id,
      platform: row.platform,
      publishRequestId: row.publish_request_id,
      status: row.status,
      error: row.error || undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
