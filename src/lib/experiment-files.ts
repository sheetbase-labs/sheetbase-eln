import type { DataClient } from './data-client'

export interface UploadedExperimentFile {
  fileRecordId: string
  fileIdentifier: string
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  return new Error(body?.error?.message ?? fallback)
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
  const meta = (await authorize.json()) as UploadedExperimentFile
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

/** The first lines of a file's extracted text, for the inspector preview. */
export function previewLines(text: string | null, count = 6): string[] {
  if (!text) return []
  return text.split(/\r?\n/).slice(0, count)
}
