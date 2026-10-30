import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  // Emit a web-standard fetch handler so scripts/serve-production.mjs keeps
  // owning the HTTP server, static files, security headers and readiness check.
  preset: 'standard',
  experimental: { asyncContext: true },
  modules: [evlog()],
})
