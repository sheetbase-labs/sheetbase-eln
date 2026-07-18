import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const staticRoot = process.env.STATIC_ROOT || 'storybook-static'
const root = resolve(process.cwd(), staticRoot)
const port = Number(process.env.PORT || 6006)
const host = process.env.HOST || '127.0.0.1'

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const server = http.createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || host}`)
    const decoded = decodeURIComponent(requestUrl.pathname)
    const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
    let filePath = resolve(join(root, safePath))

    if (!filePath.startsWith(root)) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = join(root, 'index.html')
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream',
    })
    createReadStream(filePath).pipe(response)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : 'Server error')
  }
})

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Close the other server and run this launcher again.`)
  } else {
    console.error(error)
  }
  process.exit(1)
})

server.listen(port, host, () => {
  console.log(`Storybook component workbench: http://${host}:${port}`)
  console.log('Keep this Terminal window open. Press Control+C to stop.')
})
