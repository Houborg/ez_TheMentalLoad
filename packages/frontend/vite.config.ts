import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const backendUrl = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:3000';
const websocketUrl = backendUrl.replace(/^http/, 'ws');
const frontendPort = Number(process.env.FRONTEND_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mental-load/contracts': path.resolve(__dirname, '../contracts/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    proxy: {
      '/api': backendUrl,
      '/ws': {
        target: websocketUrl,
        ws: true,
      },
    },
  },
});
