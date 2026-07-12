// Shared MUI theme factory for MarketDesk.
// Produces a professional SaaS control-panel look for both light and dark modes.
// lightTheme.ts / darkTheme.ts wrap this so palettes stay in sync.

import { createTheme } from '@mui/material/styles';
import type { Theme, PaletteOptions } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

const BRAND = {
  main: '#4f46e5',
  light: '#6366f1',
  dark: '#4338ca',
} as const;

const FONT_STACK = [
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(',');

function buildPalette(mode: PaletteMode): PaletteOptions {
  if (mode === 'light') {
    return {
      mode,
      primary: { main: BRAND.main, light: BRAND.light, dark: BRAND.dark, contrastText: '#ffffff' },
      secondary: { main: '#0891b2', light: '#22d3ee', dark: '#0e7490', contrastText: '#ffffff' },
      success: { main: '#16a34a' },
      warning: { main: '#d97706' },
      error: { main: '#dc2626' },
      info: { main: '#0284c7' },
      background: { default: '#f4f5fb', paper: '#ffffff' },
      text: { primary: '#1a1f36', secondary: '#5a6072' },
      divider: 'rgba(15, 23, 42, 0.08)',
    };
  }
  return {
    mode,
    primary: { main: BRAND.light, light: '#818cf8', dark: BRAND.main, contrastText: '#ffffff' },
    secondary: { main: '#22d3ee', light: '#67e8f9', dark: '#0891b2', contrastText: '#04212b' },
    success: { main: '#22c55e' },
    warning: { main: '#f59e0b' },
    error: { main: '#f87171' },
    info: { main: '#38bdf8' },
    background: { default: '#0f1117', paper: '#161923' },
    text: { primary: '#e6e8ef', secondary: '#9aa1b4' },
    divider: 'rgba(255, 255, 255, 0.08)',
  };
}

export function buildTheme(mode: PaletteMode): Theme {
  const isLight = mode === 'light';
  return createTheme({
    palette: buildPalette(mode),
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontWeight: 700, fontSize: '2.25rem', letterSpacing: '-0.02em' },
      h2: { fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.02em' },
      h3: { fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.01em' },
      h4: { fontWeight: 600, fontSize: '1.25rem' },
      h5: { fontWeight: 600, fontSize: '1.125rem' },
      h6: { fontWeight: 600, fontSize: '1rem' },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 600, fontSize: '0.8125rem' },
      button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '::-webkit-scrollbar': { width: 8, height: 8 },
          '::-webkit-scrollbar-thumb': {
            backgroundColor: isLight ? 'rgba(15,23,42,0.25)' : 'rgba(255,255,255,0.25)',
            borderRadius: 8,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 8 } },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            border: `1px solid ${isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.06)'}`,
            boxShadow: isLight
              ? '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)'
              : 'none',
            backgroundImage: 'none',
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }),
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            borderRight: `1px solid ${theme.palette.divider}`,
            backgroundImage: 'none',
          }),
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 8 } } },
    },
  });
}
