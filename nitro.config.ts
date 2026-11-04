import { defineConfig } from 'nitro'
import evlog from 'evlog/nitro/v3'

export default defineConfig({
  // Emit a web-standard fetch handler so scripts/serve-production.mjs keeps
  // owning the HTTP server, static files, security headers and readiness check.
  preset: 'standard',
  experimental: { asyncContext: true },
  // Write .br and .gz copies of the public assets at build time, which
  // scripts/serve-production.mjs serves to browsers that accept them. Without
  // them every cold page load moved ~3.3 MB of uncompressed JavaScript.
  compressPublicAssets: { gzip: true, brotli: true },
  modules: [evlog()],
})
