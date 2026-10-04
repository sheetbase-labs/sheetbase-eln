/**
 * DSET-05 — server-side import flow handlers (store → recognise → map →
 * review → commit).
 *
 * The browser never parses the file. Bytes are streamed into object storage,
 * recorded with their sha256 before parsing, then parsed, mapped and reviewed
 * here. Commit goes through `api.commit_dataset_import`, which wraps the one
 * canonical Dataset batch writer and takes exactly one snapshot.
 */
import type { ObjectStorage } from '#/lib/file-storage'
import {
  generateStorageKey,
  getObjectStorage,
  newFileObjectId,
  OversizeError,
} from '#/lib/file-storage'
import {
  IMPORT_LIMITS,
  parseImportBytes,
  sniffImportFormat,
} from '#/lib/import-parse'
import type { ImportPreview, ImportSheet } from '#/lib/import-parse'
import { mapImportSheet } from '#/lib/import-mapping'
import type {
  ImportColumnMapping,
  ImportTargetField,
  MappedImport,
} from '#/lib/import-mapping'
import {
  postgrestRpc,
  postgrestSelect,
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'
import { IMPORT_PARSERS, recogniseImportParser } from './parsers'
import type { ImportParserDefinition } from './parsers'
import type {
  ImportColumnView,
  ImportMappingDocument,
  ImportParserSummary,
} from './types'

const SAMPLE_ROWS = 8
const REVIEW_SAMPLE_LIMIT = 20

function asRow<T>(body: T | { error: unknown }): T | undefined {
  if (Array.isArray(body)) return (body as T[])[0]
  return body as T
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

interface ImportFileWire {
  id: string
  workspace_id: string
  dataset_id: string | null
  filename: string
  media_type: string | null
  byte_size: string
  checksum: string
  storage_key: string
  format: string
  status: string
  parse_error: string | null
}

interface DatasetWire {
  id: string
  workspace_id: string
  schema_version_id: string
  revision: number
  lifecycle: string
}

interface FieldWire {
  field_id: string
  label: string
  logical_type: string
  nullable: boolean
  quantity: unknown
}

/** Map header→field selections onto the coercion layer's mapping shape. */
export function mappingsFromDocument(
  document: ImportMappingDocument,
  fields: ImportTargetField[],
): ImportColumnMapping[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  return document.sources.map((entry) => {
    const field = entry.fieldId ? byId.get(entry.fieldId) : undefined
    return field
      ? { source: entry.source, kind: 'field', field }
      : { source: entry.source, kind: 'ignore' }
  })
}

/** The planned key joins the parser's configured source headers, if present. */
export function plannedKeyFromRow(
  parser: ImportParserDefinition | null,
  row: Record<string, string>,
): string | undefined {
  if (!parser || parser.plannedKeyHeaders.length === 0) return undefined
  const parts = parser.plannedKeyHeaders
    .map((header) => (row[header] ?? '').trim())
    .filter((value) => value.length > 0)
  return parts.length > 0 ? parts.join('/').slice(0, 200) : undefined
}

function fieldUnit(quantity: unknown): string | null {
  if (!quantity || typeof quantity !== 'object') return null
  const record = quantity as Record<string, unknown>
  const unit = record.storageUnit ?? record.symbol ?? record.unit
  return typeof unit === 'string' && unit.trim() ? unit.trim() : null
}

function toTargetFields(fields: FieldWire[]): ImportTargetField[] {
  return fields.map((field) => ({
    id: field.field_id,
    key: field.field_id,
    label: field.label,
    logicalType: field.logical_type,
    nullable: field.nullable,
    options: [],
    kind: 'dataset-field' as const,
  }))
}

/** Column views for the map step: field, unit, examples and match status. */
export function buildColumnViews(
  document: ImportMappingDocument,
  sheet: ImportSheet,
  fields: ImportTargetField[],
  fieldQuantity: Map<string, unknown>,
): ImportColumnView[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  return document.sources.map((entry) => {
    const field = entry.fieldId ? byId.get(entry.fieldId) : undefined
    const values = sheet.rows
      .slice(0, 6)
      .map((row) => (row[entry.source] ?? '').trim())
      .filter((value) => value.length > 0)
    const matched = values.length
    return {
      source: entry.source,
      fieldId: field?.id ?? null,
      fieldLabel: field?.label ?? null,
      unit:
        entry.unit ?? (field ? fieldUnit(fieldQuantity.get(field.id)) : null),
      examples: values.slice(0, 3),
      status: field ? 'mapped' : 'skipped',
      note: field
        ? `Matched ${matched} of ${Math.min(sheet.rows.length, 6)}`
        : 'No matching field',
    }
  })
}

interface ReviewRpcRow {
  index: number
  outcome: 'planned' | 'new' | 'flagged' | 'skipped'
  plannedKey: string | null
  plannedRowId: string | null
  flags: Array<{ fieldId: string; kind: string; reason: string }>
}

/** Flags first, capped — the browser never receives every outcome row. */
export function sampleReviewRows(
  rows: ReviewRpcRow[],
  sheet: ImportSheet,
  limit = REVIEW_SAMPLE_LIMIT,
): Array<ReviewRpcRow & { values: Record<string, string> }> {
  const ranked = [...rows].sort((a, b) => {
    const weight = (row: ReviewRpcRow) => (row.flags.length > 0 ? 0 : 1)
    return weight(a) - weight(b) || a.index - b.index
  })
  return ranked.slice(0, limit).map((row) => ({
    ...row,
    values: sheet.rows[row.index - 1] ?? {},
  }))
}

async function loadDataset(
  token: string,
  datasetId: string,
): Promise<
  | { ok: true; dataset: DatasetWire; fields: FieldWire[] }
  | { ok: false; status: number; code: string; message: string }
> {
  const datasetRes = await postgrestSelect<DatasetWire[]>(
    'datasets',
    `id=eq.${encodeURIComponent(datasetId)}&select=id,workspace_id,schema_version_id,revision,lifecycle&limit=1`,
    token,
  )
  const dataset = Array.isArray(datasetRes.body)
    ? datasetRes.body[0]
    : undefined
  if (datasetRes.status >= 400 || !dataset) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Dataset not found.',
    }
  }
  const fieldsRes = await postgrestSelect<FieldWire[]>(
    'dataset_schema_version_fields',
    `schema_version_id=eq.${encodeURIComponent(dataset.schema_version_id)}&lifecycle=eq.active&select=field_id,label,logical_type,nullable,quantity&order=display_order.asc`,
    token,
  )
  const fields = Array.isArray(fieldsRes.body) ? fieldsRes.body : []
  return { ok: true, dataset, fields }
}

async function loadStoredFile(
  token: string,
  fileId: string,
): Promise<ImportFileWire | null> {
  const result = await postgrestSelect<ImportFileWire[]>(
    'dataset_import_files',
    `id=eq.${encodeURIComponent(fileId)}&select=id,workspace_id,dataset_id,filename,media_type,byte_size,checksum,storage_key,format,status,parse_error&limit=1`,
    token,
  )
  return Array.isArray(result.body) ? (result.body[0] ?? null) : null
}

async function readAndParse(
  storage: ObjectStorage,
  file: ImportFileWire,
): Promise<{ sheet: ImportSheet; preview: ImportPreview }> {
  const { stream } = await storage.getStream(file.storage_key)
  const bytes = await new Response(stream).arrayBuffer()
  const preview = await parseImportBytes(bytes, {
    fileName: file.filename,
    format: sniffImportFormat(file.filename),
  })
  const sheet = preview.sheets.at(0)
  if (!sheet) throw new Error('The file contains no data sheet.')
  return { sheet, preview }
}

function parserByKey(
  key: string | null | undefined,
): ImportParserDefinition | null {
  if (!key) return null
  return IMPORT_PARSERS.find((parser) => parser.key === key) ?? null
}

async function ensureParsers(
  token: string,
  workspaceId: string,
): Promise<Map<string, ImportParserSummary>> {
  const summaries = new Map<string, ImportParserSummary>()
  for (const parser of IMPORT_PARSERS) {
    const result = await postgrestRpc<{
      parserId: string
      parserVersionId: string
      status: string
    }>(
      'ensure_parser',
      {
        p_workspace_id: workspaceId,
        p_key: parser.key,
        p_name: parser.label,
        p_format: parser.format,
        p_version: parser.version,
        p_signature: parser.signature,
        p_mapping: {},
        p_status: 'draft',
      },
      token,
    )
    const body = asRow(result.body)
    if (result.status >= 400 || !body || !('parserId' in body)) continue
    summaries.set(parser.key, {
      key: parser.key,
      label: parser.label,
      format: parser.format,
      version: parser.version,
      confidence: 1,
      parserId: body.parserId,
      parserVersionId: body.parserVersionId,
      status: body.status,
    })
  }
  return summaries
}

/** POST /api/import/files — store (checksum first), parse, recognise. */
export async function handleImportFileUpload(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  let filename = 'import'
  const rawName = request.headers.get('x-import-filename')
  if (rawName) {
    try {
      filename = decodeURIComponent(rawName)
    } catch {
      filename = rawName
    }
  }
  filename = filename.slice(0, 400) || 'import'
  const mediaType = request.headers.get('content-type')
  const datasetId = new URL(request.url).searchParams.get('datasetId')
  const format = sniffImportFormat(filename)

  const storageKey = generateStorageKey(context.workspaceId, newFileObjectId())
  let stored: { byteSize: bigint; checksum: string }
  try {
    stored = await storage.putStream(
      storageKey,
      request.body ?? emptyStream(),
      IMPORT_LIMITS.bytes,
    )
  } catch (error) {
    if (error instanceof OversizeError) {
      return requestErrorResponse(
        413,
        'oversize',
        `The file exceeds the ${Math.round(IMPORT_LIMITS.bytes / (1024 * 1024))} MB import cap.`,
      )
    }
    throw error
  }

  const created = await postgrestRpc<ImportFileWire>(
    'create_dataset_import_file',
    {
      p_workspace_id: context.workspaceId,
      p_filename: filename,
      p_media_type: mediaType,
      p_byte_size: stored.byteSize.toString(),
      p_checksum: stored.checksum,
      p_storage_key: storageKey,
      p_format: format,
      p_dataset_id: datasetId,
    },
    context.token,
  )
  const file = asRow(created.body)
  if (created.status >= 400 || !file || !('id' in file)) {
    await storage.delete(storageKey)
    return requestErrorResponse(
      created.status >= 400 ? created.status : 502,
      'file_record_failed',
      'Could not record the import file.',
    )
  }

  let sheet: ImportSheet | null = null
  let preview: ImportPreview | null = null
  let parseError: string | undefined
  try {
    const parsed = await readAndParse(storage, file)
    sheet = parsed.sheet
    preview = parsed.preview
  } catch (error) {
    parseError =
      error instanceof Error ? error.message : 'Could not parse file.'
    await postgrestRpc(
      'record_dataset_import_file_parse',
      { p_file_id: file.id, p_status: 'failed', p_error: parseError },
      context.token,
    )
  }

  const base = {
    ok: true,
    fileId: file.id,
    filename,
    mediaType,
    byteSize: Number(stored.byteSize),
    checksum: stored.checksum,
    format,
  }

  if (!sheet || !preview || parseError) {
    return Response.json({
      ...base,
      parsed: false,
      parseError,
      parser: null,
      sheet: null,
      savedMapping: null,
    })
  }

  const parsers = await ensureParsers(context.token, context.workspaceId)
  const rawTextHint =
    format === 'xlsx' ? null : await readHeadText(storage, file)
  const recognition = recogniseImportParser({
    format,
    headers: sheet.headers,
    rawTextHint,
  })
  let parser: ImportParserSummary | null = null
  if (recognition) {
    const summary = parsers.get(recognition.key)
    if (summary) parser = { ...summary, confidence: recognition.confidence }
  }

  await postgrestRpc(
    'record_dataset_import_file_parse',
    { p_file_id: file.id, p_status: 'parsed' },
    context.token,
  )

  const savedMapping = parser
    ? await loadSavedMapping(context.token, parser.parserId, datasetId)
    : null
  const draftParsers = IMPORT_PARSERS.filter(
    (item) => item.format === format && item.status === 'draft',
  ).flatMap((item) => {
    const summary = parsers.get(item.key)
    return summary ? [summary] : []
  })

  return Response.json({
    ...base,
    parsed: true,
    parser,
    draftParsers,
    recognitionMessage: parser
      ? `Recognised as ${parser.label} v${parser.version}.`
      : `This file doesn't match a registered parser. Expected a header set such as sample, well (plate map) or sample, ntu, dil, timestamp (TB-02 CSV). Found ${sheet.headers.slice(0, 6).join(', ')}.`,
    sheet: {
      name: sheet.name,
      headers: sheet.headers,
      sampleRows: sheet.rows.slice(0, SAMPLE_ROWS),
      rowCount: sheet.rows.length,
      sheetNames: preview.sheets.map((item) => item.name),
    },
    savedMapping,
  })
}

async function readHeadText(
  storage: ObjectStorage,
  file: ImportFileWire,
): Promise<string> {
  const { stream } = await storage.getStream(file.storage_key)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  const cap = 256 * 1024
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= cap) {
      await reader.cancel()
      break
    }
  }
  const buffer = new Uint8Array(Math.min(size, cap))
  let offset = 0
  for (const chunk of chunks) {
    const room = buffer.byteLength - offset
    if (room <= 0) break
    buffer.set(chunk.subarray(0, Math.min(chunk.byteLength, room)), offset)
    offset += Math.min(chunk.byteLength, room)
  }
  return new TextDecoder().decode(buffer)
}

async function loadSavedMapping(
  token: string,
  parserId: string,
  datasetId: string | null,
): Promise<ImportMappingDocument | null> {
  if (!parserId || !datasetId) return null
  const result = await postgrestSelect<
    Array<{ mapping: ImportMappingDocument }>
  >(
    'parser_mappings',
    `parser_id=eq.${encodeURIComponent(parserId)}&target_key=eq.${encodeURIComponent(`dataset:${datasetId}`)}&is_default=eq.true&select=mapping&limit=1`,
    token,
  )
  if (!Array.isArray(result.body) || result.body.length === 0) return null
  return result.body[0]?.mapping ?? null
}

interface PreparedImport {
  file: ImportFileWire
  dataset: DatasetWire
  fields: FieldWire[]
  sheet: ImportSheet
  mapping: ImportMappingDocument
}

async function prepareImport(
  context: { workspaceId: string; token: string },
  storage: ObjectStorage,
  input: {
    fileId: string
    datasetId: string
    mapping: ImportMappingDocument
  },
): Promise<PreparedImport | { error: Response }> {
  const file = await loadStoredFile(context.token, input.fileId)
  if (!file || file.workspace_id !== context.workspaceId) {
    return {
      error: requestErrorResponse(404, 'not_found', 'Import file not found.'),
    }
  }
  const loaded = await loadDataset(context.token, input.datasetId)
  if (!loaded.ok) {
    return {
      error: requestErrorResponse(loaded.status, loaded.code, loaded.message),
    }
  }
  const { sheet } = await readAndParse(storage, file)
  return {
    file,
    dataset: loaded.dataset,
    fields: loaded.fields,
    sheet,
    mapping: input.mapping,
  }
}

function buildRows(
  prepared: PreparedImport,
  parser: ImportParserDefinition | null,
): { mapped: MappedImport; controlFieldId: string | null } {
  const targetFields = toTargetFields(prepared.fields)
  const mappings = mappingsFromDocument(prepared.mapping, targetFields)
  const mapped = mapImportSheet(
    prepared.sheet,
    mappings,
    prepared.dataset.schema_version_id,
  )
  mapped.rows = mapped.rows.map((row, index) => {
    const plannedKey = plannedKeyFromRow(
      parser,
      prepared.sheet.rows[index] ?? {},
    )
    return plannedKey ? { ...row, plannedKey } : row
  })
  let controlFieldId: string | null = null
  if (parser?.controlHeader) {
    const entry = prepared.mapping.sources.find(
      (source) => source.source === parser.controlHeader,
    )
    controlFieldId = entry?.fieldId ?? null
  }
  return { mapped, controlFieldId }
}

function commitRows(mapped: MappedImport) {
  return mapped.rows.map((row) => ({
    operation: 'create' as const,
    rowId: row.rowId,
    values: row.values,
    ...(row.plannedKey ? { plannedKey: row.plannedKey } : {}),
  }))
}

/** POST /api/import/review — server-side outcome computation, no writes. */
export async function handleImportReview(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  let body: {
    fileId?: string
    datasetId?: string
    mapping?: ImportMappingDocument
    parserKey?: string | null
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return requestErrorResponse(
      400,
      'invalid_body',
      'Request body must be JSON.',
    )
  }
  if (!body.fileId || !body.datasetId || !body.mapping) {
    return requestErrorResponse(
      400,
      'invalid_body',
      'fileId, datasetId and mapping are required.',
    )
  }
  const prepared = await prepareImport(context, storage, {
    fileId: body.fileId,
    datasetId: body.datasetId,
    mapping: body.mapping,
  })
  if ('error' in prepared) return prepared.error

  const parser = parserByKey(body.parserKey)
  const { mapped, controlFieldId } = buildRows(prepared, parser)
  if (mapped.errors.length > 0) {
    return Response.json({
      ok: false,
      expectedRevision: prepared.dataset.revision,
      schemaVersionId: prepared.dataset.schema_version_id,
      summary: {
        total: mapped.rows.length,
        added: 0,
        planned: 0,
        new: 0,
        flagged: 0,
        skipped: 0,
      },
      rows: [],
      columns: buildColumnViews(
        prepared.mapping,
        prepared.sheet,
        toTargetFields(prepared.fields),
        new Map(
          prepared.fields.map((field) => [field.field_id, field.quantity]),
        ),
      ),
      errors: mapped.errors.map((error) => ({
        row: error.row,
        code: error.code,
        message: error.message,
      })),
    })
  }

  const preview = await postgrestRpc<{
    ok: boolean
    rows: ReviewRpcRow[]
    summary: ImportReviewResponseSummary
  }>(
    'preview_dataset_import_rows',
    {
      p_dataset_id: prepared.dataset.id,
      p_rows: commitRows(mapped),
      p_control_field_id: controlFieldId,
      p_control_pattern: parser?.controlPattern ?? null,
    },
    context.token,
  )
  const previewBody = asRow(preview.body)
  if (preview.status >= 400 || !previewBody || !('rows' in previewBody)) {
    return requestErrorResponse(
      preview.status >= 400 ? preview.status : 502,
      'review_failed',
      'Could not compute the import outcomes.',
    )
  }

  return Response.json({
    ok: true,
    expectedRevision: prepared.dataset.revision,
    schemaVersionId: prepared.dataset.schema_version_id,
    summary: previewBody.summary,
    rows: sampleReviewRows(previewBody.rows, prepared.sheet),
    columns: buildColumnViews(
      prepared.mapping,
      prepared.sheet,
      toTargetFields(prepared.fields),
      new Map(prepared.fields.map((field) => [field.field_id, field.quantity])),
    ),
    errors: [],
  })
}

interface ImportReviewResponseSummary {
  total: number
  added: number
  planned: number
  new: number
  flagged: number
  skipped: number
}

/** POST /api/import/commit — canonical batch + one snapshot + one receipt. */
export async function handleImportCommit(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  let body: {
    fileId?: string
    datasetId?: string
    mapping?: ImportMappingDocument
    parserKey?: string | null
    parserId?: string | null
    parserVersionId?: string | null
    experimentRecordId?: string | null
    instrumentId?: string | null
    idempotencyKey?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return requestErrorResponse(
      400,
      'invalid_body',
      'Request body must be JSON.',
    )
  }
  if (
    !body.fileId ||
    !body.datasetId ||
    !body.mapping ||
    !body.idempotencyKey
  ) {
    return requestErrorResponse(
      400,
      'invalid_body',
      'fileId, datasetId, mapping and idempotencyKey are required.',
    )
  }
  const prepared = await prepareImport(context, storage, {
    fileId: body.fileId,
    datasetId: body.datasetId,
    mapping: body.mapping,
  })
  if ('error' in prepared) return prepared.error

  const parser = parserByKey(body.parserKey)
  if (body.parserKey && !parser) {
    return requestErrorResponse(
      422,
      'parser_required',
      'Choose a registered parser version.',
    )
  }
  // Manual mapping is a parser too: the generic format reader plus the
  // mapping frozen in the receipt. It never bypasses regulated approval.
  const registered = await postgrestRpc<{
    parserId: string
    parserVersionId: string
  }>(
    'ensure_parser',
    {
      p_workspace_id: context.workspaceId,
      p_key: parser?.key ?? `sheetbase.manual-${prepared.file.format}`,
      p_name:
        parser?.label ?? `Manual ${prepared.file.format.toUpperCase()} mapping`,
      p_format: prepared.file.format,
      p_version: parser?.version ?? 1,
      p_signature: parser?.signature ?? { manualMapping: true },
      p_status: 'draft',
    },
    context.token,
  )
  const registeredBody = asRow(registered.body)
  if (
    registered.status >= 400 ||
    !registeredBody ||
    !('parserId' in registeredBody)
  ) {
    return requestErrorResponse(
      422,
      'parser_required',
      'Could not register the parser. The file is kept for retry.',
    )
  }
  const { parserId, parserVersionId } = registeredBody
  if (
    (body.parserId && body.parserId !== parserId) ||
    (body.parserVersionId && body.parserVersionId !== parserVersionId)
  ) {
    return requestErrorResponse(
      422,
      'parser_mismatch',
      'The parser attribution does not match the reader used. The file is kept for retry.',
    )
  }
  const { mapped, controlFieldId } = buildRows(prepared, parser)
  if (mapped.errors.length > 0 || mapped.rows.length === 0) {
    return Response.json({
      ok: false,
      committed: 0,
      errors:
        mapped.errors.length > 0
          ? mapped.errors.map((error) => ({
              row: error.row,
              code: error.code,
              message: error.message,
            }))
          : [{ code: 'empty', message: 'No rows to import.' }],
    })
  }

  const preview = await postgrestRpc<{
    summary: ImportReviewResponseSummary
    rows: ReviewRpcRow[]
  }>(
    'preview_dataset_import_rows',
    {
      p_dataset_id: prepared.dataset.id,
      p_rows: commitRows(mapped),
      p_control_field_id: controlFieldId,
      p_control_pattern: parser?.controlPattern ?? null,
    },
    context.token,
  )
  const previewBody = asRow(preview.body)
  const outcome = previewBody?.summary
  // Controls (skipped) are shown in the review but never written: "skipped
  // (controls); nothing dropped silently" (DSET-05.4). The outcome index is
  // the 1-based position in the row list.
  const skipped = (previewBody?.rows ?? [])
    .filter((row) => row.outcome === 'skipped')
    .map((row) => row.index)
  const rowsToCommit = commitRows(mapped).filter(
    (_row, index) => !skipped.includes(index + 1),
  )
  if (rowsToCommit.length === 0) {
    return Response.json({
      ok: false,
      committed: 0,
      errors: [{ code: 'empty', message: 'No rows to import.' }],
    })
  }

  const committed = await postgrestRpc<{
    ok: boolean
    idempotent?: boolean
    importId?: string
    snapshotVersionId?: string
    datasetRevision?: number
    outcome?: Record<string, number>
    errors?: Array<{ code: string; rowIndex?: number }>
  }>(
    'commit_dataset_import',
    {
      p_dataset_id: prepared.dataset.id,
      p_expected_dataset_revision: prepared.dataset.revision,
      p_rows: rowsToCommit,
      p_idempotency_key: body.idempotencyKey,
      p_file_id: prepared.file.id,
      p_mapping: prepared.mapping,
      p_outcome: outcome ?? {},
      p_parser_id: parserId,
      p_parser_version_id: parserVersionId,
      p_experiment_record_id: body.experimentRecordId ?? null,
      p_instrument_id: body.instrumentId ?? null,
    },
    context.token,
  )
  const result = asRow(committed.body)
  if (committed.status >= 400 || !result || result.ok !== true) {
    const errors = (result?.errors ?? []).map((error) => ({
      row: error.rowIndex,
      code: error.code,
      message: error.code,
    }))
    return Response.json({
      ok: false,
      committed: 0,
      errors:
        errors.length > 0
          ? errors
          : [
              {
                code: 'commit_failed',
                message:
                  'The import was rejected. Regulated datasets require an approved parser version; the file is kept for retry.',
              },
            ],
    })
  }

  return Response.json({
    ok: true,
    committed: rowsToCommit.length,
    importId: result.importId,
    snapshotVersionId: result.snapshotVersionId,
    datasetRevision: result.datasetRevision,
    outcome: result.outcome ?? outcome,
    errors: [],
  })
}
