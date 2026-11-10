import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  verify,
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  encryptPayload,
  generateVapidKeys,
  isValidDeviceKey,
  sendWebPush,
  vapidAuthorization,
} from './web-push.server'

/** A phone, built from the other side of RFC 8291, to read what we send. */
function makeDevice() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url')

  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
    decrypt(body: Buffer): string {
      const salt = body.subarray(0, 16)
      expect(body.readUInt32BE(16)).toBe(4096)
      const idLength = body[20]
      const serverKey = body.subarray(21, 21 + idLength)
      const encrypted = body.subarray(21 + idLength)
      const shared = ecdh.computeSecret(serverKey)

      const ikm = Buffer.from(
        hkdfSync(
          'sha256',
          shared,
          auth,
          Buffer.concat([
            Buffer.from('WebPush: info\0'),
            ecdh.getPublicKey(),
            serverKey,
          ]),
          32,
        ),
      )

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
        hkdfSync(
          'sha256',
          ikm,
          salt,
          Buffer.from('Content-Encoding: nonce\0'),
          12,
        ),
      )

      const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16))

      const padded = Buffer.concat([
        decipher.update(encrypted.subarray(0, encrypted.length - 16)),
        decipher.final(),
      ])

      expect(padded[padded.length - 1]).toBe(0x02)

      return padded.subarray(0, padded.length - 1).toString('utf8')
    },
  }
}

describe('encryptPayload', () => {
  it('can be read by the device it was made for, and only that one', () => {
    const device = makeDevice()
    const body = encryptPayload(Buffer.from('Timer finished ✓'), device)
    expect(device.decrypt(body)).toBe('Timer finished ✓')
    expect(() => makeDevice().decrypt(body)).toThrow()
  })

  it('writes the RFC 8291 header: salt, record size, key id of 65 bytes', () => {
    const device = makeDevice()
    const salt = Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url')
    const body = encryptPayload(Buffer.from('hi'), device, { salt })
    expect(body.subarray(0, 16).equals(salt)).toBe(true)
    expect(body.subarray(16, 20).toString('hex')).toBe('00001000')
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(0x04)
    // header + key + message + delimiter + 16 byte tag
    expect(body.length).toBe(21 + 65 + 2 + 1 + 16)
  })

  it('refuses a message that cannot fit one record', () => {
    expect(() => encryptPayload(Buffer.alloc(5000), makeDevice())).toThrow(
      /too large/,
    )
  })
})

describe('vapidAuthorization', () => {
  it('signs a token for the push service origin that the public key verifies', () => {
    const keys = generateVapidKeys()

    const header = vapidAuthorization(
      'https://push.example.test/send/abc',
      'mailto:lab@example.test',
      keys,
      1_000_000,
    )

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!
    expect(match[4]).toBe(keys.publicKey)
    const claims = JSON.parse(Buffer.from(match[2], 'base64url').toString())
    expect(claims).toEqual({
      aud: 'https://push.example.test',
      exp: 1_000_000 + 12 * 3600,
      sub: 'mailto:lab@example.test',
    })
    const point = Buffer.from(keys.publicKey, 'base64url')

    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })

    expect(
      verify(
        'sha256',
        Buffer.from(`${match[1]}.${match[2]}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(match[3], 'base64url'),
      ),
    ).toBe(true)
  })
})

describe('sendWebPush', () => {
  const message = {
    title: 'Timer finished',
    body: 'Incubate',
    url: '/records/1',
    tag: 'step-timer-1',
    badge: 3,
  }

  it('posts the encrypted message with the VAPID header and reports it sent', async () => {
    const device = makeDevice()
    const keys = generateVapidKeys()

    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 201 }),
    )

    const outcome = await sendWebPush(
      { endpoint: 'https://push.example.test/send/abc', ...device },
      message,
      keys,
      { subject: 'mailto:lab@example.test', fetchImpl },
    )

    expect(outcome).toEqual({ kind: 'sent' })

    const [url, init] = fetchImpl.mock.calls[0]

    expect(url).toBe('https://push.example.test/send/abc')
    const headers = new Headers(init?.headers)
    expect(headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/)
    expect(headers.get('TTL')).toBeTruthy()
    const body = z.instanceof(Uint8Array).parse(init?.body)
    expect(JSON.parse(device.decrypt(Buffer.from(body)))).toEqual(message)
  })

  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [429, 'retry'],
    [500, 'retry'],
  ])('treats a %i answer as %s', async (status, kind) => {
    const outcome = await sendWebPush(
      { endpoint: 'https://push.example.test/x', ...makeDevice() },
      message,
      generateVapidKeys(),
      {
        subject: 'mailto:a@b.test',
        fetchImpl: vi.fn(async () => new Response(null, { status })),
      },
    )

    expect(outcome.kind).toBe(kind)
  })

  it('retries when the push service cannot be reached', async () => {
    const outcome = await sendWebPush(
      { endpoint: 'https://push.example.test/x', ...makeDevice() },
      message,
      generateVapidKeys(),
      {
        subject: 'mailto:a@b.test',
        fetchImpl: vi.fn(async () => {
          throw new Error('offline')
        }),
      },
    )

    expect(outcome).toEqual({ kind: 'retry', error: 'offline' })
  })
})

describe('isValidDeviceKey', () => {
  it('accepts a real P-256 point and rejects anything else', () => {
    expect(isValidDeviceKey(makeDevice().p256dh)).toBe(true)
    expect(isValidDeviceKey('nope')).toBe(false)
    expect(isValidDeviceKey(Buffer.alloc(65, 4).toString('base64url'))).toBe(
      false,
    )
  })
})
