import { createECDH } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { runPushWorker, vapidSubject } from './push-delivery.server'
import type { PushConnection } from './push-delivery.server'
import type { PushMessage } from './web-push.server'
import { generateVapidKeys } from './web-push.server'

/** A due delivery as `claim_due_push_deliveries` returns it. */
interface DeliveryRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  payload: Partial<PushMessage>
}

function fakeConnection(deliveries: ReadonlyArray<DeliveryRow>) {
  const keys = generateVapidKeys()
  const calls: Array<{ text: string; values?: unknown[] }> = []

  const conn: PushConnection = {
    // SAFETY: the worker asks this double for the two row types it declares (the VAPID key row and the delivery rows), which are the rows the branches below return.
    query: (async (text: string, values?: unknown[]) => {
      calls.push({ text, values })

      if (text.includes('FROM internal.push_vapid_keys'))
        return {
          rows: [{ public_key: keys.publicKey, private_jwk: keys.privateJwk }],
        }

      if (text.includes('sweep_booking_reminders')) return { rows: [{ n: 2 }] }

      if (text.includes('claim_due_push_deliveries'))
        return { rows: deliveries }

      return { rows: [] }
    }) as PushConnection['query'],
    end: vi.fn(async () => undefined),
  }

  return { conn, calls }
}

/** A syntactically real device key, so the worker tries to send. */
function device() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()

  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }
}

describe('runPushWorker', () => {
  it('sends what is due, records each outcome and writes the reminders', async () => {
    const outcomes = ['sent', 'gone', 'retry'] as const

    const { conn, calls } = fakeConnection(
      outcomes.map((_, i) => ({
        id: `d${i}`,
        endpoint: `https://push.example.test/${i}`,
        ...device(),
        payload: { title: 'T', body: '', url: '/', tag: 't', badge: 1 },
      })),
    )

    let n = 0

    const result = await runPushWorker({
      connect: async () => conn,
      send: async () => {
        const kind = outcomes[n++]

        return kind === 'retry' ? { kind, error: 'down' } : { kind }
      },
    })

    expect(result).toEqual({ reminders: 2, sent: 1, gone: 1, failed: 1 })

    const finished = calls.filter((c) =>
      c.text.includes('finish_push_delivery'),
    )

    expect(finished.map((c) => c.values)).toEqual([
      ['d0', 'sent', null],
      ['d1', 'gone', null],
      ['d2', 'retry', 'down'],
    ])
    expect(conn.end).toHaveBeenCalled()
  })

  it('treats a device with a broken key as gone without calling the push service', async () => {
    const { conn } = fakeConnection([
      {
        id: 'x',
        endpoint: 'https://p.test/x',
        p256dh: 'bad',
        auth: 'a',
        payload: {},
      },
    ])

    const send = vi.fn()
    const result = await runPushWorker({ connect: async () => conn, send })
    expect(send).not.toHaveBeenCalled()
    expect(result.gone).toBe(1)
  })
})

describe('vapidSubject', () => {
  it('uses the https address of the install, else a placeholder mailto', () => {
    expect(vapidSubject('https://eln.lab.test')).toBe('https://eln.lab.test')
    expect(vapidSubject('http://localhost:3000')).toMatch(/^mailto:/)
    expect(vapidSubject('http://localhost:3000', 'mailto:me@lab.test')).toBe(
      'mailto:me@lab.test',
    )
  })
})
