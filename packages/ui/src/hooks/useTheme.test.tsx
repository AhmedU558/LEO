// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { render, cleanup } from '../test-harness';
import { ThemeProvider, useTheme, type Theme } from './useTheme';

let api: ReturnType<typeof useTheme>;
function Probe() {
  api = useTheme();
  return null;
}

const mount = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );

const classes = () => [...document.documentElement.classList].sort();

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });
  afterEach(cleanup);

  it('defaults to the JARVIS theme when nothing is saved', () => {
    mount();
    expect(api.theme).toBe('jarvis');
    expect(api.resolvedTheme).toBe('jarvis');
    expect(classes()).toEqual(['jarvis']);
  });

  it('keeps an explicit saved choice', () => {
    localStorage.setItem('theme', 'claude');
    mount();
    expect(api.theme).toBe('claude');
    expect(classes()).toEqual(['claude']);
  });

  it('ignores an unknown saved value', () => {
    localStorage.setItem('theme', 'neon');
    mount();
    expect(api.theme).toBe('jarvis');
  });

  it.each<[Theme, string[]]>([
    ['light', []],
    ['dark', ['dark']],
    ['jarvis', ['jarvis']],
  ])('switching to %s applies exactly its class and persists it', (theme, expected) => {
    localStorage.setItem('theme', 'claude');
    mount();
    act(() => api.setTheme(theme));
    expect(classes()).toEqual(expected);
    expect(localStorage.getItem('theme')).toBe(theme);
  });
});
