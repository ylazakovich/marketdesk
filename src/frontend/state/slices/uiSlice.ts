// UI slice: theme mode, sidebar layout state, and the toast/notification queue.
import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'light' | 'dark';
export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  autoHideMs: number;
}

const THEME_STORAGE_KEY = 'marketdesk.themeMode';

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'light';
}

function persistTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export interface UiState {
  themeMode: ThemeMode;
  // Desktop: mini/expanded sidebar. Mobile: temporary drawer open/closed.
  sidebarCollapsed: boolean;
  sidebarMobileOpen: boolean;
  toasts: Toast[];
}

const initialState: UiState = {
  themeMode: readStoredTheme(),
  sidebarCollapsed: false,
  sidebarMobileOpen: false,
  toasts: [],
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleTheme(state) {
      state.themeMode = state.themeMode === 'light' ? 'dark' : 'light';
      persistTheme(state.themeMode);
    },
    setThemeMode(state, action: PayloadAction<ThemeMode>) {
      state.themeMode = action.payload;
      persistTheme(state.themeMode);
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.sidebarCollapsed = action.payload;
    },
    toggleMobileSidebar(state) {
      state.sidebarMobileOpen = !state.sidebarMobileOpen;
    },
    setMobileSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarMobileOpen = action.payload;
    },
    enqueueToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts.push(action.payload);
      },
      prepare(input: { message: string; severity?: ToastSeverity; autoHideMs?: number }) {
        return {
          payload: {
            id: nanoid(),
            message: input.message,
            severity: input.severity ?? 'info',
            autoHideMs: input.autoHideMs ?? 5000,
          },
        };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    clearToasts(state) {
      state.toasts = [];
    },
  },
});

export const {
  toggleTheme,
  setThemeMode,
  toggleSidebar,
  setSidebarCollapsed,
  toggleMobileSidebar,
  setMobileSidebarOpen,
  enqueueToast,
  dismissToast,
  clearToasts,
} = uiSlice.actions;

export default uiSlice.reducer;
