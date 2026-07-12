import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './api/baseApi.js';
import authReducer from './slices/authSlice.js';
import workspaceReducer from './slices/workspaceSlice.js';
import uiReducer from './slices/uiSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    workspace: workspaceReducer,
    ui: uiReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['hydrate'],
        ignoredPaths: [],
      },
    }).concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
