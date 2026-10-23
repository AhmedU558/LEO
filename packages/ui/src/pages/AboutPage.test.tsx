// @vitest-environment happy-dom

/**
 * AboutPage smoke test.
 *
 * The page is static, so there are no data calls to exercise. What it must get
 * right is identity: it presents LEO, loads LEO's logo, links LEO's repository,
 * and credits OwnPilot as the project LEO is built on rather than presenting
 * OwnPilot's author as LEO's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, hasText, render } from '../test-harness';
import { AboutPage } from './AboutPage';

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});

describe('AboutPage', () => {
  afterEach(() => cleanup());

  it('presents LEO with its name, expansion and logo', () => {
    const page = render(<AboutPage />);
    expect(page.querySelector('h1')?.textContent).toBe('LEO');
    expect(hasText(page, 'Logical Execution & Orchestration')).toBe(true);
    expect(hasText(page, 'understands, plans, authorizes, executes')).toBe(true);
    const logo = page.querySelector('img');
    // The PWA icon and this page share the same asset; a stale path is a broken image.
    expect(logo?.getAttribute('src')).toBe('/leo-logo.png');
    expect(logo?.getAttribute('alt')).toBe('LEO Logo');
  });

  it("links LEO's own repository, not the upstream project's", () => {
    const page = render(<AboutPage />);
    const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/AhmedU558/LEO');
    expect(hrefs).not.toContain('https://ownpilot.dev');
  });

  it('credits OwnPilot and its author as the base project', () => {
    const page = render(<AboutPage />);
    expect(hasText(page, 'Built on OwnPilot')).toBe(true);
    expect(hasText(page, 'Ersin KO')).toBe(true);
    // The upstream author is credited for OwnPilot, never as LEO's creator.
    expect(hasText(page, 'Created by')).toBe(false);
    const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/ownpilot/ownpilot');
  });
});
