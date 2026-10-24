import { getLog } from '../log.js';
import type { SocialProvider, SocialPlatform } from '@ownpilot/core/social';
import { YouTubeProvider } from './providers/youtube.js';
import { InstagramProvider } from './providers/instagram.js';
import { FacebookProvider } from './providers/facebook.js';
import { TikTokProvider } from './providers/tiktok.js';

const log = getLog('SocialProviderRegistry');

export class SocialProviderRegistry {
  private providers = new Map<SocialPlatform, SocialProvider>();
  private defaultsLoaded = false;

  register(provider: SocialProvider) {
    this.providers.set(provider.platform, provider);
    log.debug(`Registered social provider for ${provider.platform}`);
  }

  get(platform: SocialPlatform): SocialProvider {
    this.loadDefaults();
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`No production social publish provider configured for platform: ${platform}`);
    }
    return provider;
  }

  /**
   * The built-in providers load on first use, not at import. Importing the
   * gateway -- which every CLI command does, even --help -- used to construct
   * all four and log a line each before the command printed anything.
   * A provider registered explicitly beforehand is kept, not replaced.
   */
  private loadDefaults() {
    if (this.defaultsLoaded) return;
    this.defaultsLoaded = true;
    for (const provider of [
      new YouTubeProvider(),
      new InstagramProvider(),
      new FacebookProvider(),
      new TikTokProvider(),
    ])
      if (!this.providers.has(provider.platform)) this.register(provider);
  }
}

export const socialProviderRegistry = new SocialProviderRegistry();
