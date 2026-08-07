// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest';
import { useUIStore } from '../src/stores/ui-store';

describe('UI state initialization', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('lang');
    useUIStore.setState({ darkMode: false, language: 'zh', sidebarOpen: true, currentPage: 'home' });
  });

  it('initializes safely in non-browser environments', () => {
    const state = useUIStore.getState();

    expect(state.darkMode).toBe(false);
    expect(state.language).toBe('zh');
    expect(state.sidebarOpen).toBe(true);
  });

  it('keeps the document in sync with language and theme changes', () => {
    useUIStore.getState().setLanguage('en');
    expect(document.documentElement.lang).toBe('en');

    useUIStore.getState().toggleDarkMode();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
