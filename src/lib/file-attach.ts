/**
 * SCI-003 file-attach flow (decision 0028). Attaches an uploaded file to a
 * notebook `file` block by:
 *
 *   1. POST /api/files/upload-authorize — validates policy, creates the file
 *      record + file_objects metadata through PostgREST (RLS/events/audit),
 *      and returns a bounded upload URL.
 *   2. PUT /api/files/{fileRecordId}/upload — streams the bytes to the
 *      object-storage boundary (never through /api/db JSON), enforcing the
 *      size cap and checksum.
 *   3. update_block_payload RPC — persists the file reference in the block
 *      payload so the DB file-block trigger verifies the reference.
 *
 * The client-provided filename is display metadata only; the storage key is
 * server-generated. Errors are surfaced with stable codes for the UI.
 */
import type { DataClient } from '#/lib/data-client'
import { PAYLOAD_SCHEMA_VERSION, validateBlock } from '#/lib/blocks'
import { updateBlockPayload } from '#/lib/notebook-mutations'
import type { NotebookBlock } from '#/lib/notebook-data'

import {
  ALLOWED_MEDIA_TYPES,
  FILE_MAX_BYTES,
  isAllowedMediaType,
} from './file-policy'

export interface AttachFileArgs {
  blockId: string
  expectedBlockVersion: number
  /** Project the file record is created in (the host record's project). */
  projectId: string
  file: File
}

export interface AttachFileResult {
  block: NotebookBlock
  fileRecordId: string
  fileIdentifier: string
  displayName: string
  mediaType: string
  byteSize: number
}

export class AttachFileError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'oversize'
      | 'disallowed_type'
      | 'checksum_mismatch'
      | 'unauthenticated'
      | 'permission_denied'
      | 'not_found'
      | 'server_error',
  ) {
    super(message)
    this.name = 'AttachFileError'
  }
}

function mapStatusToError(status: number, body: unknown): AttachFileError {
  const code =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error: { code?: unknown } }).error.code ?? '')
      : ''
  if (status === 401)
    return new AttachFileError('Sign in to upload files.', 'unauthenticated')
  if (status === 403 || status === 404)
    return new AttachFileError(
      code === 'not_found'
        ? 'File not found in your workspace.'
        : 'Permission denied.',
      'permission_denied',
    )
  if (status === 409 && code === 'checksum_mismatch')
    return new AttachFileError(
      'The uploaded bytes do not match the declared checksum.',
      'checksum_mismatch',
    )
  return new AttachFileError(`Upload failed (${status}).`, 'server_error')
}

/**
 * Validates a `File` against the upload policy before any network call, for
 * an immediate, useful client-side error. The server re-validates.
 */
export function validateFileForUpload(
  file: File,
):
  | { ok: true; mediaType: string }
  | { ok: false; code: 'oversize' | 'disallowed_type'; message: string } {
  const mediaType = file.type || 'application/octet-stream'
  if (!isAllowedMediaType(mediaType)) {
    return {
      ok: false,
      code: 'disallowed_type',
      message: `Files of type "${mediaType}" are not allowed.`,
    }
  }
  if (file.size > FILE_MAX_BYTES) {
    return {
      ok: false,
      code: 'oversize',
      message: `File is ${formatBytes(file.size)}; the limit is ${formatBytes(FILE_MAX_BYTES)}.`,
    }
  }
  return { ok: true, mediaType }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export async function attachFileToBlock(
  client: DataClient,
  args: AttachFileArgs,
): Promise<AttachFileResult> {
  const checked = validateFileForUpload(args.file)
  if (!checked.ok) {
    throw new AttachFileError(checked.message, checked.code)
  }
  const mediaType = checked.mediaType

  const authorizeRes = await fetch('/api/files/upload-authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      displayName: args.file.name,
      mediaType,
      byteSize: args.file.size,
    }),
  })
  if (authorizeRes.status >= 400) {
    throw mapStatusToError(
      authorizeRes.status,
      await authorizeRes.json().catch(() => null),
    )
  }
  const meta = (await authorizeRes.json()) as {
    fileRecordId: string
    fileIdentifier: string
    storageKey: string
    uploadUrl: string
    maxBytes: number
  }

  const uploadRes = await fetch(`/api/files/${meta.fileRecordId}/upload`, {
    method: 'PUT',
    headers: { 'content-type': mediaType },
    body: args.file,
  })
  if (uploadRes.status >= 400) {
    throw mapStatusToError(
      uploadRes.status,
      await uploadRes.json().catch(() => null),
    )
  }

  const payload = {
    fileRecordId: meta.fileRecordId,
    fileIdentifier: meta.fileIdentifier,
    displayName: args.file.name,
    mediaType,
    byteSize: args.file.size,
  }
  const validation = validateBlock({ type: 'file', payload })
  if (!validation.ok) {
    throw new AttachFileError(
      validation.errors.map((e) => e.message).join(' '),
      'server_error',
    )
  }

  const block = await updateBlockPayload(client, {
    blockId: args.blockId,
    payload,
    expectedVersion: args.expectedBlockVersion,
    payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
  })

  return {
    block,
    fileRecordId: meta.fileRecordId,
    fileIdentifier: meta.fileIdentifier,
    displayName: args.file.name,
    mediaType,
    byteSize: args.file.size,
  }
}

export { ALLOWED_MEDIA_TYPES, FILE_MAX_BYTES }
