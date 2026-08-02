import { readFileSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import { createServer, request as httpRequest } from 'node:http'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? '31000')
const routesFile =
  process.env.ROUTES_FILE ?? '/opt/sheetbase-preview/routes.json'
const baseDomain = process.env.BASE_DOMAIN ?? 'sheetbase.co.uk'
const routesDirectory = dirname(routesFile)
const routesFilename = basename(routesFile)
const hostnamePattern = new RegExp(
  `^pr-[0-9]+\\.${baseDomain.replaceAll('.', '\\.')}$`,
)

let routes = new Map()

function loadRoutes() {
  try {
    const parsed = JSON.parse(readFileSync(routesFile, 'utf8'))
    if (!Array.isArray(parsed))
      throw new Error('route registry is not an array')
    routes = new Map(
      parsed
        .filter(
          (route) =>
            route &&
            Number.isInteger(route.pullRequestNumber) &&
            route.appPort === 32000 + route.pullRequestNumber &&
            typeof route.hostname === 'string' &&
            hostnamePattern.test(route.hostname) &&
            typeof route.target === 'string' &&
            /^http:\/\/127\.0\.0\.1:\d+$/.test(route.target) &&
            Number(new URL(route.target).port) >= 32001 &&
            Number(new URL(route.target).port) <= 41999,
        )
        .map((route) => [route.hostname, route.target]),
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write(
        `${JSON.stringify({ level: 'warn', message: 'unable to load preview route registry' })}\n`,
      )
    }
    routes = new Map()
  }
}

loadRoutes()
try {
  watch(routesDirectory, { persistent: false }, (_event, filename) => {
    if (!filename || filename.toString() === routesFilename) loadRoutes()
  })
} catch {
  // The controller creates the registry after this process starts.
}

function responseJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer((incoming, outgoing) => {
  const requestHost = String(incoming.headers.host ?? '')
    .split(':')[0]
    .toLowerCase()
  if (!hostnamePattern.test(requestHost)) {
    responseJson(outgoing, 404, { error: 'unknown_preview_host' })
    return
  }

  const target = routes.get(requestHost)
  if (!target) {
    responseJson(outgoing, 404, { error: 'preview_not_found' })
    return
  }

  const requestPath = incoming.url ?? '/'
  if (!requestPath.startsWith('/') || requestPath.startsWith('//')) {
    responseJson(outgoing, 400, { error: 'invalid_preview_request' })
    return
  }
  const targetUrl = new URL(requestPath, target)
  const headers = { ...incoming.headers }
  headers.host = targetUrl.host
  headers['x-forwarded-host'] = requestHost
  headers['x-forwarded-proto'] = 'https'
  delete headers.connection

  const upstream = httpRequest(
    targetUrl,
    { method: incoming.method, headers },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(outgoing)
    },
  )
  upstream.on('error', () => {
    if (!outgoing.headersSent) {
      responseJson(outgoing, 502, { error: 'preview_unavailable' })
    } else {
      outgoing.destroy()
    }
  })
  incoming.pipe(upstream)
})

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ message: 'preview router listening', host, port, routesFile })}\n`,
  )
})
