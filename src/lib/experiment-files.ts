import { z } from 'zod'

import type { DataClient } from './data-client'

export interface UploadedExperimentFile {
  fileRecordId: string
  fileIdentifier: string
}

/** What `POST /api/files/upload-authorize` answers: the record the bytes go to. */
const UPLOAD_META = z.object({
  fileRecordId: z.string(),
  fileIdentifier: z.string(),
})

/** What `PUT /api/files/{fileRecordId}/version` answers: the version it wrote. */
const VERSION_RECEIPT = z.object({ version: z.number() })

/** The `error` object a refusal carries; anything else reads as no message. */
const REFUSAL_BODY = z.object({
  error: z.object({ message: z.string() }).optional(),
})

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = REFUSAL_BODY.safeParse(await res.json().catch(() => null))

  return new Error(
    body.success ? (body.data.error?.message ?? fallback) : fallback,
  )
}

/**
 * Put a file on an experiment. The upload is authorised through the canonical
 * RPC, the bytes stream to the storage boundary (which computes the hash), and
 * the experiment then links the file record, so it lists under Files.
 */
export async function uploadFileToExperiment(
  client: DataClient,
  input: { projectId: string; experimentId: string; file: File },
): Promise<UploadedExperimentFile> {
  const { file } = input

  const authorize = await fetch('/api/files/upload-authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      displayName: file.name,
      mediaType: file.type || 'application/octet-stream',
      byteSize: file.size,
    }),
  })

  if (authorize.status >= 400)
    throw await failure(authorize, 'The upload was refused.')
  const meta = UPLOAD_META.parse(await authorize.json())

  const put = await fetch(`/api/files/${meta.fileRecordId}/upload`, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })

  if (put.status >= 400) throw await failure(put, 'The upload failed.')
  await client.rpc('create_record_link', {
    p_source_record_id: input.experimentId,
    p_target_kind: 'file',
    p_target_identifier: meta.fileIdentifier,
    p_link_type: 'file',
    p_target_record_id: meta.fileRecordId,
  })

  return meta
}

/** Save a file as the next version of an uploaded file; earlier versions stay
 * downloadable. */
export async function uploadFileVersion(input: {
  fileId: string
  file: File
}): Promise<{ version: number }> {
  const res = await fetch(
    `/api/files/${input.fileId}/version?name=${encodeURIComponent(input.file.name)}`,
    {
      method: 'PUT',
      headers: {
        'content-type': input.file.type || 'application/octet-stream',
      },
      body: input.file,
    },
  )

  if (res.status >= 400)
    throw await failure(res, 'The new version was refused.')

  return VERSION_RECEIPT.parse(await res.json())
}

/** The first lines of a file's extracted text, for the inspector preview. */
export function previewLines(text: string | null, count = 6): string[] {
  if (!text) return []

  return text.split(/\r?\n/).slice(0, count)
}
