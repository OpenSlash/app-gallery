import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL },
  projects: [
    { name: 'chromium', testIgnore: '**/auth.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'password-auth', testMatch: '**/auth.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4179' } },
  ],
  webServer: [{
    command: 'pnpm db:local && pnpm dev --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 60_000,
  }, {
    command: 'pnpm exec wrangler d1 migrations apply DB --local --config tests/fixtures/wrangler.auth.jsonc --persist-to .wrangler/auth-tests && pnpm dev --config tests/fixtures/vite.auth.config.ts --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60_000,
  }],
})
