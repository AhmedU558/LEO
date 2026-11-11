import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = {
  listAccounts: vi.fn(),
  getAccount: vi.fn(),
  getPublishRequest: vi.fn(),
};
const createPublishTask = vi.fn();

vi.mock('../db/repositories/social.js', () => ({
  SocialRepository: vi.fn(function () {
    return repo;
  }),
}));
vi.mock('../services/social/service.js', () => ({
  SocialService: vi.fn(function () {
    return { createPublishTask };
  }),
}));

const { executeSocialTool } = await import('./social-tools.js');

const personal = {
  id: 'acc-me',
  platform: 'linkedin',
  accountId: 'abc123',
  accountName: 'Ahmed Umer',
  status: 'active',
};
const page = {
  id: 'acc-page',
  platform: 'linkedin',
  accountId: 'urn:li:organization:42',
  accountName: 'Aqvion Labs',
  status: 'active',
};

describe('social tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getAccount.mockResolvedValue(personal);
    createPublishTask.mockResolvedValue({ request: { id: 'req-1' }, taskId: 't-1' });
    repo.getPublishRequest.mockResolvedValue({
      status: 'published',
      publishedUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1',
    });
  });

  it('lists personal profiles and company pages', async () => {
    repo.listAccounts.mockResolvedValue([personal, page]);
    const res = await executeSocialTool('list_social_accounts', {});
    expect(res.result).toEqual({
      accounts: [
        expect.objectContaining({ id: 'acc-me', kind: 'personal profile' }),
        expect.objectContaining({ id: 'acc-page', kind: 'company page', name: 'Aqvion Labs' }),
      ],
    });
  });

  it('refuses to post where nobody can approve it', async () => {
    const res = await executeSocialTool('publish_social_post', { accountId: 'acc-me', text: 'Hi' });
    expect(res.success).toBe(false);
    expect(createPublishTask).not.toHaveBeenCalled();
  });

  it('publishes nothing when the user rejects', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    const res = await executeSocialTool(
      'publish_social_post',
      { accountId: 'acc-me', text: 'Hi' },
      'default',
      { requestApproval }
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/did not approve/);
    expect(createPublishTask).not.toHaveBeenCalled();
  });

  it('shows the exact post and target, then publishes what was approved', async () => {
    repo.getAccount.mockResolvedValue(page);
    const requestApproval = vi.fn().mockResolvedValue(true);
    const res = await executeSocialTool(
      'publish_social_post',
      { accountId: 'acc-page', text: 'Quantum is coming.', hashtags: ['#Quantum', 'AI'] },
      'default',
      { requestApproval }
    );

    expect(requestApproval).toHaveBeenCalledWith(
      'social',
      'publish_social_post',
      expect.stringContaining('Aqvion Labs company page'),
      { code: 'Quantum is coming.\n\n#Quantum #AI' }
    );
    expect(createPublishTask).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-page',
        text: 'Quantum is coming.',
        hashtags: ['Quantum', 'AI'],
      })
    );
    expect(res).toEqual({
      success: true,
      result: { status: 'published', url: 'https://www.linkedin.com/feed/update/urn:li:share:1' },
    });
  });

  it('rejects posts over LinkedIn’s length limit before asking', async () => {
    const requestApproval = vi.fn();
    const res = await executeSocialTool(
      'publish_social_post',
      { accountId: 'acc-me', text: 'x'.repeat(3001) },
      'default',
      { requestApproval }
    );
    expect(res.success).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('reports a provider failure', async () => {
    repo.getPublishRequest.mockResolvedValue({
      status: 'failed',
      error: { message: 'Token expired' },
    });
    const res = await executeSocialTool(
      'publish_social_post',
      { accountId: 'acc-me', text: 'Hi' },
      'default',
      { requestApproval: vi.fn().mockResolvedValue(true) }
    );
    expect(res).toEqual({ success: false, error: 'linkedin rejected the post: Token expired' });
  });
});
