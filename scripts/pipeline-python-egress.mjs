/**
 * Allow-listing egress proxy for plugin Python.
 *
 * A plugin's code runs in a container with no route to anywhere. When an
 * administrator approved hosts for a plugin, the runner puts that one
 * container on a private Docker network whose only other member is the runner
 * itself, and points the container's HTTP(S) proxy settings here. This proxy
 * then connects only to the approved host names:
 *
 * - each call gets its own credential, valid for that call only, tied to the
 *   hosts approved for that plugin;
 * - `CONNECT host:port` (HTTPS) and plain `http://` requests are both handled;
 * - the name is resolved here and the connection goes to the address that was
 *   checked, so a name that changes its answer between check and connect
 *   cannot reach somewhere else;
 * - an address inside the lab's own network (loopback, private ranges,
 *   link-local, the cloud metadata address) is refused unless the operator
 *   set PIPELINE_PYTHON_EGRESS_ALLOW_PRIVATE=1 for a plugin that has to reach
 *   an on-site service.
 *
 * Any port on an approved host is allowed: the approval is of the host.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createServer, request as httpRequest } from 'node:http'
import { connect, isIP } from 'node:net'

/** Mirrors `hostAllowed` in src/lib/extensions/runtime-config.ts. */
export function hostAllowed(allowed, host) {
  const name = String(host).toLowerCase().replace(/\.$/, '')
  return allowed.some((entry) =>
    entry.startsWith('*.')
      ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1
      : name === entry,
  )
}

/** Whether an address belongs to the lab's own network rather than the internet. */
export function isPrivateAddress(address) {
  const kind = isIP(address)
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (kind === 6) {
    const lower = address.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPrivateAddress(mapped[1])
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower)
    )
  }
  return true
}

const safeEqual = (a, b) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * The proxy. `register(hosts)` returns a credential for one call; `release()`
 * revokes it and closes whatever that call still has open.
 */
export function createEgressProxy({
  allowPrivate = false,
  resolve = (host) => lookup(host, { all: true }),
} = {}) {
  /** token -> { hosts, sockets } */
  const grants = new Map()

  const grantFor = (header) => {
    if (typeof header !== 'string' || !header.startsWith('Basic ')) return null
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const token = decoded.split(':').slice(1).join(':')
    for (const [known, grant] of grants)
      if (safeEqual(known, token)) return grant
    return null
  }

  /** The address to connect to for `host`, or why not. */
  async function target(grant, host) {
    if (!hostAllowed(grant.hosts, host)) return { error: 'host_not_approved' }
    let addresses
    try {
      addresses = isIP(host) ? [{ address: host }] : await resolve(host)
    } catch {
      return { error: 'not_found' }
    }
    if (addresses.length === 0) return { error: 'not_found' }
    if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address)))
      return { error: 'private_address' }
    return { address: addresses[0].address }
  }

  const refuse = (socket, status, text) => {
    if (socket.writable)
      socket.end(
        `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      )
  }

  const server = createServer((request, response) => {
    // Plain http:// through the proxy: the request line carries the full URL.
    const grant = grantFor(request.headers['proxy-authorization'])
    if (!grant) {
      response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="plugin"' })
      return response.end()
    }
    let url
    try {
      url = new URL(request.url)
      if (url.protocol !== 'http:') throw new Error('not http')
    } catch {
      response.writeHead(400)
      return response.end()
    }
    void target(grant, url.hostname).then((found) => {
      if (found.error) {
        response.writeHead(found.error === 'not_found' ? 502 : 403)
        return response.end(
          found.error === 'host_not_approved'
            ? 'This plugin is not approved to reach that host.'
            : '',
        )
      }
      const headers = { ...request.headers }
      delete headers['proxy-authorization']
      delete headers['proxy-connection']
      const upstream = httpRequest(
        {
          host: found.address,
          port: url.port || 80,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: { ...headers, host: url.host },
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers)
          answer.pipe(response)
        },
      )
      grant.sockets.add(upstream)
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      request.pipe(upstream)
    })
  })

  server.on('connect', (request, client, head) => {
    const grant = grantFor(request.headers['proxy-authorization'])
    if (!grant) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="plugin"\r\nContent-Length: 0\r\n\r\n',
      )
      return
    }
    const match = /^(.+):(\d{1,5})$/.exec(request.url ?? '')
    if (!match) return refuse(client, 400, 'Bad Request')
    const [, rawHost, port] = match
    const host = rawHost.replace(/^\[|\]$/g, '')
    void target(grant, host).then((found) => {
      if (found.error)
        return refuse(
          client,
          found.error === 'not_found' ? 502 : 403,
          found.error === 'not_found' ? 'Bad Gateway' : 'Forbidden',
        )
      const upstream = connect(Number(port), found.address, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      grant.sockets.add(client)
      grant.sockets.add(upstream)
      const close = () => {
        upstream.destroy()
        client.destroy()
      }
      upstream.on('error', () => {
        if (client.writable && !client.destroyed && upstream.connecting)
          refuse(client, 502, 'Bad Gateway')
        close()
      })
      client.on('error', close)
      client.on('close', close)
    })
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  return {
    server,
    /** A credential for one call to reach `hosts`; `release` ends it. */
    register(hosts) {
      const token = randomBytes(24).toString('hex')
      const grant = { hosts: [...hosts], sockets: new Set() }
      grants.set(token, grant)
      return {
        token,
        release() {
          grants.delete(token)
          for (const socket of grant.sockets) socket.destroy()
          grant.sockets.clear()
        },
      }
    },
    get activeGrants() {
      return grants.size
    },
  }
}
