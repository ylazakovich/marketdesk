// Workspace slice: the active workspace context (currency, timezone, autonomy).
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AutonomyLevel } from '@shared/types';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, AUTONOMY_LEVELS } from '@shared/constants';

export interface WorkspaceState {
  id: string | null;
  name: string;
  currency: string;
  timezone: string;
  autonomyLevel: AutonomyLevel;
}

const initialState: WorkspaceState = {
  id: null,
  name: '',
  currency: DEFAULT_CURRENCY,
  timezone: DEFAULT_TIMEZONE,
  autonomyLevel: AUTONOMY_LEVELS.SUGGEST_ONLY,
};

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState,
  reducers: {
    setWorkspace(_state, action: PayloadAction<WorkspaceState>) {
      return action.payload;
    },
    setAutonomyLevel(state, action: PayloadAction<AutonomyLevel>) {
      state.autonomyLevel = action.payload;
    },
    clearWorkspace() {
      return initialState;
    },
  },
});

export const { setWorkspace, setAutonomyLevel, clearWorkspace } = workspaceSlice.actions;
export default workspaceSlice.reducer;
