import { z } from 'zod'

/**
 * SCI-003 upload policy (decision 0028). The allowed media types and maximum
 * byte size are enforced at the application boundary (for a useful early
 * error) and at the database boundary (`chk_file_objects_media_type`,
 * `chk_file_objects_byte_size`). PostgreSQL is authoritative.
 */
export const FILE_MAX_BYTES = 104_857_600 // 100 MiB

export const ALLOWED_MEDIA_TYPES: readonly string[] = [
  'text/csv',
  'text/plain',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/octet-stream',
]

export function isAllowedMediaType(mediaType: string): boolean {
  return ALLOWED_MEDIA_TYPES.includes(mediaType.toLowerCase())
}

/** Inline preview for raster images; TIFF stays download-only. */
export function isInlinePreviewableImage(mediaType: string): boolean {
  return mediaType.startsWith('image/') && !mediaType.startsWith('image/tiff')
}

/** A client metadata member that reads as trimmed text; anything else is absent. */
const textMember = z.string().catch('')

/** A client metadata member that reads as a whole byte count; anything else is -1. */
const byteSizeMember = z.number().catch(-1)

/** A client metadata member that reads as trimmed text or stays absent. */
const textOrNullMember = z.string().nullable().catch(null)

export interface PolicyViolation {
  field: 'mediaType' | 'byteSize' | 'displayName'
  message: string
}

/**
 * Validates an upload authorization request. `displayName` is untrusted client
 * metadata: it is sanitised (trimmed, length-capped) and never used as a
 * storage key. Returns the normalised values or the violations.
 */
export function validateUploadRequest(input: {
  displayName?: unknown
  mediaType?: unknown
  byteSize?: unknown
  checksum?: unknown
}):
  | { ok: true; value: AuthorizeInput }
  | { ok: false; violations: PolicyViolation[] } {
  const violations: PolicyViolation[] = []

  const displayName = textMember.parse(input.displayName).trim()

  if (displayName.length === 0 || displayName.length > 255) {
    violations.push({
      field: 'displayName',
      message: 'displayName is required and must be 1–255 characters',
    })
  }

  const mediaType = textMember.parse(input.mediaType).trim()

  if (!isAllowedMediaType(mediaType)) {
    violations.push({
      field: 'mediaType',
      message: 'mediaType is not in the allowed list (see ALLOWED_MEDIA_TYPES)',
    })
  }

  const requestedSize = byteSizeMember.parse(input.byteSize)
  const byteSize = requestedSize < 0 ? -1 : Math.floor(requestedSize)

  if (byteSize < 0 || byteSize > FILE_MAX_BYTES) {
    violations.push({
      field: 'byteSize',
      message: `byteSize must be an integer between 0 and ${FILE_MAX_BYTES}`,
    })
  }

  const checksum = textOrNullMember.parse(input.checksum)?.trim() ?? null

  if (checksum !== null && !/^[0-9a-f]{64}$/.test(checksum)) {
    violations.push({
      field: 'displayName',
      message: 'checksum must be a 64-character sha256 hex string when present',
    })
  }

  if (violations.length > 0) return { ok: false, violations }

  return {
    ok: true,
    value: {
      displayName,
      mediaType,
      byteSize,
      checksum: checksum ?? null,
    },
  }
}

export interface AuthorizeInput {
  displayName: string
  mediaType: string
  byteSize: number
  checksum: string | null
}
