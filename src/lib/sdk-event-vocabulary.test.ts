// @vitest-environment node
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  EVENT_ALIASES as SDK_EVENT_ALIASES,
  EVENT_NAMES as SDK_EVENT_NAMES,
  resolveEventAlias as sdkResolveEventAlias,
  verifyWebhookSignature as sdkVerifyWebhookSignature,
} from '../../sdks/typescript/src/resources/events'
import { EVENT_CATALOGUE, EVENT_NAMES } from './event-catalogue'

/**
 * EVENT-03 — catalogue == SDK vocabulary drift pin.
 *
 * The canonical catalogue (`src/lib/event-catalogue.ts`) is authoritative;
 * the SDK event modules hand-mirror it. This suite fails when the two drift
 * apart so the mirror is updated in the same change as the catalogue.
 */
describe('catalogue == SDK vocabulary', () => {
  it('TypeScript SDK mirrors every canonical catalogue name', () => {
    expect([...SDK_EVENT_NAMES].sort()).toEqual([...EVENT_NAMES].sort())
  })

  it('TypeScript SDK mirrors every wire alias', () => {
    const expected: Record<string, string> = {}
    for (const entry of EVENT_CATALOGUE) {
      if (entry.wireName !== null && entry.wireName !== entry.name) {
        expected[entry.wireName] = entry.name
      }
    }
    expect(SDK_EVENT_ALIASES).toEqual(expected)
  })

  it('Python SDK mirrors every canonical catalogue name and alias', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'sdks/python/src/sheetbase/resources/events.py',
      ),
      'utf8',
    )
    for (const name of EVENT_NAMES) {
      expect(source, `python SDK missing ${name}`).toContain(`"${name}"`)
    }
    for (const entry of EVENT_CATALOGUE) {
      if (entry.wireName !== null && entry.wireName !== entry.name) {
        expect(source, `python SDK missing alias ${entry.wireName}`).toContain(
          `"${entry.wireName}": "${entry.name}"`,
        )
      }
    }
  })

  it('SDK alias resolution agrees with the catalogue', () => {
    expect(sdkResolveEventAlias('sheet_instance.updated')).toBe('sheet.updated')
    expect(sdkResolveEventAlias('dataset.versioned')).toBe(
      'dataset.versioned',
    )
  })
})

describe('SDK webhook verification matches server signing semantics', () => {
  const body = JSON.stringify({ eventType: 'record.created', eventId: 'e1' })
  const secret = 'test-signing-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts a server-computed signature', async () => {
    await expect(
      sdkVerifyWebhookSignature(body, secret, signature),
    ).resolves.toBe(true)
  })

  it('rejects tampered bodies, wrong secrets and malformed signatures', async () => {
    await expect(
      sdkVerifyWebhookSignature(`${body} `, secret, signature),
    ).resolves.toBe(false)
    await expect(
      sdkVerifyWebhookSignature(body, 'wrong-secret', signature),
    ).resolves.toBe(false)
    await expect(
      sdkVerifyWebhookSignature(body, secret, 'sha256=deadbeef'),
    ).resolves.toBe(false)
    await expect(
      sdkVerifyWebhookSignature(body, secret, 'not-a-signature'),
    ).resolves.toBe(false)
  })
})
