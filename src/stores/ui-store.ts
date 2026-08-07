import { create } from 'zustand';
import type { SupportedLanguage } from '../shared/i18n';

export type Page = 'home' | 'event-viewer' | 'trace-viewer' | 'validator' | 'heap-analyzer' | 'report' | 'cpu-profiler' | 'heap-diff' | 'search-filter' | 'time-series' | 'perf-compare' | 'tutorial' | 'memory-timeline' | 'gc-log' | 'live-monitor' | 'snapshot-history' | 'alert-rules' | 'ai-rca' | 'topology' | 'differential-debug' | 'jit-insights' | 'cpu-profile-diff' | 'source-attribution' | 'otel-ingest' | 'report-diff' | 'ci-baseline' | 'repro-generator';

interface UIState {
  currentPage: Page;
  navigate: (page: Page) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  toggleLanguage: () => void;
}

function getInitialDarkMode(): boolean {
  try {
    const stored = localStorage.getItem('nodeverdict-darkmode');
    if (stored !== null) return stored === 'true';
  } catch {}

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem('nodeverdict-language');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {}
  return 'zh';
}

function applyThemePreference(darkMode: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', darkMode);
}

function applyLanguagePreference(language: SupportedLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
}

function persistDarkMode(darkMode: boolean): void {
  try { localStorage.setItem('nodeverdict-darkmode', String(darkMode)); } catch {}
}

function persistLanguage(language: SupportedLanguage): void {
  try { localStorage.setItem('nodeverdict-language', language); } catch {}
}

export const useUIStore = create<UIState>((set) => ({
  currentPage: 'home',
  navigate: (page) => set({ currentPage: page }),
  loading: false,
  setLoading: (loading) => set({ loading }),
  error: null,
  setError: (error) => set({ error }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  darkMode: getInitialDarkMode(),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode;
    persistDarkMode(next);
    applyThemePreference(next);
    return { darkMode: next };
  }),
  language: getInitialLanguage(),
  setLanguage: (lang) => set(() => {
    persistLanguage(lang);
    applyLanguagePreference(lang);
    return { language: lang };
  }),
  toggleLanguage: () => set((s) => {
    const next: SupportedLanguage = s.language === 'zh' ? 'en' : 'zh';
    persistLanguage(next);
    applyLanguagePreference(next);
    return { language: next };
  }),
}));

applyThemePreference(useUIStore.getState().darkMode);
applyLanguagePreference(useUIStore.getState().language);