import uiReducer, { resolveThemeMode, setThemeMode, shouldResetThemeForPrincipal } from './uiSlice';

describe('theme preference semantics', () => {
  it('resolves system against the browser preference and preserves explicit modes', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('hydrates an explicit persisted server preference into UI state without a write effect', () => {
    const hydrated = uiReducer(undefined, setThemeMode('system'));
    expect(hydrated.themeMode).toBe('system');
  });

  it('requires a neutral reset on login, logout, and principal replacement', () => {
    expect(shouldResetThemeForPrincipal(null, 'workspace:user-a')).toBe(true);
    expect(shouldResetThemeForPrincipal('workspace:user-a', null)).toBe(true);
    expect(shouldResetThemeForPrincipal('workspace:user-a', 'workspace:user-b')).toBe(true);
    expect(shouldResetThemeForPrincipal('workspace:user-a', 'workspace:user-a')).toBe(false);
  });
});
