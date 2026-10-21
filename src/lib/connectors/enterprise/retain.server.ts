/**
 * INT-03 — server-side retention of external source bytes through the
 * canonical DATA-03 file platform.
 *
 * External objects pulled by enterprise connectors are never treated as the
 * only retained evidence: the bytes are written through the same canonical
 * file subsystem the product upload path uses (create_file_upload RPC →
 * ObjectStorage put → finalize_file_upload RPC), so the run provenance always
 * carries a real fileRecordId + sha256 receipt.
 *
 * The RPC surface and storage backend are injectable so DB integration tests
 * can drive the identical path against the test database.
 */
import { env } from '#/env.server'
import { FILE_MAX_BYTES } from '#/lib/file-policy'
import {
  generateStorageKey,
  getObjectStorage,
  newFileObjectId,
  OversizeError,
} from '#/lib/file-storage'

/** Minimal RPC surface (PostgREST client in prod, pg-backed mock in tests). */
export type RetentionRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>

/** Read the file_objects row for a record (PostgREST select in prod). */
export type RetentionFileObjectReader = (
  workspaceId: string,
  recordId: string,
) => Promise<{
  id: string
  storage_key: string
  status: string
  version: number
} | null>

/** Production reader: PostgREST SELECT with the session token (RLS applies). */
export function postgrestFileObjectReader(
  token: string,
): RetentionFileObjectReader {
  return async (_workspaceId, recordId) => {
    const { postgrestSelect } = await import('#/lib/request-auth')
    const { status, body } = await postgrestSelect<
      Array<{
        id: string
        storage_key: string
        status: string
        version: number
      }>
    >(
      'file_objects',
      `record_id=eq.${encodeURIComponent(recordId)}&select=id,storage_key,status,version&limit=1`,
      token,
    )
    if (status >= 400) return null
    return (
      ((
        body as Array<
          | { id: string; storage_key: string; status: string; version: number }
          | { error: unknown }
        >
      )[0] as
        | { id: string; storage_key: string; status: string; version: number }
        | undefined) ?? null
    )
  }
}

export interface RetainedFile {
  fileRecordId: string
  fileName: string
  mediaType: string
  byteSize: number
  checksum: string
}

export async function retainExternalBytes(input: {
  workspaceId: string
  projectId: string
  fileName: string
  mediaType?: string
  bytes: Uint8Array
  rpc: RetentionRpc
  readFileObject: RetentionFileObjectReader
}): Promise<RetainedFile> {
  const fileObjectId = newFileObjectId()
  const storageKey = generateStorageKey(input.workspaceId, fileObjectId)

  // Single transactional RPC: file record + file_objects row (RLS + events).
  // create_file_upload RETURNS TABLE, so PostgREST answers with a one-row array.
  const response = (await input.rpc('create_file_upload', {
    p_project_id: input.projectId,
    p_display_name: input.fileName.slice(0, 200),
    p_media_type: input.mediaType ?? 'application/octet-stream',
    p_byte_size: input.bytes.byteLength,
    p_storage_key: storageKey,
    p_checksum: null,
    p_storage_backend: env.FILE_STORAGE_BACKEND,
    p_file_object_id: fileObjectId,
  })) as unknown as { record_id?: string } | Array<{ record_id?: string }>
  const created = (Array.isArray(response) ? response.at(0) : response) ?? {}
  if (!created.record_id) {
    throw new Error('File retention was rejected by the file platform.')
  }

  // Read the row back so finalization carries the authoritative version.
  const fileObject = await input.readFileObject(
    input.workspaceId,
    created.record_id,
  )
  if (!fileObject) {
    throw new Error('File object could not be resolved after creation.')
  }

  const candidateKey = generateStorageKey(input.workspaceId, fileObject.id)
  const storage = getObjectStorage()
  const stream = new Blob([input.bytes as BlobPart]).stream()
  let result
  try {
    result = await storage.putStream(candidateKey, stream, FILE_MAX_BYTES)
  } catch (error) {
    if (error instanceof OversizeError) {
      throw new Error(
        `Source object exceeds the ${FILE_MAX_BYTES}-byte retention cap.`,
      )
    }
    throw error
  }

  const finalize = await input.rpc('finalize_file_upload', {
    p_file_id: fileObject.id,
    p_expected_version: fileObject.version,
    p_expected_storage_key: fileObject.storage_key,
    p_new_storage_key: candidateKey,
    p_byte_size: result.byteSize.toString(),
    p_checksum: result.checksum,
  })
  if ('error' in finalize) {
    await storage.delete(candidateKey)
    throw new Error('File retention failed during finalization.')
  }

  return {
    fileRecordId: created.record_id,
    fileName: input.fileName,
    mediaType: input.mediaType ?? 'application/octet-stream',
    byteSize: Number(result.byteSize),
    checksum: result.checksum,
  }
}
