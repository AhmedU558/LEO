import type {
  SocialPlatform,
  SocialAccount,
  SocialPost,
  PublishResult,
  PlatformError,
} from './models.js';
import type { MediaAsset } from '../media/models.js';

export interface ProviderCapability {
  supportsScheduling: boolean;
  supportsVideo: boolean;
  supportsImages: boolean;
  supportsCancellation: boolean;
  maxMediaCount: number;
}

export interface SocialProvider {
  /**
   * The platform this provider handles.
   */
  readonly platform: SocialPlatform;

  /**
   * Capability discovery for this provider.
   */
  getCapabilities(): ProviderCapability;

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
   * Return the current status of the account connection.
   */
  getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'>;

  /**
   * Validate media against platform limits before publishing.
   */
  validateMedia(media: MediaAsset[]): Promise<{ valid: boolean; error?: string }>;

  /**
   * Publish post to the platform immediately or at the scheduled time (if supported).
   */
  publish(post: SocialPost, accessToken: string): Promise<PublishResult>;

  /**
   * Check status of a previously published post (e.g. video processing or scheduled post).
   */
  checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult>;

  /**
   * Cancel a scheduled post if the provider supports it.
   */
  cancelPublish(providerPostId: string, accessToken: string): Promise<boolean>;

  /**
   * Normalize an unknown provider error to PlatformError.
   */
  normalizeError(error: unknown): PlatformError;
}
