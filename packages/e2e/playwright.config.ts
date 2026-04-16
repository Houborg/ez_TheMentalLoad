import { defineConfig } from '@playwright/test';

const backendPort = 3001;
const frontendPort = 4174;

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    headless: true,
  },
  webServer: [
    {
      command: `set PORT=${backendPort} && npm --workspace @mental-load/backend run dev`,
      port: backendPort,
      reuseExistingServer: true,
      timeout: 120000,
      cwd: '../..',
    },
    {
      command: `set FRONTEND_PORT=${frontendPort} && set VITE_BACKEND_URL=http://127.0.0.1:${backendPort} && npm --workspace @mental-load/frontend run dev -- --host 127.0.0.1`,
      port: frontendPort,
      reuseExistingServer: true,
      timeout: 120000,
      cwd: '../..',
    },
  ],
});
