import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { constants as zlib, createBrotliCompress, createGzip } from 'node:zlib'
import { extname, resolve, sep } from 'node:path'

import application from '../.output/server/index.mjs'
import { acceptsEncoding } from './lib/accept-encoding.mjs'
import { dynamicEncoding } from './lib/compress-response.mjs'
import { applyProductionSecurityHeaders } from './lib/security-headers.mjs'
import { createCollabHost } from './lib/collab-host.mjs'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? '3000')
const staticRoot = resolve('.output/public')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

function writeLog(level, message, fields = {}) {
  const stream =
    level === 'error' || level === 'warn' ? process.stderr : process.stdout

  stream.write(
    `${JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...fields })}\n`,
  )
}

async function assertStartupReady() {
  if (process.env.NODE_ENV !== 'production') return

  const isAuthFreeDevelopment =
    process.env.SHEETBASE_ENV === 'development' &&
    process.env.SHEETBASE_DEV_AUTH_FREE === 'true'

  if (
    !['staging', 'production'].includes(process.env.SHEETBASE_ENV) &&
    !isAuthFreeDevelopment
  ) {
    throw new Error(
      'production startup requires SHEETBASE_ENV=staging or production, or explicit auth-free development mode',
    )
  }

  const response = await application.fetch(
    new Request(`http://${host}:${port}/api/health/ready`),
  )

  if (!response.ok) {
    throw new Error('deployment readiness validation failed before startup')
  }
}

/**
 * The build writes `.br` and `.gz` copies beside each public asset (Nitro's
 * compressPublicAssets). Serve the smallest one the browser accepts, falling
 * back to the original file.
 */
async function pickEncoding(candidate, acceptEncoding) {
  for (const [token, suffix] of [
    ['br', '.br'],
    ['gzip', '.gz'],
  ]) {
    if (!acceptsEncoding(acceptEncoding, token)) continue

    try {
      const details = await stat(candidate + suffix)

      if (details.isFile()) return { path: candidate + suffix, token, details }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
  }

  return null
}

async function serveStatic(pathname, response, headOnly, acceptEncoding = '') {
  const candidate = resolve(staticRoot, `.${pathname}`)

  if (
    candidate !== staticRoot &&
    !candidate.startsWith(`${staticRoot}${sep}`)
  ) {
    return false
  }

  try {
    const details = await stat(candidate)

    if (!details.isFile()) return false
    const encoded = await pickEncoding(candidate, acceptEncoding)
    response.statusCode = 200
    applyProductionSecurityHeaders(response)
    response.setHeader(
      'content-type',
      contentTypes.get(extname(candidate)) ?? 'application/octet-stream',
    )
    // Every asset may have encoded copies, so caches key on the encoding.
    response.setHeader('vary', 'accept-encoding')

    if (encoded) response.setHeader('content-encoding', encoded.token)
    response.setHeader('content-length', (encoded?.details ?? details).size)
    response.setHeader(
      'cache-control',
      pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : pathname === '/sw.js'
          ? 'no-cache'
          : 'public, max-age=300',
    )

    if (headOnly) response.end()
    else createReadStream(encoded?.path ?? candidate).pipe(response)

    return true
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    // Behind a hosting proxy the public scheme arrives in x-forwarded-proto;
    // without it the app would believe it is served over plain http and
    // reject its own same-origin requests.
    const forwardedProto = String(incoming.headers['x-forwarded-proto'] ?? '')
      .split(',')[0]
      .trim()

    const scheme = forwardedProto === 'https' ? 'https' : 'http'
    const origin = `${scheme}://${incoming.headers.host ?? `${host}:${port}`}`
    const url = new URL(incoming.url ?? '/', origin)

    if (
      (incoming.method === 'GET' || incoming.method === 'HEAD') &&
      (await serveStatic(
        url.pathname,
        outgoing,
        incoming.method === 'HEAD',
        String(incoming.headers['accept-encoding'] ?? ''),
      ))
    ) {
      return
    }

    const init = {
      method: incoming.method,
      headers: incoming.headers,
    }

    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      init.body = Readable.toWeb(incoming)
      init.duplex = 'half'
    }

    const response = await application.fetch(new Request(url, init))
    outgoing.statusCode = response.status

    for (const [name, value] of response.headers)
      outgoing.setHeader(name, value)
    const cookies = response.headers.getSetCookie?.()

    if (cookies?.length) outgoing.setHeader('set-cookie', cookies)

    if (!response.body || incoming.method === 'HEAD') {
      outgoing.end()

      return
    }

    // Pages and API JSON are generated per request, so they are compressed
    // here (5-8x smaller); live event streams and files pass through as is.
    const encoding = dynamicEncoding({
      contentType: response.headers.get('content-type'),
      contentEncoding: response.headers.get('content-encoding'),
      contentLength: response.headers.get('content-length'),
      acceptEncoding: String(incoming.headers['accept-encoding'] ?? ''),
    })

    const vary = response.headers.get('vary')
    outgoing.setHeader(
      'vary',
      vary && !/accept-encoding/i.test(vary)
        ? `${vary}, accept-encoding`
        : (vary ?? 'accept-encoding'),
    )

    if (!encoding) {
      Readable.fromWeb(response.body).pipe(outgoing)

      return
    }

    outgoing.removeHeader('content-length')
    outgoing.setHeader('content-encoding', encoding)

    const compressor =
      encoding === 'br'
        ? // A fast Brotli level: per-request bodies trade a little size for
          // latency, unlike the build's maximum-level static copies.
          createBrotliCompress({
            params: { [zlib.BROTLI_PARAM_QUALITY]: 4 },
          })
        : createGzip()

    Readable.fromWeb(response.body).pipe(compressor).pipe(outgoing)
  } catch (error) {
    writeLog('error', 'production request failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })

    if (!outgoing.headersSent) {
      outgoing.statusCode = 500
      applyProductionSecurityHeaders(outgoing)
      outgoing.setHeader('content-type', 'application/json')
    }

    outgoing.end(JSON.stringify({ error: { category: 'server_error' } }))
  }
})

// Live co-editing: the bundled WebSocket server shares this process and this
// port, so it needs nothing extra to deploy. Other upgrade requests are not
// ours and are closed.
const collab = createCollabHost({
  fetchApp: (request) => application.fetch(request),
  log: writeLog,
})

globalThis.__sheetbaseCollab = collab

server.on('upgrade', (request, socket, head) => {
  if (!collab.handleUpgrade(request, socket, head)) socket.destroy()
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    collab.close()
    server.close()
    process.exit(0)
  })
}

// A dropped database connection or a rejected background promise should be
// logged, not take the whole server (and everyone's session) down with it.
process.on('unhandledRejection', (reason) => {
  writeLog('error', 'unhandled rejection', {
    errorType: reason instanceof Error ? reason.name : 'NonErrorRejection',
    message: reason instanceof Error ? reason.message : String(reason),
  })
})

process.on('uncaughtException', (cause) => {
  const error = cause instanceof Error ? cause : new Error(String(cause))

  const recoverable =
    ['57P01', '53300', '08006', '08003', 'ECONNRESET', 'ETIMEDOUT'].includes(
      error.code,
    ) || /too many clients|Connection terminated/i.test(error.message)

  writeLog('error', 'uncaught exception', {
    errorType: error.name,
    message: error.message,
    recoverable,
  })

  if (!recoverable) process.exit(1)
})

await assertStartupReady()

server.listen(port, host, () => {
  writeLog('info', 'server listening', { host, port })
})
