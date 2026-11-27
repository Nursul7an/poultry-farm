import { defineConfig, devices } from '@playwright/test';

// Runs against the production build (service worker included) in demo mode.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'off', locale: 'ru-RU' },
  webServer: { command: 'npx vite build --mode e2e && npx vite preview --port 4173 --strictPort' /* --mode e2e: never .env.production, always demo backend */, url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: 'android-phone', use: { ...devices['Pixel 5'] } }],
});
