/**
 * Web Push, with nothing but Node's own crypto: VAPID (RFC 8292) to identify
 * this server to the push service and aes128gcm content encryption (RFC 8291)
 * so only the person's device can read the message.
 *
 * `sendWebPush` is the whole sender; the rest are its parts, exported so the
 * tests can check them against a device they build themselves.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'
import type { JsonWebKey } from 'node:crypto'

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url: what browsers subscribe with. */
  publicKey: string
  /** The matching private key as a JWK. Never leaves the server. */
  privateJwk: JsonWebKey
}

export interface PushTarget {
  endpoint: string
  /** The device's public key (base64url, 65 bytes). */
  p256dh: string
  /** The device's auth secret (base64url, 16 bytes). */
  auth: string
}

export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
  badge: number
}

export type PushOutcome =
  { kind: 'sent' } | { kind: 'gone' } | { kind: 'retry'; error: string }

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url')

const fromBase64Url = (value: string): Buffer => Buffer.from(value, 'base64url')

/** Make a fresh server key pair. */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })

  const pub = publicKey.export({ format: 'jwk' })

  const point = Buffer.concat([
    Buffer.from([0x04]),
    fromBase64Url(pub.x!),
    fromBase64Url(pub.y!),
  ])

  return {
    publicKey: toBase64Url(point),
    privateJwk: privateKey.export({ format: 'jwk' }),
  }
}

/** The `Authorization` value that proves this server owns the key (RFC 8292). */
export function vapidAuthorization(
  endpoint: string,
  subject: string,
  keys: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = toBase64Url(
    Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  )

  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  )

  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey({ key: keys.privateJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  })

  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`
}

const RECORD_SIZE = 4096

/**
 * Encrypt a message for one device (RFC 8291, a single aes128gcm record). The
 * ephemeral key and salt are injectable for tests and otherwise random.
 */
export function encryptPayload(
  plaintext: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  options: { ephemeral?: ReturnType<typeof createECDH>; salt?: Buffer } = {},
): Buffer {
  const deviceKey = fromBase64Url(target.p256dh)
  const authSecret = fromBase64Url(target.auth)
  const ephemeral = options.ephemeral ?? createECDH('prime256v1')

  if (!options.ephemeral) ephemeral.generateKeys()
  const serverKey = ephemeral.getPublicKey()
  const salt = options.salt ?? randomBytes(16)

  const shared = ephemeral.computeSecret(deviceKey)

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    deviceKey,
    serverKey,
  ])

  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))

  const cek = Buffer.from(
    hkdfSync(
      'sha256',
      ikm,
      salt,
      Buffer.from('Content-Encoding: aes128gcm\0'),
      16,
    ),
  )

  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )

  if (plaintext.length > RECORD_SIZE - 17 - 1) {
    throw new Error('push message is too large')
  }

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)

  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(16 + 4 + 1)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(serverKey.length, 20)

  return Buffer.concat([header, serverKey, encrypted])
}

export interface SendOptions {
  subject: string
  /** How long the push service keeps it for a device that is off, seconds. */
  ttlSeconds?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Send one message to one device and say what became of it. */
export async function sendWebPush(
  target: PushTarget,
  message: PushMessage,
  keys: VapidKeys,
  options: SendOptions,
): Promise<PushOutcome> {
  const doFetch = options.fetchImpl ?? fetch

  try {
    const body = encryptPayload(Buffer.from(JSON.stringify(message)), target)

    const response = await doFetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(
          target.endpoint,
          options.subject,
          keys,
        ),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        TTL: String(options.ttlSeconds ?? 12 * 60 * 60),
        Urgency: options.urgency ?? 'high',
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })

    if (response.ok) return { kind: 'sent' }

    // 404 and 410 are the push service saying the device has unsubscribed.
    if (response.status === 404 || response.status === 410) {
      return { kind: 'gone' }
    }

    return { kind: 'retry', error: `push service answered ${response.status}` }
  } catch (error) {
    return {
      kind: 'retry',
      error: error instanceof Error ? error.message : 'push failed',
    }
  }
}

/** Is this a usable device key? Checked before a subscription is trusted. */
export function isValidDeviceKey(p256dh: string): boolean {
  try {
    const bytes = fromBase64Url(p256dh)

    if (bytes.length !== 65 || bytes[0] !== 0x04) return false
    createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(bytes.subarray(1, 33)),
        y: toBase64Url(bytes.subarray(33)),
      },
      format: 'jwk',
    })

    return true
  } catch {
    return false
  }
}
