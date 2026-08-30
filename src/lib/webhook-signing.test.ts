// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  generateSigningSecret,
  signPayload,
  verifySignature,
} from './webhook-signing'

const SECRET = 'test-signing-secret-32-chars-min!!!'
const BODY = JSON.stringify({
  schemaVersion: '1',
  eventType: 'record.created',
  eventId: '00000000-0000-4000-8000-000000000001',
})

describe('signPayload', () => {
  it('produces a sha256= prefixed hex signature', () => {
    const sig = signPayload(BODY, SECRET)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('produces deterministic signatures for the same input', () => {
    const sig1 = signPayload(BODY, SECRET)
    const sig2 = signPayload(BODY, SECRET)
    expect(sig1).toBe(sig2)
  })

  it('produces different signatures for different bodies', () => {
    const sig1 = signPayload(BODY, SECRET)
    const sig2 = signPayload(BODY + 'x', SECRET)
    expect(sig1).not.toBe(sig2)
  })

  it('produces different signatures for different secrets', () => {
    const sig1 = signPayload(BODY, SECRET)
    const sig2 = signPayload(BODY, 'different-secret-also-32-chars!')
    expect(sig1).not.toBe(sig2)
  })
})

describe('verifySignature', () => {
  it('verifies a correct signature', () => {
    const sig = signPayload(BODY, SECRET)
    expect(verifySignature(BODY, SECRET, sig)).toBe(true)
  })

  it('rejects an incorrect signature', () => {
    const sig = signPayload(BODY, 'wrong-secret-32-chars-minimum!!!')
    expect(verifySignature(BODY, SECRET, sig)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const sig = signPayload(BODY, SECRET)
    expect(verifySignature(BODY + 'tampered', SECRET, sig)).toBe(false)
  })

  it('rejects a malformed signature', () => {
    expect(verifySignature(BODY, SECRET, 'invalid')).toBe(false)
  })

  it('rejects a signature of different length', () => {
    expect(verifySignature(BODY, SECRET, 'sha256=abc')).toBe(false)
  })
})

describe('generateSigningSecret', () => {
  it('produces a 64-character hex string', () => {
    const secret = generateSigningSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces unique secrets', () => {
    const s1 = generateSigningSecret()
    const s2 = generateSigningSecret()
    expect(s1).not.toBe(s2)
  })
})
