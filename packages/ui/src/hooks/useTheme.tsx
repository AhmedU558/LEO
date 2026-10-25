import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

export type Theme = 'system' | 'light' | 'dark' | 'claude' | 'jarvis';
type ResolvedTheme = Exclude<Theme, 'system'>;

/** LEO's signature look; used until the user picks another theme. */
export const DEFAULT_THEME: Theme = 'jarvis';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme; // The actual applied theme
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const THEME_CLASSES = ['dark', 'claude', 'jarvis'] as const;

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readSavedTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEYS.THEME);
  return saved === 'system' ||
    saved === 'light' ||
    saved === 'dark' ||
    saved === 'claude' ||
    saved === 'jarvis'
    ? saved
    : DEFAULT_THEME;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove(...THEME_CLASSES);
  if (theme !== 'light') root.classList.add(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === 'undefined' ? DEFAULT_THEME : readSavedTheme()
  );

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = readSavedTheme();
    return saved === 'system' ? getSystemTheme() : saved;
  });

  // Apply theme on mount and when theme changes
  useEffect(() => {
    const resolved: ResolvedTheme = theme === 'system' ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      const resolved = e.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
