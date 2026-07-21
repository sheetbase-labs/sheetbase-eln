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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]

export function isAllowedMediaType(mediaType: string): boolean {
  return ALLOWED_MEDIA_TYPES.includes(mediaType.toLowerCase())
}

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

  const displayName =
    typeof input.displayName === 'string' ? input.displayName.trim() : ''
  if (displayName.length === 0 || displayName.length > 255) {
    violations.push({
      field: 'displayName',
      message: 'displayName is required and must be 1–255 characters',
    })
  }

  const mediaType =
    typeof input.mediaType === 'string' ? input.mediaType.trim() : ''
  if (!isAllowedMediaType(mediaType)) {
    violations.push({
      field: 'mediaType',
      message: 'mediaType is not in the allowed list (see ALLOWED_MEDIA_TYPES)',
    })
  }

  let byteSize = -1
  if (typeof input.byteSize === 'number' && Number.isFinite(input.byteSize)) {
    byteSize = Math.floor(input.byteSize)
  }
  if (byteSize < 0 || byteSize > FILE_MAX_BYTES) {
    violations.push({
      field: 'byteSize',
      message: `byteSize must be an integer between 0 and ${FILE_MAX_BYTES}`,
    })
  }

  const checksum =
    typeof input.checksum === 'string' ? input.checksum.trim() : null
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
