/**
 * SCI-003 file byte-route handlers (decision 0028), extracted from the TanStack
 * route files so they are unit-testable with injectable auth deps and a
 * swappable object-storage backend. The route files are thin wrappers that
 * pass the real production deps.
 *
 * Metadata mutations go through PostgREST with a minted token so RLS, durable
 * change events and audit attribution fire exactly as for `/api/db` mutations.
 * Only file bytes bypass the JSON boundary, through the `ObjectStorage` impl.
 */
import type { ObjectStorage } from '#/lib/file-storage'
import {
  getObjectStorage,
  generateStorageKey,
  newFileObjectId,
  OversizeError,
} from '#/lib/file-storage'
import { FILE_MAX_BYTES, validateUploadRequest } from '#/lib/file-policy'
import { extractDocumentText, isSearchableMediaType } from '#/lib/file-text'
import { env } from '#/env.server'

import {
  requestErrorResponse,
  postgrestRpc,
  postgrestSelect,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'
import type { FileOutcome } from '#/lib/metrics'
import { metrics } from '#/lib/metrics'
import type { RateLimitDecision, RateLimiter } from '#/lib/rate-limit'
import {
  RATE_LIMIT_SCOPE_FILES,
  createRateLimiter,
  defaultRateLimitOptions,
} from '#/lib/rate-limit'
import { logger } from '#/lib/logger'
import { resolveRequestId } from '#/lib/request-id'

/** PLAT-03 — process-wide file byte-route limiter (per session). */
const fileRateLimiter: RateLimiter = createRateLimiter(
  defaultRateLimitOptions({
    SHEETBASE_RATE_LIMIT_MAX: positiveInt(process.env.SHEETBASE_RATE_LIMIT_MAX),
    SHEETBASE_RATE_LIMIT_WINDOW_SECONDS: positiveInt(
      process.env.SHEETBASE_RATE_LIMIT_WINDOW_SECONDS,
    ),
  }),
)

function positiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * PLAT-03 — abuse bound for the file byte routes (bytes are already capped
 * per request; this bounds request volume). Fails open by design. Mirrors the
 * proxy limiter: same bounded outcome metric, a safe warn log with no
 * principal identifiers, and Retry-After on the rejection.
 */
function fileRateLimitDecision(
  request: Request,
  sessionId: string,
  operation: 'upload' | 'download',
): RateLimitDecision | null {
  try {
    const decision = fileRateLimiter.hit(
      `${RATE_LIMIT_SCOPE_FILES}:${sessionId}`,
    )
    if (decision.allowed) return decision
    logger.warn('file route rate limited', {
      request_id: resolveRequestId(request.headers),
      operation,
    })
    metrics.fileOperations.inc({ operation, outcome: 'rate_limited' })
    return decision
  } catch {
    return null
  }
}

function fileRateLimitedResponse(decision: RateLimitDecision): Response {
  const response = requestErrorResponse(
    429,
    'rate_limited',
    'Too many requests. Slow down and try again shortly.',
  )
  response.headers.set('retry-after', String(decision.retryAfterSeconds ?? 60))
  return response
}

/**
 * PLAT-02 — records one file byte-route operation. Labels stay bounded:
 * operation and outcome only; bytes go into an aggregate counter and never
 * carry filenames or content.
 */
function recordFileOperation(
  operation: 'upload' | 'download',
  outcome: FileOutcome,
  startedAt: number,
  bytes?: number,
): void {
  metrics.fileOperations.inc({ operation, outcome })
  metrics.fileDuration.observe({ operation }, (Date.now() - startedAt) / 1000)
  if (bytes !== undefined) metrics.fileBytes.inc({ operation }, bytes)
}

interface CreateFileUploadRow {
  record_id: string
  identifier: string
  file_object_id: string
  storage_key: string
}

interface FileObjectWire {
  id: string
  storage_key: string
  status: string
  status_reason: string | null
  version: number
  checksum: string | null
  byte_size: string
  display_name: string
  media_type: string
  workspace_id: string
}

function asRow<T>(body: T | { error: unknown }): T | undefined {
  if (Array.isArray(body)) return (body as T[])[0]
  return body as T
}

/**
 * SRCH-01.3 — after a successful upload, extract text for text, PDF and Office files and
 * store it on the file object through the membership-checked RPC. Best effort:
 * an extraction failure must not fail the upload.
 */
async function persistExtractedFileText(
  storage: ObjectStorage,
  storageKey: string,
  mediaType: string,
  fileId: string,
  token: string,
  request: Request,
): Promise<void> {
  if (!isSearchableMediaType(mediaType)) return
  try {
    const { stream } = await storage.getStream(storageKey)
    const text = await extractDocumentText(stream, mediaType)
    if (text.trim().length === 0) return
    await postgrestRpc(
      'record_file_text',
      { p_file_id: fileId, p_text: text },
      token,
    )
  } catch (error) {
    logger.warn('file text extraction failed', {
      request_id: resolveRequestId(request.headers),
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}

/** `POST /api/files/upload-authorize`. */
export async function handleUploadAuthorize(
  request: Request,
  deps: SessionAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const authResult = await resolveSessionAuth(request.headers, deps)
  if (!authResult.ok) {
    return requestErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult

  let payload: {
    projectId?: unknown
    displayName?: unknown
    mediaType?: unknown
    byteSize?: unknown
    checksum?: unknown
  }
  try {
    payload = await request.json()
  } catch {
    return requestErrorResponse(
      400,
      'invalid_body',
      'Request body must be JSON.',
    )
  }
  if (typeof payload.projectId !== 'string' || !payload.projectId) {
    return requestErrorResponse(400, 'invalid_body', 'projectId is required.')
  }
  const checked = validateUploadRequest(payload)
  if (!checked.ok) {
    return requestErrorResponse(
      400,
      'policy_violation',
      checked.violations.map((v) => v.message).join(' '),
    )
  }
  const { displayName, mediaType, byteSize, checksum } = checked.value

  const fileObjectId = newFileObjectId()
  const storageKey = generateStorageKey(context.workspaceId, fileObjectId)

  // Single transactional RPC: create_record + file_objects insert are atomic
  // so a metadata failure cannot leave an orphan file record. RLS, change
  // events and audit attribution fire inside the transaction.
  const uploadRes = await postgrestRpc<CreateFileUploadRow>(
    'create_file_upload',
    {
      p_project_id: payload.projectId,
      p_display_name: displayName,
      p_media_type: mediaType,
      p_byte_size: byteSize,
      p_storage_key: storageKey,
      p_checksum: checksum,
      p_storage_backend: env.FILE_STORAGE_BACKEND,
      p_file_object_id: fileObjectId,
    },
    context.token,
  )
  if (uploadRes.status >= 400) {
    return requestErrorResponse(
      uploadRes.status,
      'record_create_failed',
      'Could not create the file record.',
    )
  }
  const uploadRow = asRow<CreateFileUploadRow>(uploadRes.body)
  if (!uploadRow || !uploadRow.record_id) {
    return requestErrorResponse(
      502,
      'record_create_failed',
      'create_file_upload returned no row.',
    )
  }

  return new Response(
    JSON.stringify({
      fileRecordId: uploadRow.record_id,
      fileIdentifier: uploadRow.identifier,
      fileObjectId,
      storageKey,
      uploadUrl: `/api/files/${uploadRow.record_id}/upload`,
      maxBytes: FILE_MAX_BYTES,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  )
}

/** `PUT /api/files/{fileRecordId}/upload`. */
export async function handleUpload(
  request: Request,
  fileRecordId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'PUT') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use PUT.')
  }
  const authResult = await resolveSessionAuth(request.headers, deps)
  if (!authResult.ok) {
    return requestErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult
  const uploadRateLimit = fileRateLimitDecision(
    request,
    context.sessionId,
    'upload',
  )
  if (uploadRateLimit && !uploadRateLimit.allowed) {
    return fileRateLimitedResponse(uploadRateLimit)
  }
  const uploadStartedAt = Date.now()

  const selectRes = await postgrestSelect<FileObjectWire[]>(
    'file_objects',
    `record_id=eq.${fileRecordId}&select=id,storage_key,status,version,checksum,byte_size,workspace_id,media_type&order=version.desc&limit=1`,
    context.token,
  )
  if (selectRes.status >= 400) {
    recordFileOperation('upload', 'error', uploadStartedAt)
    return requestErrorResponse(
      selectRes.status,
      'file_lookup_failed',
      'Could not resolve the file object.',
    )
  }
  const rows = selectRes.body as FileObjectWire[]
  if (rows.length === 0) {
    recordFileOperation('upload', 'not_found', uploadStartedAt)
    return requestErrorResponse(
      404,
      'not_found',
      'File object not found in your workspace.',
    )
  }
  const fileObject = rows[0]
  if (fileObject.status !== 'active' && fileObject.status !== 'missing') {
    recordFileOperation('upload', 'not_uploadable', uploadStartedAt)
    return requestErrorResponse(
      409,
      'not_uploadable',
      `File is ${fileObject.status} and cannot accept an upload.`,
    )
  }

  const claimedChecksum = fileObject.checksum
  const previousStorageKey = fileObject.storage_key
  // Never stream a PUT over the current object. The fresh candidate is made
  // visible only by finalize_file_upload, whose row lock serializes with
  // submitted-revision retention and concurrent upload attempts.
  const candidateStorageKey = generateStorageKey(
    context.workspaceId,
    fileObject.id,
  )
  let result
  try {
    result = await storage.putStream(
      candidateStorageKey,
      request.body ??
        new ReadableStream<Uint8Array>({
          start(c) {
            c.close()
          },
        }),
      FILE_MAX_BYTES,
    )
  } catch (error) {
    if (error instanceof OversizeError) {
      recordFileOperation('upload', 'oversize', uploadStartedAt)
      return requestErrorResponse(
        413,
        'oversize',
        `Upload exceeds the ${FILE_MAX_BYTES}-byte cap.`,
      )
    }
    throw error
  }

  if (claimedChecksum && claimedChecksum !== result.checksum) {
    await storage.delete(candidateStorageKey)
    recordFileOperation('upload', 'checksum_mismatch', uploadStartedAt)
    return requestErrorResponse(
      409,
      'checksum_mismatch',
      'The uploaded bytes do not match the declared checksum.',
    )
  }

  const finalize = await postgrestRpc(
    'finalize_file_upload',
    {
      p_file_id: fileObject.id,
      p_expected_version: fileObject.version,
      p_expected_storage_key: previousStorageKey,
      p_new_storage_key: candidateStorageKey,
      p_byte_size: result.byteSize.toString(),
      p_checksum: result.checksum,
    },
    context.token,
  )
  if (finalize.status >= 400) {
    await storage.delete(candidateStorageKey)
    recordFileOperation('upload', 'conflict', uploadStartedAt)
    return requestErrorResponse(
      409,
      'upload_conflict',
      'The file changed or was submitted while this upload was in progress.',
    )
  }

  // The database pointer has moved atomically. The old object was never
  // retained (otherwise finalization failed), so it is now safe to remove.
  await storage.delete(previousStorageKey)

  await persistExtractedFileText(
    storage,
    candidateStorageKey,
    fileObject.media_type,
    fileObject.id,
    context.token,
    request,
  )

  recordFileOperation('upload', 'ok', uploadStartedAt, Number(result.byteSize))

  return new Response(
    JSON.stringify({
      fileRecordId,
      byteSize: result.byteSize.toString(),
      checksum: result.checksum,
      status: 'active',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const VERSION_MEDIA_TYPES = new Set([
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
])

/**
 * `PUT /api/files/{fileRecordId}/version?name=...`. Stores the body as the
 * next version of a file. Every earlier version stays downloadable: the bytes
 * go to a fresh storage key and `register_file_version` chains the new row to
 * the one it replaces, so nothing is overwritten.
 */
export async function handleUploadVersion(
  request: Request,
  fileRecordId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'PUT') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use PUT.')
  }
  const authResult = await resolveSessionAuth(request.headers, deps)
  if (!authResult.ok) {
    return requestErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult
  const rateLimit = fileRateLimitDecision(request, context.sessionId, 'upload')
  if (rateLimit && !rateLimit.allowed) return fileRateLimitedResponse(rateLimit)
  const startedAt = Date.now()

  const selectRes = await postgrestSelect<FileObjectWire[]>(
    'file_objects',
    `record_id=eq.${fileRecordId}&select=id,storage_key,status,version,display_name,media_type,workspace_id&order=version.desc&limit=1`,
    context.token,
  )
  if (selectRes.status >= 400) {
    recordFileOperation('upload', 'error', startedAt)
    return requestErrorResponse(
      selectRes.status,
      'file_lookup_failed',
      'Could not resolve the file object.',
    )
  }
  const current = (selectRes.body as FileObjectWire[]).at(0)
  if (!current) {
    recordFileOperation('upload', 'not_found', startedAt)
    return requestErrorResponse(
      404,
      'not_found',
      'File object not found in your workspace.',
    )
  }
  if (current.status !== 'active') {
    recordFileOperation('upload', 'not_uploadable', startedAt)
    return requestErrorResponse(
      409,
      'not_uploadable',
      `File is ${current.status} and cannot take a new version.`,
    )
  }
  const url = new URL(request.url)
  const displayName = (url.searchParams.get('name') ?? current.display_name)
    .trim()
    .slice(0, 255)
  const declared = (request.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
  const mediaType = VERSION_MEDIA_TYPES.has(declared)
    ? declared
    : 'application/octet-stream'

  const candidateStorageKey = generateStorageKey(
    context.workspaceId,
    current.id,
  )
  let result
  try {
    result = await storage.putStream(
      candidateStorageKey,
      request.body ??
        new ReadableStream<Uint8Array>({
          start(c) {
            c.close()
          },
        }),
      FILE_MAX_BYTES,
    )
  } catch (error) {
    if (error instanceof OversizeError) {
      recordFileOperation('upload', 'oversize', startedAt)
      return requestErrorResponse(
        413,
        'oversize',
        `Upload exceeds the ${FILE_MAX_BYTES}-byte cap.`,
      )
    }
    throw error
  }

  const registered = await postgrestRpc(
    'register_file_version',
    {
      p_file_id: current.id,
      p_display_name: displayName || current.display_name,
      p_storage_key: candidateStorageKey,
      p_media_type: mediaType,
      p_byte_size: result.byteSize.toString(),
      p_checksum: result.checksum,
    },
    context.token,
  )
  if (registered.status >= 400) {
    await storage.delete(candidateStorageKey)
    recordFileOperation('upload', 'conflict', startedAt)
    return requestErrorResponse(
      registered.status === 403 ? 403 : 409,
      'version_refused',
      'The new version could not be saved. The file may be locked or you may not be able to edit its record.',
    )
  }
  const row = asRow(registered.body as FileObjectWire | { error: unknown })
  const newId = row?.id
  const newVersion = row?.version

  if (newId) {
    await persistExtractedFileText(
      storage,
      candidateStorageKey,
      mediaType,
      newId,
      context.token,
      request,
    )
  }
  recordFileOperation('upload', 'ok', startedAt, Number(result.byteSize))
  return new Response(
    JSON.stringify({
      fileRecordId,
      version: newVersion,
      byteSize: result.byteSize.toString(),
      checksum: result.checksum,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

/** `GET /api/files/{fileRecordId}/download`. */
export async function handleDownload(
  request: Request,
  fileRecordId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'GET') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET.')
  }
  const authResult = await resolveSessionAuth(request.headers, deps)
  if (!authResult.ok) {
    return requestErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult
  const downloadRateLimit = fileRateLimitDecision(
    request,
    context.sessionId,
    'download',
  )
  if (downloadRateLimit && !downloadRateLimit.allowed) {
    return fileRateLimitedResponse(downloadRateLimit)
  }
  const downloadStartedAt = Date.now()
  // `?version=N` fetches an earlier version; without it the newest is served.
  const versionParam = new URL(request.url).searchParams.get('version')
  const wantedVersion =
    versionParam && /^[1-9][0-9]{0,8}$/.test(versionParam) ? versionParam : null

  const selectRes = await postgrestSelect<FileObjectWire[]>(
    'file_objects',
    `record_id=eq.${fileRecordId}${wantedVersion ? `&version=eq.${wantedVersion}` : ''}&select=id,storage_key,status,status_reason,version,display_name,media_type,byte_size,workspace_id&order=version.desc&limit=1`,
    context.token,
  )
  if (selectRes.status >= 400) {
    recordFileOperation('download', 'error', downloadStartedAt)
    return requestErrorResponse(
      selectRes.status,
      'file_lookup_failed',
      'Could not resolve the file object.',
    )
  }
  const rows = selectRes.body as FileObjectWire[]
  if (rows.length === 0) {
    recordFileOperation('download', 'not_found', downloadStartedAt)
    return requestErrorResponse(
      404,
      'not_found',
      'File not found in your workspace.',
    )
  }

  const fileObject = rows[0]
  if (fileObject.status === 'quarantined') {
    recordFileOperation('download', 'not_uploadable', downloadStartedAt)
    return requestErrorResponse(
      410,
      'quarantined',
      fileObject.status_reason ??
        'This file is quarantined and not downloadable.',
    )
  }
  if (fileObject.status === 'deleted') {
    recordFileOperation('download', 'not_found', downloadStartedAt)
    return requestErrorResponse(410, 'deleted', 'This file is deleted.')
  }
  if (fileObject.status === 'missing') {
    recordFileOperation('download', 'missing', downloadStartedAt)
    return requestErrorResponse(
      404,
      'missing',
      'The storage object for this file is absent.',
    )
  }

  const head = await storage.head(fileObject.storage_key)
  if (!head) {
    recordFileOperation('download', 'missing', downloadStartedAt)
    await postgrestRpc(
      'transition_file_status',
      {
        p_file_id: fileObject.id,
        p_target_status: 'missing',
        p_expected_version: fileObject.version,
        p_reason: 'storage object absent on download',
      },
      context.token,
    )
    return requestErrorResponse(
      404,
      'missing',
      'The storage object for this file is absent.',
    )
  }

  const { stream, byteSize } = await storage.getStream(fileObject.storage_key)
  recordFileOperation('download', 'ok', downloadStartedAt, byteSize)
  const safeName = fileObject.display_name.replace(/[\r\n"]/g, '').slice(0, 200)
  const headers = new Headers({
    'content-type': fileObject.media_type,
    'content-length': String(byteSize),
    'content-disposition': `attachment; filename="${safeName}"`,
    'cache-control': 'private, no-store',
  })
  return new Response(stream, {
    status: 200,
    headers,
  })
}
