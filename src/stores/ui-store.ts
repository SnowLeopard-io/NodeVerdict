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
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem('nodeverdict-language');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {}
  return 'zh';
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
    try { localStorage.setItem('nodeverdict-darkmode', String(next)); } catch {}
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return { darkMode: next };
  }),
  language: getInitialLanguage(),
  setLanguage: (lang) => set((s) => {
    try { localStorage.setItem('nodeverdict-language', lang); } catch {}
    return { language: lang };
  }),
  toggleLanguage: () => set((s) => {
    const next: SupportedLanguage = s.language === 'zh' ? 'en' : 'zh';
    try { localStorage.setItem('nodeverdict-language', next); } catch {}
    return { language: next };
  }),
}));