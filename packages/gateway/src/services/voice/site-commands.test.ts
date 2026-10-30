import { describe, it, expect } from 'vitest';
import { parseSiteCommand } from './site-commands.js';

describe('parseSiteCommand', () => {
  it.each([
    ['Open YouTube.', 'https://www.youtube.com', 'Opening YouTube.'],
    ['Hey Leo, open YouTube', 'https://www.youtube.com', 'Opening YouTube.'],
    ['go to the LinkedIn website', 'https://www.linkedin.com', 'Opening LinkedIn.'],
    ['Please open Google Maps', 'https://www.google.com/maps', 'Opening Google Maps.'],
    ['visit github.com', 'https://github.com', 'Opening github.com.'],
    ['open aqvionlabs dot com', 'https://aqvionlabs.com', 'Opening aqvionlabs.com.'],
    ['Open https://example.org/path', 'https://example.org', 'Opening example.org.'],
  ])('opens a site: %s', (input, url, say) => {
    expect(parseSiteCommand(input)).toEqual({ url, say });
  });

  it('searches Google, encoding the query', () => {
    expect(parseSiteCommand('Search for best pizza & pasta in Lahore?')).toEqual({
      url: 'https://www.google.com/search?q=best%20pizza%20%26%20pasta%20in%20Lahore',
      say: 'Searching Google for best pizza & pasta in Lahore.',
    });
    expect(parseSiteCommand('google weather tomorrow')?.url).toBe(
      'https://www.google.com/search?q=weather%20tomorrow'
    );
  });

  it('searches YouTube for "play … on YouTube"', () => {
    expect(parseSiteCommand('Play lofi beats on YouTube')).toEqual({
      url: 'https://www.youtube.com/results?search_query=lofi%20beats',
      say: 'Searching YouTube for lofi beats.',
    });
  });

  it.each(['What is the weather in Lahore?', 'open my tasks', 'tell me a joke', 'open'])(
    'leaves non-site requests to the AI: %s',
    (input) => {
      expect(parseSiteCommand(input)).toBeNull();
    }
  );

  it('never builds a non-https URL from what was said', () => {
    expect(parseSiteCommand('open javascript:alert(1)')).toBeNull();
    expect(parseSiteCommand('open file:///C:/Windows')).toBeNull();
  });
});
