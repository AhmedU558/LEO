import { getLog } from '../log.js';
import type { SocialProvider, SocialPlatform } from '@ownpilot/core/social';
import { YouTubeProvider } from './providers/youtube.js';

const log = getLog('SocialProviderRegistry');

export class SocialProviderRegistry {
  private providers = new Map<SocialPlatform, SocialProvider>();

  register(provider: SocialProvider) {
    this.providers.set(provider.platform, provider);
    log.info(`Registered social provider for ${provider.platform}`);
  }

  get(platform: SocialPlatform): SocialProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`No production social publish provider configured for platform: ${platform}`);
    }
    return provider;
  }
}

export const socialProviderRegistry = new SocialProviderRegistry();
socialProviderRegistry.register(new YouTubeProvider());
