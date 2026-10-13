/**
 * DSET-05 — browser data module for the import flow. Thick file work (store,
 * parse, review, commit) runs on the server at /api/import/*; the browser only
 * sends the mapped document and reads back previews and counts.
 */
import type { DataClient } from '#/lib/data-client'
import { createDataset } from '#/lib/dataset-product'
import type {
  DatasetImportRecord,
  ImportCommitResponse,
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportReviewResponse,
} from './types'

export const importQueryKeys = {
  imports: (datasetId: string) => ['import', 'records', datasetId] as const,
  file: (fileId: string) => ['import', 'file', fileId] as const,
}

/**
 * A failed import request with the server's own code, so a caller can tell a
 * plain not-found (an unknown or foreign import id) from a real failure.
 */
export class ImportRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ImportRequestError'
    this.status = status
    this.code = code
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null
  if (!response.ok) {
    throw new ImportRequestError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? `Import request failed (${response.status}).`,
    )
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

/**
 * R5-SURF-04 — reload one stored import from its id. The id is the retained
 * import file (`dataset_import_files`), the same identity the commit path pins
 * as `p_file_id`; the server re-parses the retained bytes, so a reloaded
 * map/check step sees exactly what the upload saw.
 */
export async function fetchImportFile(input: {
  fileId: string
  datasetId?: string | null
}): Promise<ImportFileUploadResponse> {
  const query = new URLSearchParams({ fileId: input.fileId })
  if (input.datasetId) query.set('datasetId', input.datasetId)
  const response = await fetch(`/api/import/files?${query.toString()}`)
  return readJson<ImportFileUploadResponse>(response)
}

export type ImportTargetChoice =
  | { mode: 'append'; datasetId: string }
  | {
      mode: 'new'
      workspaceId: string
      schemaVersionId: string
      name: string
      /** The signed-in person the new Dataset is attributed to. */
      createdByUserId?: string | null
    }

/**
 * R5-SURF-04 — resolve what the import writes into: an existing Dataset, or a
 * new Dataset created through the canonical catalogue insert (the same path the
 * connector ingestion uses, and the same one `createDataset` already exposes).
 * Both branches hand the commit path a plain Dataset id, so the import receipt
 * and the snapshot are produced by one implementation and carry one provenance.
 */
export async function resolveImportTarget(
  client: DataClient,
  choice: ImportTargetChoice,
): Promise<{ datasetId: string; created: boolean }> {
  if (choice.mode === 'append') {
    if (!choice.datasetId) throw new Error('Choose a Dataset to import into.')
    return { datasetId: choice.datasetId, created: false }
  }
  const name = choice.name.trim()
  if (!name) throw new Error('Name the new Dataset.')
  if (!choice.schemaVersionId) {
    throw new Error('Choose the Model the new Dataset is built on.')
  }
  const created = await createDataset(client, {
    workspaceId: choice.workspaceId,
    schemaVersionId: choice.schemaVersionId,
    name,
    createdByUserId: choice.createdByUserId ?? null,
  })
  return { datasetId: created.id, created: true }
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
