/**
 * The bytes a time-stamping authority is asked to vouch for. They are stored
 * exactly as stamped (api.signature_timestamps.signed_data), so a bundle ships
 * the very same bytes and anyone can hash them again.
 */
import { createHash } from 'node:crypto'

export const SIGNED_DATA_FORMAT = 'sheetbase-signature/1'

export interface SignedDataInput {
  signatureId: string
  workspaceId: string
  recordId: string
  revisionId: string
  revisionIntegrityDigest: string
  signerUserId: string
  meaning: string
  /** ISO 8601, UTC, microseconds, e.g. 2026-11-06T10:00:00.123456Z. */
  signedAt: string
}

/** Fixed key order and no whitespace, so the same signature always gives the same bytes. */
export function canonicalSignedData(input: SignedDataInput): string {
  return JSON.stringify({
    format: SIGNED_DATA_FORMAT,
    signatureId: input.signatureId,
    workspaceId: input.workspaceId,
    recordId: input.recordId,
    revisionId: input.revisionId,
    revisionIntegrityDigest: input.revisionIntegrityDigest,
    signerUserId: input.signerUserId,
    meaning: input.meaning,
    signedAt: input.signedAt,
  })
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The authorities a workspace can pick from. */
export const TIMESTAMP_AUTHORITIES = {
  dfn: { name: 'DFN-Verein', url: 'https://zeitstempel.dfn.de' },
  digicert: { name: 'DigiCert', url: 'http://timestamp.digicert.com' },
} as const

export type TimestampAuthorityChoice = 'dfn' | 'digicert' | 'custom'

export function authorityLabel(
  choice: string | null | undefined,
  url: string | null | undefined,
): string {
  if (choice === 'dfn' || choice === 'digicert') {
    return TIMESTAMP_AUTHORITIES[choice].name
  }

  if (url) {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  return 'Custom authority'
}
