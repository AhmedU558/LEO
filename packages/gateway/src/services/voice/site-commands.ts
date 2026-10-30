/**
 * Voice/typed site commands for the local voice pipeline: "open YouTube",
 * "go to github.com", "search for …", "play … on YouTube".
 *
 * Matched before the local model runs, so these are instant and don't depend
 * on a 4B model calling tools. Only URLs built here are ever opened.
 */

export interface SiteCommand {
  url: string;
  /** What LEO says back. */
  say: string;
}

/** Spoken site names → URLs. Keys are lowercase, spaces removed. */
const SITES: Record<string, [name: string, url: string]> = {
  youtube: ['YouTube', 'https://www.youtube.com'],
  google: ['Google', 'https://www.google.com'],
  gmail: ['Gmail', 'https://mail.google.com'],
  googlemaps: ['Google Maps', 'https://www.google.com/maps'],
  maps: ['Google Maps', 'https://www.google.com/maps'],
  googledrive: ['Google Drive', 'https://drive.google.com'],
  drive: ['Google Drive', 'https://drive.google.com'],
  github: ['GitHub', 'https://github.com'],
  linkedin: ['LinkedIn', 'https://www.linkedin.com'],
  facebook: ['Facebook', 'https://www.facebook.com'],
  instagram: ['Instagram', 'https://www.instagram.com'],
  twitter: ['X', 'https://x.com'],
  x: ['X', 'https://x.com'],
  whatsapp: ['WhatsApp', 'https://web.whatsapp.com'],
  reddit: ['Reddit', 'https://www.reddit.com'],
  wikipedia: ['Wikipedia', 'https://www.wikipedia.org'],
  netflix: ['Netflix', 'https://www.netflix.com'],
  spotify: ['Spotify', 'https://open.spotify.com'],
  amazon: ['Amazon', 'https://www.amazon.com'],
  chatgpt: ['ChatGPT', 'https://chatgpt.com'],
  claude: ['Claude', 'https://claude.ai'],
  upwork: ['Upwork', 'https://www.upwork.com'],
  fiverr: ['Fiverr', 'https://www.fiverr.com'],
  stackoverflow: ['Stack Overflow', 'https://stackoverflow.com'],
};

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

const search = (engine: 'google' | 'youtube', query: string): SiteCommand =>
  engine === 'youtube'
    ? {
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        say: `Searching YouTube for ${query}.`,
      }
    : {
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        say: `Searching Google for ${query}.`,
      };

export function parseSiteCommand(input: string): SiteCommand | null {
  const text = input
    .trim()
    .replace(/^(?:hey|ok|okay)?,?\s*leo\b[,.!]?\s*/i, '')
    .replace(/^(?:please|can you|could you)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/\s+please$/i, '')
    .trim();

  const youtube = text.match(/^(?:play|search(?: for)?|find)\s+(.+?)\s+on\s+youtube$/i);
  if (youtube?.[1]) return search('youtube', youtube[1]);

  const google = text.match(/^(?:search(?: google)?(?: for)?|google|look up)\s+(.+)$/i);
  if (google?.[1]) return search('google', google[1]);

  const open = text.match(/^(?:open|launch|go to|visit|take me to|show me|pull up)\s+(.+)$/i);
  if (!open?.[1]) return null;
  const target = open[1]
    .toLowerCase()
    .replace(/^(?:the|my)\s+/, '')
    .replace(/\s+(?:website|web site|site|page|app)$/, '')
    .replace(/\s+dot\s+/g, '.')
    .trim();

  const known = SITES[target.replace(/\s+/g, '')];
  if (known) return { url: known[1], say: `Opening ${known[0]}.` };

  const domain = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (DOMAIN.test(domain)) return { url: `https://${domain}`, say: `Opening ${domain}.` };

  // "open my tasks", "open the pod bay doors": not a site — leave it to the AI.
  return null;
}
