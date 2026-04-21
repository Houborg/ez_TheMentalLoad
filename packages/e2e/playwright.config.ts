import { defineConfig } from '@playwright/test';

const backendPort = 3001;
const frontendPort = 4174;

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
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
      command: `set "BACKEND_URL=http://127.0.0.1:${backendPort}" && set "NEXT_PUBLIC_WS_URL=ws://127.0.0.1:${backendPort}/ws" && npx next dev packages/frontend --hostname 127.0.0.1 --port ${frontendPort}`,
      port: frontendPort,
      reuseExistingServer: true,
      timeout: 120000,
      cwd: '../..',
    },
  ],
});
