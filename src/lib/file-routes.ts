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
import { getObjectStorage } from '#/lib/file-storage'
import { FILE_MAX_BYTES, validateUploadRequest } from '#/lib/file-policy'
import { env } from '#/env.server'

import {
  type FileAuthDeps,
  fileErrorResponse,
  postgrestInsert,
  postgrestPatch,
  postgrestRpc,
  postgrestSelect,
  resolveFileAuth,
} from '#/lib/file-auth'
import { generateStorageKey, newFileObjectId } from '#/lib/file-storage'
import { OversizeError } from '#/lib/file-storage'

interface CreateRecordRow {
  id: string
  identifier: string
  kind: string
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

async function markMissing(
  token: string,
  fileObjectId: string,
  version: number,
  reason: string,
): Promise<void> {
  await postgrestRpc(
    'transition_file_status',
    {
      p_file_id: fileObjectId,
      p_target_status: 'missing',
      p_expected_version: version,
      p_reason: reason,
    },
    token,
  )
}

/** `POST /api/files/upload-authorize`. */
export async function handleUploadAuthorize(
  request: Request,
  deps: FileAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return fileErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const authResult = await resolveFileAuth(request.headers, deps)
  if (!authResult.ok) {
    return fileErrorResponse(
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
    return fileErrorResponse(400, 'invalid_body', 'Request body must be JSON.')
  }
  if (typeof payload.projectId !== 'string' || !payload.projectId) {
    return fileErrorResponse(400, 'invalid_body', 'projectId is required.')
  }
  const checked = validateUploadRequest(payload)
  if (!checked.ok) {
    return fileErrorResponse(
      400,
      'policy_violation',
      checked.violations.map((v) => v.message).join(' '),
    )
  }
  const { displayName, mediaType, byteSize, checksum } = checked.value

  const recordRes = await postgrestRpc<CreateRecordRow>(
    'create_record',
    {
      p_project_id: payload.projectId,
      p_kind: 'file',
      p_title: displayName,
      p_status: 'active',
    },
    context.token,
  )
  if (recordRes.status >= 400) {
    return fileErrorResponse(
      recordRes.status,
      'record_create_failed',
      'Could not create the file record.',
    )
  }
  const recordRow = asRow<CreateRecordRow>(recordRes.body)
  if (!recordRow || !recordRow.id) {
    return fileErrorResponse(
      502,
      'record_create_failed',
      'create_record returned no row.',
    )
  }

  const fileObjectId = newFileObjectId()
  const storageKey = generateStorageKey(context.workspaceId, fileObjectId)
  const insertRes = await postgrestInsert(
    'file_objects',
    {
      id: fileObjectId,
      workspace_id: context.workspaceId,
      record_id: recordRow.id,
      storage_key: storageKey,
      display_name: displayName,
      media_type: mediaType,
      byte_size: byteSize,
      checksum: checksum,
      checksum_algorithm: 'sha256',
      status: 'active',
      storage_backend: env.FILE_STORAGE_BACKEND,
      created_by_user_id: context.userId,
      updated_by_user_id: context.userId,
    },
    context.token,
  )
  if (insertRes.status >= 400) {
    return fileErrorResponse(
      insertRes.status,
      'file_object_create_failed',
      'Could not create file storage metadata.',
    )
  }

  return new Response(
    JSON.stringify({
      fileRecordId: recordRow.id,
      fileIdentifier: recordRow.identifier,
      fileObjectId,
      storageKey,
      uploadUrl: `/api/files/${recordRow.id}/upload`,
      maxBytes: FILE_MAX_BYTES,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  )
}

/** `PUT /api/files/{fileRecordId}/upload`. */
export async function handleUpload(
  request: Request,
  fileRecordId: string,
  deps: FileAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'PUT') {
    return fileErrorResponse(405, 'method_not_allowed', 'Use PUT.')
  }
  const authResult = await resolveFileAuth(request.headers, deps)
  if (!authResult.ok) {
    return fileErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult

  const selectRes = await postgrestSelect<FileObjectWire[]>(
    'file_objects',
    `record_id=eq.${fileRecordId}&select=id,storage_key,status,version,checksum,byte_size,workspace_id&limit=1`,
    context.token,
  )
  if (selectRes.status >= 400) {
    return fileErrorResponse(
      selectRes.status,
      'file_lookup_failed',
      'Could not resolve the file object.',
    )
  }
  const rows = selectRes.body as FileObjectWire[]
  const fileObject = rows?.[0]
  if (!fileObject) {
    return fileErrorResponse(
      404,
      'not_found',
      'File object not found in your workspace.',
    )
  }
  if (fileObject.status !== 'active' && fileObject.status !== 'missing') {
    return fileErrorResponse(
      409,
      'not_uploadable',
      `File is ${fileObject.status} and cannot accept an upload.`,
    )
  }

  const claimedChecksum = fileObject.checksum
  let result
  try {
    result = await storage.putStream(
      fileObject.storage_key,
      request.body ?? new ReadableStream<Uint8Array>({ start(c) { c.close() } }),
      FILE_MAX_BYTES,
    )
  } catch (error) {
    if (error instanceof OversizeError) {
      await markMissing(
        context.token,
        fileObject.id,
        fileObject.version,
        'upload exceeded the size cap',
      )
      return fileErrorResponse(
        413,
        'oversize',
        `Upload exceeds the ${FILE_MAX_BYTES}-byte cap.`,
      )
    }
    throw error
  }

  if (claimedChecksum && claimedChecksum !== result.checksum) {
    await storage.delete(fileObject.storage_key)
    await markMissing(
      context.token,
      fileObject.id,
      fileObject.version,
      'checksum mismatch on upload',
    )
    return fileErrorResponse(
      409,
      'checksum_mismatch',
      'The uploaded bytes do not match the declared checksum.',
    )
  }

  const patch: Record<string, unknown> = {
    byte_size: result.byteSize.toString(),
    checksum: result.checksum,
    updated_by_user_id: context.userId,
  }
  if (fileObject.status === 'missing') {
    await postgrestRpc(
      'transition_file_status',
      {
        p_file_id: fileObject.id,
        p_target_status: 'active',
        p_expected_version: fileObject.version,
      },
      context.token,
    )
  }
  await postgrestPatch(
    'file_objects',
    `id=eq.${fileObject.id}`,
    patch,
    context.token,
  )

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

/** `GET /api/files/{fileRecordId}/download`. */
export async function handleDownload(
  request: Request,
  fileRecordId: string,
  deps: FileAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'GET') {
    return fileErrorResponse(405, 'method_not_allowed', 'Use GET.')
  }
  const authResult = await resolveFileAuth(request.headers, deps)
  if (!authResult.ok) {
    return fileErrorResponse(
      authResult.status,
      authResult.code,
      authResult.message,
    )
  }
  const { context } = authResult

  const selectRes = await postgrestSelect<FileObjectWire[]>(
    'file_objects',
    `record_id=eq.${fileRecordId}&select=id,storage_key,status,status_reason,version,display_name,media_type,byte_size,workspace_id&limit=1`,
    context.token,
  )
  if (selectRes.status >= 400) {
    return fileErrorResponse(
      selectRes.status,
      'file_lookup_failed',
      'Could not resolve the file object.',
    )
  }
  const rows = selectRes.body as FileObjectWire[]
  const fileObject = rows?.[0]
  if (!fileObject) {
    return fileErrorResponse(404, 'not_found', 'File not found in your workspace.')
  }

  if (fileObject.status === 'quarantined') {
    return fileErrorResponse(
      410,
      'quarantined',
      fileObject.status_reason ?? 'This file is quarantined and not downloadable.',
    )
  }
  if (fileObject.status === 'deleted') {
    return fileErrorResponse(410, 'deleted', 'This file is deleted.')
  }
  if (fileObject.status === 'missing') {
    return fileErrorResponse(
      404,
      'missing',
      'The storage object for this file is absent.',
    )
  }

  const head = await storage.head(fileObject.storage_key)
  if (!head) {
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
    return fileErrorResponse(
      404,
      'missing',
      'The storage object for this file is absent.',
    )
  }

  const { stream, byteSize } = await storage.getStream(fileObject.storage_key)
  const safeName = fileObject.display_name.replace(/[\r\n"]/g, '').slice(0, 200)
  const headers = new Headers({
    'content-type': fileObject.media_type,
    'content-length': String(byteSize),
    'content-disposition': `attachment; filename="${safeName}"`,
    'cache-control': 'private, no-store',
  })
  return new Response(stream as ReadableStream<Uint8Array>, {
    status: 200,
    headers,
  })
}
