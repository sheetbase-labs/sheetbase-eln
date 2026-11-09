// @vitest-environment node
import { SignJWT, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { hmacKey } from './hmac-key'

const SECRET = 'test-secret-with-at-least-thirty-two-characters-in-it'
const OTHER = 'another-secret-with-at-least-thirty-two-characters'

describe('hmacKey', () => {
  it('returns the same imported key for the same secret and use', async () => {
    expect(await hmacKey(SECRET, 'sign')).toBe(await hmacKey(SECRET, 'sign'))
    expect(await hmacKey(SECRET, 'sign')).not.toBe(
      await hmacKey(SECRET, 'verify'),
    )
    expect(await hmacKey(SECRET, 'sign')).not.toBe(await hmacKey(OTHER, 'sign'))
  })

  it('signs tokens that verify against the raw secret, and the reverse', async () => {
    const signed = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(await hmacKey(SECRET, 'sign'))

    await expect(
      jwtVerify(signed, new TextEncoder().encode(SECRET)),
    ).resolves.toBeDefined()

    const external = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(SECRET))

    await expect(
      jwtVerify(external, await hmacKey(SECRET, 'verify')),
    ).resolves.toBeDefined()
    await expect(
      jwtVerify(external, await hmacKey(OTHER, 'verify')),
    ).rejects.toThrow()
  })

  it('accepts HS256 tokens only', async () => {
    const hs512 = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS512' })
      .sign(new TextEncoder().encode(SECRET))

    await expect(
      jwtVerify(hs512, await hmacKey(SECRET, 'verify')),
    ).rejects.toThrow()
  })
})
