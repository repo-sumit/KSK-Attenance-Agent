import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
    // A fake camera (moving test pattern, no face) that never shows a prompt: camera.spec.ts uses the real
    // getUserMedia path with it; every other spec runs on the demo's simulated camera.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [
    {
      name: 'android-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    // Always the on-device mock (D-143), even when an env file names a Supabase project.
    command: `NEXT_PUBLIC_DATA_SOURCE=mock npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
