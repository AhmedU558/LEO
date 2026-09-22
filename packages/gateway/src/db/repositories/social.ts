import { BaseRepository } from './base.js';
import type { SocialAccount, SocialPost, PublishRequest } from '@ownpilot/core/social';

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
}
