import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request } from 'node:https'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')

export function isPublicWebhookAddress(address: string): boolean {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4')
  if (isIP(address) === 6)
    return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
  return false
}

/** Resolve once, reject private answers, and pin the socket to that validated address. */
export async function resolveWebhookHost(host: string) {
  const hostname = host.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicWebhookAddress(address))
  ) {
    throw new Error('Webhook destination resolves to a non-public address.')
  }
  return addresses[0]
}

export async function safeWebhookFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password)
    throw new Error('Invalid webhook URL.')
  const address = await resolveWebhookHost(target.hostname)
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers: Object.fromEntries(new Headers(init.headers)),
        agent: false,
        signal: init.signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address])
          else callback(null, address.address, address.family)
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 10_000) {
            req.destroy(new Error('Webhook response exceeds 10000 bytes.'))
            return
          }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          const headers = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers.set(key, value)
          }
          const status = res.statusCode ?? 502
          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : Buffer.concat(chunks).toString('utf8'),
              { status, headers },
            ),
          )
        })
      },
    )
    req.on('error', reject)
    req.end(typeof init.body === 'string' ? init.body : '')
  })
}
