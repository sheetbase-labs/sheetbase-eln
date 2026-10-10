/**
 * DSET-05 — browser data module for the import flow. Thick file work (store,
 * parse, review, commit) runs on the server at /api/import/*; the browser only
 * sends the mapped document and reads back previews and counts.
 */
import type { DataClient } from '#/lib/data-client'
import type {
  DatasetImportRecord,
  ImportCommitResponse,
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportReviewResponse,
} from './types'

export const importQueryKeys = {
  imports: (datasetId: string) => ['import', 'records', datasetId] as const,
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null
  if (!response.ok) {
    const message =
      body?.error?.message ?? `Import request failed (${response.status}).`
    throw new Error(message)
  }
  if (!body) throw new Error('Import request returned no body.')
  return body
}

/** Store the raw file (checksum first), parse it and recognise a parser. */
export async function uploadImportFile(input: {
  file: File
  datasetId?: string | null
}): Promise<ImportFileUploadResponse> {
  const query = input.datasetId
    ? `?datasetId=${encodeURIComponent(input.datasetId)}`
    : ''
  const response = await fetch(`/api/import/files${query}`, {
    method: 'POST',
    headers: {
      'content-type': input.file.type || 'application/octet-stream',
      'x-import-filename': encodeURIComponent(input.file.name),
    },
    body: input.file,
  })
  return readJson<ImportFileUploadResponse>(response)
}

/** Compute planned/new/flagged/skipped outcomes without writing anything. */
export async function reviewImport(input: {
  fileId: string
  datasetId: string
  mapping: ImportMappingDocument
  parserKey?: string | null
  parserVersionId?: string | null
  sheetName?: string | null
}): Promise<ImportReviewResponse> {
  const response = await fetch('/api/import/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return readJson<ImportReviewResponse>(response)
}

/** Commit through the canonical batch writer + one snapshot + one receipt. */
export async function commitImport(input: {
  fileId: string
  datasetId: string
  mapping: ImportMappingDocument
  parserKey?: string | null
  parserId?: string | null
  parserVersionId?: string | null
  experimentRecordId?: string | null
  instrumentId?: string | null
  sheetName?: string | null
  idempotencyKey: string
}): Promise<ImportCommitResponse> {
  const response = await fetch('/api/import/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return readJson<ImportCommitResponse>(response)
}

/** DSET-05.3 — save the mapping as the parser's default for this target. */
export async function saveParserMapping(
  client: DataClient,
  input: {
    parserId: string
    targetKey: string
    mapping: ImportMappingDocument
  },
): Promise<unknown> {
  return client.rpc('save_parser_mapping', {
    p_parser_id: input.parserId,
    p_target_key: input.targetKey,
    p_mapping: input.mapping,
  })
}

/** DSET-02.3 — one Dataset's import receipts. */
export async function fetchDatasetImports(
  client: DataClient,
  datasetId: string,
): Promise<DatasetImportRecord[]> {
  return client.rpc<DatasetImportRecord[]>('dataset_import_list', {
    p_dataset_id: datasetId,
  })
}
