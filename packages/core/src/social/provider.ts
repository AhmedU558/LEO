import type { SocialPlatform, SocialContent, SocialAccount } from './models.js';

export interface SocialPublishResult {
  success: boolean;
  providerPostId?: string;
  publishedUrl?: string;
  error?: string;
  retryable?: boolean;
}

export interface SocialProvider {
  /**
   * The platform this provider handles.
   */
  readonly platform: SocialPlatform;

  /**
   * Connect/exchange auth code for a provider account.
   */
  connect(
    code: string,
    redirectUri: string
  ): Promise<
    Partial<SocialAccount> & { accessToken: string; refreshToken?: string; expiresAt?: Date }
  >;

  /**
   * Validate if an existing connection is still active.
   */
  validateConnection(accountId: string, accessToken: string): Promise<boolean>;

  /**
   * Publish content to the platform.
   */
  publish(content: SocialContent, accessToken: string): Promise<SocialPublishResult>;

  /**
   * Check status of a previously published post (e.g. video processing).
   */
  checkStatus(providerPostId: string, accessToken: string): Promise<SocialPublishResult>;
}
