/**
 * Imported HS256 keys for the JWTs this server mints and verifies.
 *
 * Handing jose a raw secret makes it import a fresh WebCrypto key on every
 * sign or verify; on the data proxy that is once per request. The imported key
 * is kept instead, per secret and use. Deployments hold one or two secrets, so
 * the cache stays tiny; it is keyed by value so a different secret (tests,
 * rotation) still gets the right key.
 *
 * The key is bound to HMAC SHA-256, so verifying with it accepts HS256 tokens
 * only. Every token this server mints is HS256.
 */
export type HmacKeyUse = 'sign' | 'verify'

const keys = new Map<string, Promise<CryptoKey>>()

export function hmacKey(secret: string, use: HmacKeyUse): Promise<CryptoKey> {
  const cacheKey = `${use}\u0000${secret}`
  let key = keys.get(cacheKey)

  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      [use],
    )
    const pending = key
    // A failed import must not be remembered.
    pending.catch(() => {
      if (keys.get(cacheKey) === pending) keys.delete(cacheKey)
    })
    keys.set(cacheKey, pending)
  }

  return key
}
