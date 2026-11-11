import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialPost } from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';

const download = vi.fn();
vi.mock('../../storage/index.js', () => ({ storageProvider: { download } }));

const { LinkedInProvider, escapeCommentary } = await import('./linkedin.js');

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'p1',
  userId: 'u',
  workspaceId: 'w',
  accountId: 'acc_1',
  platform: 'linkedin',
  text: 'Shipping LEO (v1) today',
  hashtags: ['AI', '#LEO'],
  media: [],
  metadata: { providerAccountId: 'member123' },
  createdAt: '',
  updatedAt: '',
  ...over,
});

const image: MediaAsset = {
  id: 'm1',
  userId: 'u',
  workspaceId: 'w',
  filename: 'banner.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'image',
  sizeBytes: 4,
  storageKey: 'k/banner.jpg',
  checksum: '',
  metadata: {},
  status: 'ready',
  createdAt: new Date(),
  updatedAt: new Date(),
} as MediaAsset;

describe('LinkedInProvider', () => {
  const fetchMock = vi.fn();
  let provider: InstanceType<typeof LinkedInProvider>;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    download.mockReset();
    process.env.LINKEDIN_CLIENT_ID = 'cid';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    provider = new LinkedInProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
  });

  it('exchanges the code and returns the member as the account', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'tok', expires_in: 5_184_000 }))
      .mockResolvedValueOnce(json({ sub: 'member123', name: 'Ahmed U' }));

    const account = await provider.connect('the-code', 'http://localhost:8199/cb');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    expect(String(tokenInit.body)).toContain('code=the-code');
    expect(String(tokenInit.body)).toContain('client_secret=secret');
    expect(account).toMatchObject({
      accountId: 'member123',
      accountName: 'Ahmed U',
      accessToken: 'tok',
    });
    expect(account.expiresAt).toBeInstanceOf(Date);
  });

  it('reports a failed sign-in clearly', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error_description: 'The authorization code expired' }, { status: 400 })
    );

    await expect(provider.connect('old', 'http://x/cb')).rejects.toThrow(
      'LinkedIn sign-in failed: The authorization code expired'
    );
  });

  it('publishes a text post as the member, escaping markup characters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:999' } })
    );

    const result = await provider.publish(post(), 'tok');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.linkedin.com/rest/posts');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-Restli-Protocol-Version': '2.0.0',
    });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      author: 'urn:li:person:member123',
      commentary: 'Shipping LEO \\(v1\\) today\n\n#AI #LEO',
      visibility: 'PUBLIC',
      lifecycleState: 'PUBLISHED',
    });
    expect(body.content).toBeUndefined();
    expect(result).toEqual({
      status: 'published',
      providerPostId: 'urn:li:share:999',
      publishedUrl: 'https://www.linkedin.com/feed/update/urn:li:share:999',
    });
  });

  it('publishes as the company page when the account is a page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } })
    );
    await provider.publish({ ...post(), accountId: 'urn:li:organization:42', metadata: {} }, 'tok');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).author).toBe('urn:li:organization:42');
  });

  it('lists the company pages the member administers', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ elements: [{ organization: 'urn:li:organization:42' }, { organization: 'x' }] })
      )
      .mockResolvedValueOnce(json({ localizedName: 'Aqvion Labs' }));

    await expect(provider.listAdminPages('tok')).resolves.toEqual([
      { urn: 'urn:li:organization:42', name: 'Aqvion Labs' },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED'
    );
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.linkedin.com/rest/organizations/42');
  });

  it('explains when LinkedIn will not list company pages', async () => {
    fetchMock.mockResolvedValueOnce(json({}, { status: 403 }));
    await expect(provider.listAdminPages('tok')).rejects.toThrow('(403)');
  });

  it('uploads an image from LEO storage and attaches it', async () => {
    download.mockResolvedValue(
      (async function* () {
        yield Buffer.from([1, 2]);
        yield Buffer.from([3, 4]);
      })()
    );
    fetchMock
      .mockResolvedValueOnce(
        json({ value: { uploadUrl: 'https://upload.linkedin/x', image: 'urn:li:image:7' } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } })
      );

    const result = await provider.publish(post({ media: [image], title: 'Banner' }), 'tok');

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.linkedin.com/rest/images?action=initializeUpload'
    );
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1]!;
    expect(uploadUrl).toBe('https://upload.linkedin/x');
    expect(Buffer.from(uploadInit.body)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).content).toEqual({
      media: { id: 'urn:li:image:7', title: 'Banner' },
    });
    expect(result.status).toBe('published');
  });

  it('returns LinkedIn errors as a failed result', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { status: 403, serviceErrorCode: 100, message: 'Not enough permissions' },
        { status: 403 }
      )
    );

    const result = await provider.publish(post(), 'tok');

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: '100', message: 'Not enough permissions', retryable: false },
    });
  });

  it('rejects videos and more than one image', async () => {
    expect(await provider.validateMedia([{ ...image, mediaType: 'video' } as MediaAsset])).toEqual({
      valid: false,
      error: 'Only images are supported for LinkedIn posts',
    });
    expect((await provider.validateMedia([image, image])).valid).toBe(false);
    expect((await provider.validateMedia([])).valid).toBe(true);
  });

  it('escapes every little-text-format character but keeps hashtags', () => {
    expect(escapeCommentary('a(b)[c]{d}<e>@f|g*h_i~j\\k #tag')).toBe(
      'a\\(b\\)\\[c\\]\\{d\\}\\<e\\>\\@f\\|g\\*h\\_i\\~j\\\\k #tag'
    );
  });
});
