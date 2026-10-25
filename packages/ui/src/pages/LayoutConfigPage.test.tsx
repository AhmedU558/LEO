// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render, cleanup, hasText } from '../test-harness';
import { ThemeProvider } from '../hooks/useTheme';
import { DEFAULT_LAYOUT_CONFIG } from '../types/layout-config';
import { LayoutConfigPage } from './LayoutConfigPage';

vi.mock('../components/icons', async () => {
  const { createIconStubs } = await import('../test-harness');
  return createIconStubs();
});
vi.mock('../components/LayoutWireframe', () => ({ LayoutWireframe: () => null }));
vi.mock('../components/ZoneEditor', () => ({ ZoneEditor: () => null }));
vi.mock('../hooks/useLayoutConfig', () => ({
  useLayoutConfig: () => ({
    config: DEFAULT_LAYOUT_CONFIG,
    setConfig: vi.fn(),
    addCustomGroup: vi.fn(),
    removeCustomGroup: vi.fn(),
  }),
}));

describe('LayoutConfigPage theme selector', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });
  afterEach(cleanup);

  it('offers JARVIS first, selected by default, and switches themes', () => {
    const container = render(
      <ThemeProvider>
        <LayoutConfigPage />
      </ThemeProvider>
    );
    expect(hasText(container, 'Layout Configuration')).toBe(true);

    const buttons = [...container.querySelectorAll('button')];
    const jarvis = buttons.find((b) => b.textContent === 'JARVIS')!;
    const light = buttons.find((b) => b.textContent === 'Light')!;
    expect(jarvis.className).toContain('bg-primary');

    act(() => light.click());
    expect(document.documentElement.classList.contains('jarvis')).toBe(false);
    act(() => jarvis.click());
    expect(document.documentElement.classList.contains('jarvis')).toBe(true);
  });
});
