import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
  },
  build: {
    outDir: 'dist/frontend',
    sourcemap: true,
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          redux: ['redux', '@reduxjs/toolkit', 'react-redux'],
          ui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          query: ['react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@frontend': path.resolve(__dirname, './src/frontend'),
      '@backend': path.resolve(__dirname, './src/backend'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
