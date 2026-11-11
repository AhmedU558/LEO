import type {
  SocialProvider,
  ProviderCapability,
  SocialAccount,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';

/**
 * LinkedIn: posts to the connected member's own profile (scope w_member_social), and to
 * company pages the member administers once the app has LinkedIn's Community Management
 * API (scopes w_organization_social + r_organization_admin). A page is stored as its own
 * account whose accountId is the organization URN.
 */

const API = 'https://api.linkedin.com';
/** LinkedIn's versioned REST API (YYYYMM). Versions are retired about a year after release. */
const apiVersion = () => process.env.LINKEDIN_API_VERSION || '202609';

export const LINKEDIN_SCOPES = 'openid profile w_member_social';
export const LINKEDIN_PAGE_SCOPES = `${LINKEDIN_SCOPES} w_organization_social r_organization_admin`;
const ORG_URN = 'urn:li:organization:';

/** A stored LinkedIn accountId is either a member id (`sub`) or a company-page URN. */
export const isLinkedInPage = (accountId: string) => accountId.startsWith(ORG_URN);
const authorUrn = (accountId: string) =>
  isLinkedInPage(accountId) ? accountId : `urn:li:person:${accountId}`;
const MAX_IMAGE_BYTES = 36_000_000; // LinkedIn's image upload limit (~36 MB)

/**
 * LinkedIn's "little text format" treats these characters as markup; unescaped,
 * the post is silently cut off at the first one. `#` is left alone so hashtags stay hashtags.
 */
export function escapeCommentary(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (ch) => `\\${ch}`);
}

export class LinkedInProvider implements SocialProvider {
  readonly platform = 'linkedin';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false,
      supportsVideo: false,
      supportsImages: true,
      supportsCancellation: false,
      maxMediaCount: 1,
    };
  }

  private headers(accessToken: string, json = true): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': apiVersion(),
      'X-Restli-Protocol-Version': '2.0.0',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async connect(
    code: string,
    redirectUri: string
  ): Promise<
    Partial<SocialAccount> & { accessToken: string; refreshToken?: string; expiresAt?: Date }
  > {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
      }),
    });
    const token = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(`LinkedIn sign-in failed: ${token.error_description ?? tokenRes.status}`);
    }

    const meRes = await fetch(`${API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = (await meRes.json()) as { sub?: string; name?: string };
    if (!meRes.ok || !me.sub) throw new Error('LinkedIn did not return your member profile.');

    return {
      accountId: me.sub,
      accountName: me.name ?? 'LinkedIn member',
      profileUrl: 'https://www.linkedin.com/in/me',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    };
  }

  /** Company pages the signed-in member administers (needs r_organization_admin). */
  async listAdminPages(accessToken: string): Promise<Array<{ urn: string; name: string }>> {
    const res = await fetch(
      `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
      { headers: this.headers(accessToken, false) }
    );
    if (!res.ok) throw new Error(`LinkedIn would not list your company pages (${res.status})`);
    const acls = (await res.json()) as { elements?: Array<{ organization?: string }> };
    const urns = (acls.elements ?? [])
      .map((e) => e.organization)
      .filter((urn): urn is string => !!urn?.startsWith(ORG_URN));

    return Promise.all(
      urns.map(async (urn) => {
        const org = await fetch(`${API}/rest/organizations/${urn.slice(ORG_URN.length)}`, {
          headers: this.headers(accessToken, false),
        });
        const data = (await safeJson(org)) as { localizedName?: string };
        return { urn, name: data.localizedName ?? 'LinkedIn page' };
      })
    );
  }

  async getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'> {
    try {
      const res = await fetch(`${API}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.ok ? 'active' : 'disconnected';
    } catch {
      return 'error';
    }
  }

  async validateMedia(media: MediaAsset[]): Promise<{ valid: boolean; error?: string }> {
    if (media.length > 1) return { valid: false, error: 'LinkedIn posts support one image here' };
    const asset = media[0];
    if (asset && asset.mediaType !== 'image') {
      return { valid: false, error: 'Only images are supported for LinkedIn posts' };
    }
    if (asset && asset.sizeBytes > MAX_IMAGE_BYTES) {
      return { valid: false, error: 'LinkedIn images must be under 36 MB' };
    }
    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    const validation = await this.validateMedia(post.media ?? []);
    if (!validation.valid) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: validation.error!, retryable: false },
      };
    }
    const author = authorUrn((post.metadata?.providerAccountId as string) || post.accountId);
    const text = [post.text, post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');

    try {
      const image = post.media?.[0]
        ? await this.uploadImage(post.media[0], author, accessToken)
        : undefined;

      const res = await fetch(`${API}/rest/posts`, {
        method: 'POST',
        headers: this.headers(accessToken),
        body: JSON.stringify({
          author,
          commentary: escapeCommentary(text),
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          ...(image ? { content: { media: { id: image, title: post.title ?? '' } } } : {}),
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });
      if (!res.ok) return { status: 'failed', error: this.normalizeError(await safeJson(res)) };

      const postUrn = res.headers.get('x-restli-id') ?? undefined;
      return {
        status: 'published',
        providerPostId: postUrn,
        publishedUrl: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : undefined,
      };
    } catch (error) {
      return { status: 'failed', error: this.normalizeError(error) };
    }
  }

  /** Images API: register an upload, PUT the bytes, return the image URN for the post. */
  private async uploadImage(
    asset: MediaAsset,
    owner: string,
    accessToken: string
  ): Promise<string> {
    const init = await fetch(`${API}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    const data = (await safeJson(init)) as { value?: { uploadUrl?: string; image?: string } };
    if (!init.ok || !data.value?.uploadUrl || !data.value.image) {
      throw Object.assign(new Error('LinkedIn would not accept an image upload'), {
        details: data,
      });
    }

    const { storageProvider } = await import('../../storage/index.js');
    const stream = await storageProvider.download(asset.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    const put = await fetch(data.value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': asset.mimeType },
      body: Buffer.concat(chunks),
    });
    if (!put.ok) throw new Error(`LinkedIn image upload failed (${put.status})`);
    return data.value.image;
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    const res = await fetch(`${API}/rest/posts/${encodeURIComponent(providerPostId)}`, {
      headers: this.headers(accessToken, false),
    });
    if (res.ok) {
      return {
        status: 'published',
        providerPostId,
        publishedUrl: `https://www.linkedin.com/feed/update/${providerPostId}`,
      };
    }
    return { status: 'unknown', providerPostId, error: this.normalizeError(await safeJson(res)) };
  }

  async cancelPublish(): Promise<boolean> {
    return false; // LinkedIn posts publish immediately; nothing is left to cancel.
  }

  normalizeError(error: unknown): PlatformError {
    if (error instanceof Error) {
      return { code: 'LINKEDIN_ERROR', message: error.message, retryable: false };
    }
    const err = (error ?? {}) as { status?: number; message?: string; serviceErrorCode?: number };
    const status = err.status ?? 0;
    return {
      code: String(err.serviceErrorCode ?? (status || 'UNKNOWN')),
      message: err.message ?? 'LinkedIn request failed',
      retryable: status === 429 || status >= 500,
      providerDetails: error,
    };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return { status: res.status };
  }
}
