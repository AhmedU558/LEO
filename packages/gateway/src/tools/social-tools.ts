/**
 * Social Tools — lets chat draft and publish posts to connected social accounts.
 *
 *   - list_social_accounts — what LEO can post to (personal profile, company pages)
 *   - publish_social_post  — posts ONLY after the user clicks Approve in the chat
 *                            approval dialog, which shows the exact final text.
 *
 * Contexts without an approval channel (triggers, claws, messaging channels) are
 * refused, so a post can never go out without a person approving that exact text.
 */

import type { ToolDefinition } from '@ownpilot/core/tools';
import { getErrorMessage } from '@ownpilot/core/services';
import { SocialRepository } from '../db/repositories/social.js';
import { SocialService } from '../services/social/service.js';
import { isLinkedInPage } from '../services/social/providers/linkedin.js';
import type { ToolExecutionResult } from '../services/tool/executor.js';

const WORKSPACE = 'default';
const LINKEDIN_MAX_CHARS = 3000;
const PUBLISH_WAIT_MS = 30_000;

type Approve = (
  category: string,
  actionType: string,
  description: string,
  params: Record<string, unknown>
) => Promise<boolean>;

export const SOCIAL_TOOLS: ToolDefinition[] = [
  {
    name: 'list_social_accounts',
    description:
      "List the social accounts LEO can post to, e.g. the user's personal LinkedIn profile and any LinkedIn company pages. Call this before drafting a post so you can ask the user where it should go.",
    category: 'social',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'publish_social_post',
    description:
      'Publish a post to a connected social account (LinkedIn). Workflow: (1) call list_social_accounts; ' +
      '(2) write the draft and show it to the user in chat; (3) ask whether to post on their personal ' +
      'profile or a company page — if the page they want is not in the list, say it has to be connected ' +
      'on the Social page first; (4) revise until the user says it is ready; (5) call this tool. ' +
      'The user then sees the exact text in an approval dialog and nothing is posted unless they click ' +
      'Approve. If they reject, ask what to change. Put hashtags in `hashtags`, not in `text`.',
    category: 'social',
    parameters: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'The `id` of the account from list_social_accounts.',
        },
        text: { type: 'string', description: 'The post body, exactly as it should appear.' },
        hashtags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hashtags without the # sign, e.g. ["AI", "Java"].',
        },
      },
      required: ['accountId', 'text'],
    },
  },
];

export const SOCIAL_TOOL_NAMES = SOCIAL_TOOLS.map((t) => t.name);

export async function executeSocialTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default',
  context?: { requestApproval?: Approve }
): Promise<ToolExecutionResult> {
  try {
    const repo = new SocialRepository(userId, WORKSPACE);
    switch (toolName) {
      case 'list_social_accounts': {
        const accounts = await repo.listAccounts();
        return {
          success: true,
          result: {
            accounts: accounts.map((a) => ({
              id: a.id,
              platform: a.platform,
              name: a.accountName,
              kind:
                a.platform === 'linkedin' && isLinkedInPage(a.accountId)
                  ? 'company page'
                  : 'personal profile',
              status: a.status,
            })),
          },
        };
      }
      case 'publish_social_post':
        return await publish(repo, args, userId, context?.requestApproval);
      default:
        return { success: false, error: `Unknown social tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

async function publish(
  repo: SocialRepository,
  args: Record<string, unknown>,
  userId: string,
  requestApproval: Approve | undefined
): Promise<ToolExecutionResult> {
  if (!requestApproval) {
    return {
      success: false,
      error:
        'Posting needs the user to approve it in the LEO chat window; it cannot run from here.',
    };
  }
  const accountId = String(args.accountId ?? '');
  const text = String(args.text ?? '').trim();
  const hashtags = Array.isArray(args.hashtags)
    ? args.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean)
    : [];
  if (!text) return { success: false, error: 'The post text is empty.' };

  const account = await repo.getAccount(accountId);
  if (!account) {
    return {
      success: false,
      error: `No connected account "${accountId}". Use list_social_accounts.`,
    };
  }

  // Exactly what the provider will publish (see LinkedInProvider.publish).
  const preview = [text, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
  if (account.platform === 'linkedin' && preview.length > LINKEDIN_MAX_CHARS) {
    return {
      success: false,
      error: `The post is ${preview.length} characters; LinkedIn allows ${LINKEDIN_MAX_CHARS}. Shorten it.`,
    };
  }

  const where =
    account.platform === 'linkedin' && isLinkedInPage(account.accountId)
      ? `the ${account.accountName} company page`
      : `${account.accountName}'s personal profile`;
  const approved = await requestApproval(
    'social',
    'publish_social_post',
    `Publish this post publicly to ${where} on ${account.platform}?`,
    { code: preview }
  );
  if (!approved) {
    return {
      success: false,
      error: 'The user did not approve the post, so nothing was published. Ask what to change.',
    };
  }

  const { request } = await new SocialService(userId, WORKSPACE).createPublishTask({
    accountId: account.id,
    platform: account.platform,
    text,
    hashtags,
    media: [],
    metadata: {},
  });

  // The publish runs on the job queue; wait briefly so the reply can include the link.
  const deadline = Date.now() + PUBLISH_WAIT_MS;
  while (Date.now() < deadline) {
    const current = await repo.getPublishRequest(request.id);
    if (current?.status === 'published') {
      return { success: true, result: { status: 'published', url: current.publishedUrl } };
    }
    if (current?.status === 'failed') {
      return {
        success: false,
        error: `${account.platform} rejected the post: ${current.error?.message ?? 'unknown error'}`,
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    success: true,
    result: { status: 'publishing', note: 'Still publishing; check the Social page shortly.' },
  };
}
