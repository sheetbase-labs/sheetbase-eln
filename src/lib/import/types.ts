/**
 * DSET-05 — shared wire types for the import flow (browser ↔ /api/import).
 * Field names stay snake_case where they mirror a database row (conventions).
 */

export type ImportRowOutcome = 'planned' | 'new' | 'flagged' | 'skipped'

export interface ImportValueFlag {
  fieldId: string
  kind: string
  reason: string
}

export interface ImportMappingEntry {
  source: string
  fieldId: string | null
  unit: string | null
}

/** The saved/shared mapping document stored on `api.parser_mappings`. */
export interface ImportMappingDocument {
  sources: ImportMappingEntry[]
}

export interface ImportParserSummary {
  key: string
  label: string
  format: string
  version: number
  confidence: number
  parserId: string
  parserVersionId: string
  status: string
}

export interface ImportColumnView {
  source: string
  fieldId: string | null
  fieldLabel: string | null
  unit: string | null
  examples: string[]
  status: 'mapped' | 'skipped' | 'unmapped'
  note: string
}

export interface ImportSheetPreview {
  name: string
  headers: string[]
  sampleRows: Array<Record<string, string>>
  rowCount: number
  sheetNames: string[]
}

export interface ImportFileUploadResponse {
  ok: boolean
  fileId: string
  filename: string
  mediaType: string | null
  byteSize: number
  checksum: string
  format: string
  parsed: boolean
  parseError?: string
  parser: ImportParserSummary | null
  /** Draft parsers of the same format, offered when nothing was recognised. */
  draftParsers?: ImportParserSummary[]
  /** Recognition failed: why the file did not match a registered parser. */
  recognitionMessage?: string
  sheet: ImportSheetPreview | null
  savedMapping: ImportMappingDocument | null
}

export interface ImportReviewResponse {
  ok: boolean
  expectedRevision: number
  schemaVersionId: string
  summary: {
    total: number
    added: number
    planned: number
    new: number
    flagged: number
    skipped: number
  }
  /** Flags first, capped — the whole outcome set never reaches the browser. */
  rows: Array<{
    index: number
    outcome: ImportRowOutcome
    plannedKey: string | null
    plannedRowId: string | null
    flags: ImportValueFlag[]
    values: Record<string, string>
  }>
  columns: ImportColumnView[]
  errors: Array<{ row?: number; code: string; message: string }>
}

export interface ImportCommitResponse {
  ok: boolean
  committed: number
  importId?: string
  snapshotVersionId?: string
  datasetRevision?: number
  outcome?: Record<string, number>
  errors: Array<{ row?: number; code: string; message: string }>
}

export interface DatasetImportRecord {
  id: string
  dataset_id: string
  experiment_record_id: string | null
  parser_id: string | null
  parser_version_id: string | null
  file_id: string | null
  connector_run_id: string | null
  imported_row_ids: string[]
  parser_provenance: Record<string, unknown>
  source_provenance: Record<string, unknown>
  outcome: Record<string, unknown>
  snapshot_version_id: string | null
  status: string
  error_detail: string | null
  created_at: string
}

/** The source header whose value marks a control row, for the review step. */
export interface ImportControlHint {
  header: string
  pattern: string
}
