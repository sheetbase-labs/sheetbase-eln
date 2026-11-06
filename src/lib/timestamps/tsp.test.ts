import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  TimestampError,
  buildTimestampRequest,
  requestTimestamp,
  verifyTimestampResponse,
} from './tsp'
import { createTestAuthority, opensslAvailable } from './test-authority'
import type { TestAuthority } from './test-authority'

const imprint = createHash('sha256').update('a signed revision').digest('hex')

describe.skipIf(!opensslAvailable)('RFC 3161 timestamps', () => {
  let authority: TestAuthority
  beforeAll(() => {
    authority = createTestAuthority()
  })

  it('stamps an imprint and verifies the token', async () => {
    const request = buildTimestampRequest(imprint)
    const response = await requestTimestamp('https://tsa.invalid/', request, {
      fetch: authority.fetch,
    })
    const info = verifyTimestampResponse(response, {
      expectedImprintHex: imprint,
      expectedNonce: request.nonce,
      trustedRoots: [authority.rootPem],
    })
    expect(info.imprintHex).toBe(imprint)
    expect(info.signer).toContain('Sheetbase Test Timestamp Authority')
    expect(info.trusted).toBe(true)
    expect(Math.abs(Date.parse(info.genTime) - Date.now())).toBeLessThan(60_000)
  })

  it('does not call the signer trusted without its root', () => {
    const request = buildTimestampRequest(imprint)
    const response = authority.reply(request.der)
    const none = verifyTimestampResponse(response, {
      expectedImprintHex: imprint,
    })
    expect(none.trusted).toBeNull()
    const wrongRoot = createTestAuthority().rootPem
    const other = verifyTimestampResponse(response, {
      expectedImprintHex: imprint,
      trustedRoots: [wrongRoot],
    })
    expect(other.trusted).toBe(false)
  })

  it('rejects a token for different data, another request, or a tampered body', () => {
    const request = buildTimestampRequest(imprint)
    const response = authority.reply(request.der)
    const otherData = createHash('sha256')
      .update('something else')
      .digest('hex')
    expect(() =>
      verifyTimestampResponse(response, { expectedImprintHex: otherData }),
    ).toThrow(TimestampError)
    expect(() =>
      verifyTimestampResponse(response, {
        expectedImprintHex: imprint,
        expectedNonce: 'deadbeef',
      }),
    ).toThrow(/does not answer/)
    const tampered = Uint8Array.from(response)
    tampered[tampered.length - 5] ^= 0xff
    expect(() =>
      verifyTimestampResponse(tampered, { expectedImprintHex: imprint }),
    ).toThrow(TimestampError)
  })

  it('refuses a malformed imprint and an unreadable response', () => {
    expect(() => buildTimestampRequest('abc')).toThrow()
    expect(() =>
      verifyTimestampResponse(Uint8Array.of(1, 2, 3), {
        expectedImprintHex: imprint,
      }),
    ).toThrow(TimestampError)
  })
})
