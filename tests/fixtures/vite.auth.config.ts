import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), cloudflare({
    configPath: 'tests/fixtures/wrangler.auth.jsonc',
    viteEnvironment: { name: 'worker' },
    persistState: { path: '.wrangler/auth-tests' },
    inspectorPort: false,
  })],
})
