import type { SocialPost, PublishRequest, SocialAccount } from '@ownpilot/core/social';
import { SocialRepository } from '../../db/repositories/social.js';
import { socialProviderRegistry } from './provider-registry.js';
import { ExecutionTaskService } from '../execution-task-service.js';
import { createWorkflowsRepository } from '../../db/repositories/workflows/index.js';
import { randomUUID } from 'node:crypto';
import { getLog } from '../log.js';
import { ActionLedger, PolicyEngine, RiskEngine } from '@ownpilot/core/security';

const log = getLog('SocialService');

export class SocialService {
  constructor(
    private userId: string,
    private workspaceId: string
  ) {}

  private async getOrCreateSystemWorkflow(): Promise<string> {
    const wfRepo = createWorkflowsRepository(this.userId);
    const workflows = await wfRepo.getPage(100, 0);
    let wf = workflows.find((w) => w.name === '__system_social_publish');
    if (!wf) {
      wf = await wfRepo.create({
        name: '__system_social_publish',
        description: 'System workflow for durable social publishing',
        status: 'active',
        nodes: [
          { id: 'publish_node', type: 'socialPublishNode', position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [],
      });
    }
    return wf.id;
  }

  async listAccounts(): Promise<Omit<SocialAccount, 'accessToken' | 'refreshToken'>[]> {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const accounts = await repo.listAccounts();
    return accounts.map((a) => {
      const { accessToken: _a, refreshToken: _r, ...rest } = a as Record<string, unknown>;
      return rest as unknown as Omit<SocialAccount, 'accessToken' | 'refreshToken'>;
    });
  }

  async getAccount(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    return repo.getAccount(id);
  }

  async getAccountStatus(accountId: string) {
    const account = await this.getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const creds = await repo.getAccountCredentials(accountId);
    if (!creds?.accessToken) return 'disconnected';
    const provider = socialProviderRegistry.get(account.platform);
    return provider.getConnectionStatus(creds.accessToken);
  }

  async createPublishTask(
    postInput: Omit<SocialPost, 'id' | 'userId' | 'workspaceId' | 'createdAt' | 'updatedAt'>
  ): Promise<{ request: PublishRequest; taskId: string }> {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const account = await repo.getAccount(postInput.accountId);
    if (!account) throw new Error('Account not found');
    if (account.platform !== postInput.platform) throw new Error('Platform mismatch');

    // Risk and Policy Checks
    const identity = { userId: this.userId, workspaceId: this.workspaceId, roles: [] };
    const resourceId = `social_account:${account.id}`;
    const policyResult = new PolicyEngine().evaluate(identity, 'social.publish', resourceId, {
      platform: account.platform,
    });
    if (!policyResult.allowed) throw new Error(`Policy denied: ${policyResult.reason}`);

    const riskLevel = new RiskEngine().classify(identity, 'social.publish', {
      platform: account.platform,
      text: postInput.text,
    });

    // Ledger
    await ActionLedger.record(
      identity,
      null,
      null,
      null,
      'social_publish',
      'publish_request',
      resourceId,
      'social_account',
      account.id,
      'social.publish',
      policyResult.allowed ? 'allow' : 'deny',
      riskLevel.level,
      'trusted',
      { status: 'created' },
      null,
      0
    );

    const provider = socialProviderRegistry.get(postInput.platform);
    if (postInput.media && postInput.media.length > 0) {
      const capabilities = provider.getCapabilities();
      if (postInput.media.length > capabilities.maxMediaCount) {
        throw new Error(`Platform limits media to ${capabilities.maxMediaCount} items`);
      }
    }

    const postId = `post_${randomUUID()}`;
    const requestId = `pubreq_${randomUUID()}`;

    const post = await repo.createPost({
      ...postInput,
      id: postId,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    const request = await repo.createPublishRequest({
      id: requestId,
      postId: post.id,
      accountId: account.id,
      status: 'pending',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    const workflowId = await this.getOrCreateSystemWorkflow();
    const executionTaskService = new ExecutionTaskService(this.userId, this.workspaceId);
    const task = await executionTaskService.start({
      workflowId,
      requestKey: `social_publish_${requestId}`,
      inputs: { publishRequestId: request.id },
    });

    const updatedRequest = await repo.updatePublishRequest(request.id, {
      executionTaskId: task.id,
    });

    return { request: updatedRequest, taskId: task.id };
  }

  async getPublishStatus(id: string) {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    return repo.getPublishRequest(id);
  }

  async cancelPublish(id: string): Promise<boolean> {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const request = await repo.getPublishRequest(id);
    if (!request) throw new Error('Request not found');
    if (request.status !== 'pending' && request.status !== 'publishing') {
      throw new Error(`Cannot cancel request in state: ${request.status}`);
    }

    const account = await repo.getAccount(request.accountId);
    if (!account) throw new Error('Account not found');

    const provider = socialProviderRegistry.get(account.platform);
    const capabilities = provider.getCapabilities();

    if (capabilities.supportsCancellation && request.providerPostId) {
      const creds = await repo.getAccountCredentials(account.id);
      if (creds?.accessToken) {
        try {
          await provider.cancelPublish(request.providerPostId, creds.accessToken);
        } catch (e) {
          log.warn(`Provider failed to cancel post ${request.providerPostId}: ${e}`);
        }
      }
    }

    if (request.executionTaskId) {
      const etService = new ExecutionTaskService(this.userId, this.workspaceId);
      await etService.cancel(request.executionTaskId);
    }

    await repo.updatePublishRequest(id, { status: 'cancelled' });
    return true;
  }
  async reconcilePublish(id: string): Promise<PublishResult> {
    const repo = new SocialRepository(this.userId, this.workspaceId);
    const request = await repo.getPublishRequest(id);
    if (!request) throw new Error('Request not found');
    if (request.status !== 'unknown') {
      throw new Error(`Cannot reconcile request in state: ${request.status}`);
    }

    const account = await repo.getAccount(request.accountId);
    if (!account) throw new Error('Account not found');

    const provider = socialProviderRegistry.get(account.platform);
    if (!request.providerPostId) {
      // If we don't have the post ID, we can't easily reconcile via checkPublishStatus
      // We'd have to search the channel for a matching video title, etc.
      // For now, if no providerPostId, it's unrecoverable without manual intervention
      throw new Error('No provider correlation ID to reconcile');
    }

    const creds = await repo.getAccountCredentials(account.id);
    if (!creds?.accessToken) throw new Error('No access token available');

    const result = await provider.checkPublishStatus(request.providerPostId, creds.accessToken);
    await repo.updatePublishRequest(id, {
      status: result.status,
      publishedUrl: result.publishedUrl,
      error: result.error,
    });

    return result;
  }
}
