/**
 * DSET-05 — server-side import flow handlers (store → recognise → map →
 * review → commit).
 *
 * The browser never parses the file. Bytes are streamed into object storage,
 * recorded with their sha256 before parsing, then parsed, mapped and reviewed
 * here. Commit goes through `api.commit_dataset_import`, which wraps the one
 * canonical Dataset batch writer and takes exactly one snapshot.
 */
import { createHash } from 'node:crypto'
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
  selectImportSheet,
  sniffImportFormat,
} from '#/lib/import-parse'
import type { ImportPreview, ImportSheet } from '#/lib/import-parse'
import { describeImportRpcCode } from '#/lib/import-commit'
import { importHeaderUnit, mapImportSheet } from '#/lib/import-mapping'
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
import type { SessionAuthContext, SessionAuthDeps } from '#/lib/request-auth'
import { recordParserFailure } from './parser-governance.server'
import { z } from 'zod'
import { IMPORT_PARSERS, recogniseImportParser } from './parsers'
import type { ImportParserDefinition } from './parsers'
import type {
  ImportColumnView,
  ImportFileUploadResponse,
  ImportMappingDocument,
  ImportParserSummary,
} from './types'

const SAMPLE_ROWS = 8
const REVIEW_SAMPLE_LIMIT = 20

function asRow<T>(body: T | { error: unknown }): T | undefined {
  if (Array.isArray(body)) return (body as T[])[0]
  return body as T
}

/**
 * PostgREST returns a RAISE EXCEPTION as `{ code, message, details, hint }`,
 * where `code` is the SQLSTATE or the function's `SBxxx`. Its `message` names
 * the cause that actually applied, so commit rejections surface it instead of
 * a canned sentence that may be false for this Dataset.
 */
function raisedRpcError(
  body: unknown,
): { code: string; message: string } | undefined {
  const record = Array.isArray(body) ? body[0] : body
  if (!record || typeof record !== 'object') return undefined
  const value = record as Record<string, unknown>
  if (typeof value.code === 'string' && typeof value.message === 'string')
    return { code: value.code, message: value.message }
  if (typeof value.error === 'string' && value.error.trim())
    return { code: 'rpc_error', message: value.error }
  return undefined
}

/**
 * The retained file's parser receipt must name the same cause the RPC raised,
 * not a fixed "regulated Dataset" sentence. `SB107` covers three distinct
 * parser causes; each maps to its own receipt.
 */
function parserFailureForRaisedError(error: {
  code: string
  message: string
}): { code: string; message: string } | undefined {
  if (error.code !== 'SB107') return undefined
  if (error.message.includes('approved parser version'))
    return {
      code: 'parser_not_approved',
      message:
        'The regulated Dataset requires an approved matching parser version. Validate and approve this version before retrying.',
    }
  if (error.message.includes('format does not match'))
    return {
      code: 'parser_format_mismatch',
      message:
        'The parser does not match the retained file format. Choose a parser for this format before retrying.',
    }
  return {
    code: 'parser_unrecognised',
    message:
      'The retained file does not match a usable registered parser version. Review its headers or register a matching version before retrying.',
  }
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
      ? {
          source: entry.source,
          kind: 'field',
          field,
          sourceUnit: entry.sourceUnit,
        }
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

export function toTargetFields(fields: FieldWire[]): ImportTargetField[] {
  return fields.map((field) => ({
    id: field.field_id,
    key: field.field_id,
    label: field.label,
    logicalType: field.logical_type,
    nullable: field.nullable,
    unit: fieldUnit(field.quantity),
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

export async function loadDataset(
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
  sheetName?: string | null,
): Promise<{ sheet: ImportSheet; preview: ImportPreview }> {
  if (!file.storage_key.startsWith(`${file.workspace_id}/`))
    throw new Error(
      'Retained file storage identity does not match the workspace.',
    )
  const { stream, byteSize } = await storage.getStream(file.storage_key)
  if (byteSize > IMPORT_LIMITS.bytes || byteSize !== Number(file.byte_size)) {
    await stream.cancel()
    throw new Error('Retained file size does not match its recorded evidence.')
  }
  const bytes = await new Response(stream).arrayBuffer()
  if (
    bytes.byteLength !== Number(file.byte_size) ||
    createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !==
      file.checksum
  )
    throw new Error(
      'Retained file checksum does not match its recorded evidence.',
    )
  const preview = await parseImportBytes(bytes, {
    fileName: file.filename,
    format: sniffImportFormat(file.filename),
  })
  const sheet = selectImportSheet(preview, sheetName ?? undefined)
  return { sheet, preview }
}

function parserByKey(
  key: string | null | undefined,
): ImportParserDefinition | null {
  if (!key) return null
  return IMPORT_PARSERS.find((parser) => parser.key === key) ?? null
}

const canonicalReaderSchema = z.object({
  id: z.uuid(),
  parser_id: z.uuid(),
  version: z.number(),
  status: z.enum(['draft', 'validated', 'approved', 'retired']),
  signature: z.object({
    requiredHeaders: z.array(z.string()),
    optionalHeaders: z.array(z.string()).optional(),
    requiresMetadata: z.boolean().optional(),
  }),
  parsers: z.object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    format: z.enum(['csv', 'tsv', 'xlsx', 'json']),
  }),
})

/** Only structural definitions use this file reader; connector engine IDs are
 * executed by their connector, never relabelled as the generic import reader. */
async function canonicalReaders(token: string, versionId?: string) {
  const response = await postgrestSelect<unknown[]>(
    'parser_versions',
    `${versionId ? `id=eq.${encodeURIComponent(versionId)}&` : ''}status=neq.retired&select=id,parser_id,version,status,signature,parsers(id,key,name,format)&order=version.desc`,
    token,
  )
  return (Array.isArray(response.body) ? response.body : []).flatMap((row) => {
    const parsed = canonicalReaderSchema.safeParse(row)
    if (
      !parsed.success ||
      (typeof row === 'object' &&
        row !== null &&
        'signature' in row &&
        typeof row.signature === 'object' &&
        row.signature !== null &&
        'engine' in row.signature)
    )
      return []
    const version = parsed.data
    const base = parserByKey(version.parsers.key)
    const definition: ImportParserDefinition = {
      ...(base ?? { plannedKeyHeaders: [], controlPattern: '' }),
      key: version.parsers.key,
      label: version.parsers.name,
      format: version.parsers.format,
      version: version.version,
      status: 'approved',
      signature: version.signature,
    }
    const summary: ImportParserSummary = {
      key: definition.key,
      label: definition.label,
      format: definition.format,
      version: version.version,
      status: version.status,
      confidence: 1,
      parserId: version.parser_id,
      parserVersionId: version.id,
    }
    return [{ definition, summary }]
  })
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

/**
 * The stored-file view shared by the upload response and the addressable
 * re-read. Both derive it from the retained bytes, so a reloaded map/check step
 * sees exactly what the upload saw. A re-read passes `record: false`: parse
 * status and parser-failure receipts belong to the upload, not to every reload
 * of a linked import.
 */
async function buildFileView(
  context: SessionAuthContext,
  storage: ObjectStorage,
  file: ImportFileWire,
  datasetId: string | null,
  options: { record: boolean; sheetName?: string },
): Promise<ImportFileUploadResponse> {
  const base = {
    ok: true,
    fileId: file.id,
    filename: file.filename,
    mediaType: file.media_type,
    byteSize: Number(file.byte_size),
    checksum: file.checksum,
    format: file.format,
    datasetId,
  }
  let sheet: ImportSheet | null = null
  let preview: ImportPreview | null = null
  let parseError: string | undefined
  try {
    const parsed = await readAndParse(storage, file, options.sheetName)
    sheet = parsed.sheet
    preview = parsed.preview
  } catch (error) {
    parseError =
      error instanceof Error ? error.message : 'Could not parse file.'
    if (options.record) {
      await postgrestRpc(
        'record_dataset_import_file_parse',
        { p_file_id: file.id, p_status: 'failed', p_error: parseError },
        context.token,
      )
      await recordParserFailure(
        context,
        file.id,
        null,
        'parse_failed',
        parseError,
      )
    }
  }

  if (!sheet || !preview || parseError) {
    return {
      ...base,
      parsed: false,
      parseError,
      parser: null,
      sheet: null,
      savedMapping: null,
    }
  }

  const parsers = await ensureParsers(context.token, context.workspaceId)
  const canonical = await canonicalReaders(context.token)
  const rawTextHint =
    file.format === 'xlsx' ? null : await readHeadText(storage, file)
  const recognitionInput = {
    format: sniffImportFormat(file.filename),
    headers: sheet.headers,
    rawTextHint,
  }
  const recognisedCanonical = canonical.find(
    (reader) =>
      reader.summary.status === 'approved' &&
      recogniseImportParser(recognitionInput, [reader.definition]),
  )
  const recognition = recognisedCanonical
    ? null
    : recogniseImportParser(recognitionInput)
  let parser: ImportParserSummary | null = null
  if (recognisedCanonical) {
    parser = recognisedCanonical.summary
  } else if (recognition) {
    const summary = parsers.get(recognition.key)
    if (summary) parser = { ...summary, confidence: recognition.confidence }
  }
  if (!parser && options.record)
    await recordParserFailure(
      context,
      file.id,
      null,
      'parser_unrecognised',
      'The retained file does not match a registered parser. Review its headers or create a matching version.',
    )

  if (options.record)
    await postgrestRpc(
      'record_dataset_import_file_parse',
      { p_file_id: file.id, p_status: 'parsed' },
      context.token,
    )

  const savedMapping = parser
    ? await loadSavedMapping(context.token, parser.parserId, datasetId)
    : null
  const draftParsers = canonical
    .filter(
      (reader) =>
        reader.definition.format === file.format &&
        reader.summary.status !== 'approved',
    )
    .map((reader) => reader.summary)
  const shippedDrafts = IMPORT_PARSERS.filter(
    (item) => item.format === file.format && item.status === 'draft',
  ).flatMap((item) => {
    const summary = parsers.get(item.key)
    return summary ? [summary] : []
  })
  const draftOptions = draftParsers.length ? draftParsers : shippedDrafts
  // Never print the found headers as the expected example: that is the reason
  // recognition failed, not guidance. Name the drafts a matching file would
  // need approved, or say that only approved versions recognise a file.
  const foundHeaders = sheet.headers.slice(0, 6).join(', ')
  const draftReason = draftOptions.length
    ? ` ${draftOptions
        .map((item) => `${item.label} v${item.version}`)
        .join(', ')} ${
        draftOptions.length === 1 ? 'is a draft' : 'are drafts'
      }, so ${
        draftOptions.length === 1 ? 'it is' : 'they are'
      } not used until an admin approves ${
        draftOptions.length === 1 ? 'that version' : 'one'
      }.`
    : ' Only approved parser versions are used for recognition.'

  return {
    ...base,
    parsed: true,
    parser,
    draftParsers: draftOptions,
    recognitionMessage: parser
      ? `Recognised as ${parser.label} v${parser.version}.`
      : `This file's headers (${foundHeaders}) match no approved parser.${draftReason}`,
    sheet: {
      name: sheet.name,
      headers: sheet.headers,
      sampleRows: sheet.rows.slice(0, SAMPLE_ROWS),
      rowCount: sheet.rows.length,
      sheetNames: preview.sheets.map((item) => item.name),
    },
    savedMapping,
  }
}

/**
 * GET /api/import/files?fileId=… — re-derive the stored import view so the
 * map/check step is reloadable and linkable (R5-SURF-04). The URL identifies
 * the stored import file, the stable identity `commit_dataset_import` pins
 * (`p_file_id`); the file name is not an identity. Read-only, and the caller's
 * workspace scopes the lookup: an unknown or foreign id is a plain not-found.
 */
export async function handleImportFileRead(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'GET') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const params = new URL(request.url).searchParams
  const fileId = params.get('fileId')
  if (!fileId) {
    return requestErrorResponse(400, 'invalid_request', 'fileId is required.')
  }
  const file = await loadStoredFile(context.token, fileId)
  if (!file || file.workspace_id !== context.workspaceId) {
    return requestErrorResponse(404, 'not_found', 'Import not found.')
  }
  const datasetId = params.get('datasetId') ?? file.dataset_id
  return Response.json(
    await buildFileView(context, storage, file, datasetId, {
      record: false,
      sheetName: params.get('sheetName') ?? undefined,
    }),
  )
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

  return Response.json(
    await buildFileView(context, storage, file, datasetId, { record: true }),
  )
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

const mappingSchema = z.object({
  sources: z.array(
    z.object({
      source: z.string(),
      fieldId: z.string().nullable(),
      unit: z.string().nullable(),
      sourceUnit: z.string().nullable().optional(),
    }),
  ),
  sheetName: z.string().min(1).optional(),
})

async function prepareImport(
  context: { workspaceId: string; token: string },
  storage: ObjectStorage,
  input: {
    fileId: string
    datasetId: string
    mapping: ImportMappingDocument
    sheetName?: string | null
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
  const parsedMapping = mappingSchema.safeParse(input.mapping)
  if (!parsedMapping.success)
    return {
      error: requestErrorResponse(
        400,
        'invalid_mapping',
        'Choose valid source columns, fields and units.',
      ),
    }
  if (
    input.sheetName &&
    parsedMapping.data.sheetName &&
    input.sheetName !== parsedMapping.data.sheetName
  ) {
    return {
      error: requestErrorResponse(
        422,
        'worksheet_mismatch',
        'The worksheet and mapping disagree. Choose the worksheet again.',
      ),
    }
  }
  let sheet: ImportSheet
  try {
    const selected = input.sheetName ?? parsedMapping.data.sheetName
    const parsed = await readAndParse(storage, file, selected)
    if (!selected && parsed.preview.sheets.length > 1) {
      return {
        error: requestErrorResponse(
          422,
          'worksheet_required',
          'Choose a worksheet before reviewing or importing this workbook.',
        ),
      }
    }
    sheet = parsed.sheet
  } catch (error) {
    return {
      error: requestErrorResponse(
        422,
        'parse_failed',
        error instanceof Error
          ? error.message
          : 'Could not read the worksheet.',
      ),
    }
  }
  const fields = new Set(loaded.fields.map((field) => field.field_id))
  if (
    parsedMapping.data.sources.some(
      (entry) =>
        !sheet.headers.includes(entry.source) ||
        (entry.fieldId && !fields.has(entry.fieldId)),
    )
  ) {
    return {
      error: requestErrorResponse(
        422,
        'invalid_mapping',
        'The mapping does not match this worksheet and Dataset. Map the columns again.',
      ),
    }
  }
  return {
    file,
    dataset: loaded.dataset,
    fields: loaded.fields,
    sheet,
    mapping: {
      ...parsedMapping.data,
      sheetName: sheet.name,
      sources: parsedMapping.data.sources.map((entry) => ({
        ...entry,
        unit: fieldUnit(
          loaded.fields.find((field) => field.field_id === entry.fieldId)
            ?.quantity,
        ),
        sourceUnit: entry.sourceUnit?.trim() || importHeaderUnit(entry.source),
      })),
    },
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
    parserVersionId?: string | null
    sheetName?: string | null
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
    sheetName: body.sheetName,
  })
  if ('error' in prepared) return prepared.error

  const selectedReader = body.parserVersionId
    ? (await canonicalReaders(context.token, body.parserVersionId)).at(0)
    : undefined
  const parser = selectedReader?.definition ?? parserByKey(body.parserKey)
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
    sheetName?: string | null
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
    sheetName: body.sheetName,
  })
  if ('error' in prepared) return prepared.error

  const selectedReader = body.parserVersionId
    ? (await canonicalReaders(context.token, body.parserVersionId)).at(0)
    : undefined
  const parser = selectedReader?.definition ?? parserByKey(body.parserKey)
  if (
    (body.parserKey && !parser) ||
    (selectedReader &&
      body.parserKey &&
      body.parserKey !== selectedReader.definition.key)
  ) {
    return requestErrorResponse(
      422,
      'parser_required',
      'Choose a registered parser version.',
    )
  }
  // Manual mapping is a parser too: the generic format reader plus the
  // mapping frozen in the receipt. It never bypasses regulated approval.
  const registered = selectedReader
    ? { status: 200, body: selectedReader.summary }
    : await postgrestRpc<{
        parserId: string
        parserVersionId: string
      }>(
        'ensure_parser',
        {
          p_workspace_id: context.workspaceId,
          p_key: parser?.key ?? `sheetbase.manual-${prepared.file.format}`,
          p_name:
            parser?.label ??
            `Manual ${prepared.file.format.toUpperCase()} mapping`,
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
    // A raised RPC names the cause that actually applied; collapsing every
    // failure into one sentence reports a cause that may be false for this
    // Dataset (DSET-06.2). Surface the raised message and keep any parser
    // receipt in step with the cause that was actually raised.
    const raised =
      committed.status >= 400 ? raisedRpcError(committed.body) : undefined
    if (raised) {
      const failure = parserFailureForRaisedError(raised)
      if (failure) {
        await recordParserFailure(
          context,
          prepared.file.id,
          parserVersionId,
          failure.code,
          failure.message,
        )
      }
      return Response.json({
        ok: false,
        committed: 0,
        errors: [{ code: 'commit_failed', message: raised.message }],
      })
    }
    const errors = (result?.errors ?? []).map((error) => ({
      row: error.rowIndex,
      code: error.code,
      message: describeImportRpcCode(error.code),
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
                message: 'The import was rejected. The file is kept for retry.',
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
