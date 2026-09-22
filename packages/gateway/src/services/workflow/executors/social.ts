import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import type { DispatchNodeContext } from '../workflow-context.js';
import { SocialRepository } from '../../../db/repositories/social.js';
import { socialProviderRegistry } from '../../social/provider-registry.js';
import { getErrorMessage } from '../../../utils/common.js';

export async function executeSocialPublishNode(
  context: DispatchNodeContext,
  node: WorkflowNode
): Promise<NodeResult> {
  const startTime = Date.now();

  try {
    // Inputs come from ExecutionTask mapping
    const publishRequestId = (context as any).workflowInputs
      ?.publishRequestId as string | undefined;
    if (!publishRequestId) throw new Error('Missing publishRequestId input');

    // Need workspaceId which was missing from the DispatchNodeContext type in this context?
    const workspaceId = (context as any).workspaceId || 'default';

    const repo = new SocialRepository(context.userId, workspaceId);
    const request = await repo.getPublishRequest(publishRequestId);
    if (!request) throw new Error('Publish request not found');
    if (request.status === 'cancelled') throw new Error('Request was cancelled');

    const post = await repo.getPost(request.postId);
    if (!post) throw new Error('Post not found');

    const creds = await repo.getAccountCredentials(request.accountId);
    if (!creds?.accessToken) {
      await repo.updatePublishRequest(publishRequestId, {
        status: 'failed',
        error: { code: 'AUTH_FAILED', message: 'No credentials available', retryable: false },
      });
      throw new Error('No credentials available');
    }

    const account = await repo.getAccount(request.accountId);
    if (!account) throw new Error('Account not found');

    let provider;
    try {
      provider = socialProviderRegistry.get(account.platform);
    } catch (e) {
      await repo.updatePublishRequest(publishRequestId, {
        status: 'failed',
        error: { code: 'PROVIDER_NOT_CONFIGURED', message: String(e), retryable: false },
      });
      throw e;
    }

        // Inject provider account ID so providers that need it (like Instagram) have access to it
    if (!post.metadata) post.metadata = {};
    post.metadata.providerAccountId = account.accountId;

    // Validate media

    if (post.media && post.media.length > 0) {
      const valid = await provider.validateMedia(post.media);
      if (!valid.valid) {
        await repo.updatePublishRequest(publishRequestId, {
          status: 'failed',
          error: {
            code: 'INVALID_MEDIA',
            message: valid.error ?? 'Invalid media',
            retryable: false,
          },
        });
        throw new Error(valid.error);
      }
    }

    await repo.updatePublishRequest(publishRequestId, { status: 'publishing' });
    const result = await provider.publish(post, creds.accessToken);
    await repo.updatePublishRequest(publishRequestId, {
      status: result.status,
      providerPostId: result.providerPostId,
      publishedUrl: result.publishedUrl,
      error: result.error,
    });

    const success = result.status !== 'failed' && result.status !== 'unknown';
    return {
      nodeId: node.id,
      status: success ? 'success' : 'error',
      output: JSON.stringify(result),
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(err),
      durationMs: Date.now() - startTime,
    };
  }
}

