import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env and .env.local files for production server (vite dev loads
// these automatically, but plain node doesn't).
for (const envFile of ['.env.local', '.env']) {
  try {
    const content = readFileSync(resolve(__dirname, '..', envFile), 'utf8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // file doesn't exist — skip
  }
}

// The production server (static files, security headers, Nitro handler)
// lives in serve-production.mjs; this entry only adds the .env loading.
await import('./serve-production.mjs')
