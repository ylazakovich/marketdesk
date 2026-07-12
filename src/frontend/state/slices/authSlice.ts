// Auth slice: JWT token, current user, authentication flag.
// Token is persisted to localStorage so sessions survive reloads.
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@shared/types';

const TOKEN_STORAGE_KEY = 'marketdesk.token';

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode / SSR) — ignore.
  }
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
}

const initialToken = readStoredToken();

const initialState: AuthState = {
  token: initialToken,
  user: null,
  isAuthenticated: Boolean(initialToken),
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.isAuthenticated = true;
      persistToken(action.payload.token);
    },
    setUser(state, action: PayloadAction<User | null>) {
      state.user = action.payload;
    },
    logout(state) {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      persistToken(null);
    },
  },
});

export const { setCredentials, setUser, logout } = authSlice.actions;
export default authSlice.reducer;
