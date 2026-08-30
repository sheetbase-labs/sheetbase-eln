/**
 * API-06 — Webhook payload signing.
 *
 * HMAC-SHA256 signing of webhook payloads. The signature is computed over
 * the raw JSON body and included in the `X-Sheetbase-Signature` header as
 * `sha256=<hex>`. The recipient verifies by recomputing the HMAC with the
 * shared signing secret.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Compute the HMAC-SHA256 signature for a webhook payload body.
 * Returns `sha256=<hex>` format for the `X-Sheetbase-Signature` header.
 */
export function signPayload(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(body)
  return `sha256=${hmac.digest('hex')}`
}

/**
 * Verify a webhook signature against the expected value using a
 * timing-safe comparison. Returns true if the signature matches.
 */
export function verifySignature(
  body: string,
  secret: string,
  signature: string,
): boolean {
  const expected = signPayload(body, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Derive a webhook signing key from the master secret using HKDF with a
 * domain-separated info string (separate from connector secrets).
 */
export function deriveWebhookSecretKey(masterSecret: string): Buffer {
  const SALT = new Uint8Array(32).fill(0x2e)
  return Buffer.from(
    hkdfSync('sha256', masterSecret, SALT, 'sheetbase:webhook-secrets:v1', 32),
  )
}

/**
 * Generate a new random signing secret (32 bytes, hex-encoded).
 */
export function generateSigningSecret(): string {
  return randomBytes(32).toString('hex')
}
