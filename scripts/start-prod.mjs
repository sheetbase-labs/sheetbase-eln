import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(__dirname, '..', 'dist', 'client')

const MIME = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

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

const serverModule = await import(resolve(__dirname, '..', 'dist', 'server', 'server.js'))
const handler = serverModule.default

const port = Number(process.env.PORT) || 3000
const hostname = process.env.HOST || '0.0.0.0'

// Serve hashed static assets from dist/client (CSS, JS chunks, fonts, etc.)
// before falling through to the SSR handler. Prevents path traversal.
function tryServeStatic(req, res, url) {
  let pathname = url.pathname
  // Only serve files under known static prefixes to avoid shadowing routes.
  if (
    !pathname.startsWith('/assets/') &&
    !pathname.startsWith('/favicon') &&
    !pathname.endsWith('.ico')
  ) {
    return false
  }
  const safePath = join(clientDir, pathname)
  if (!safePath.startsWith(clientDir)) return false
  let stats
  try {
    stats = statSync(safePath)
  } catch {
    return false
  }
  if (!stats.isFile()) return false
  res.writeHead(200, {
    'Content-Type': MIME[extname(safePath)] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': stats.size,
  })
  createReadStream(safePath).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${hostname}:${port}`)

    // Serve static client assets first.
    if (tryServeStatic(req, res, url)) return
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v)
      } else if (value != null) {
        headers.set(key, value)
      }
    }
    const init = {
      method: req.method,
      headers,
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      init.body = Buffer.concat(chunks)
    }
    const request = new Request(url, init)
    const response = await handler.fetch(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err) {
    console.error('Server error:', err)
    res.writeHead(500)
    res.end('Internal Server Error')
  }
})

server.listen(port, hostname, () => {
  console.log(`Production server running at http://${hostname}:${port}`)
})
