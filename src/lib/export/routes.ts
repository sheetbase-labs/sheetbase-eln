/**
 * DATA-02 export byte-route handlers.
 *
 * Same architecture as the SCI-003 file routes (`src/lib/file-routes.ts`):
 * thin TanStack Start wrappers delegate here with injected auth deps so tests
 * can stub sessions. All domain data flows through the same `/api/db`
 * boundary contracts — canonical RPCs (`query_dataset_rows`,
 * `query_dataset_version_rows`, `revision_evidence_package`) plus RLS-scoped
 * resource reads — never around them. Cross-workspace requests fail closed
 * as `404 not_found`; nothing about existence leaks. Every export writes a
 * provenance receipt into api.data_exports.
 */
import { z } from 'zod'
import {
  delimitedHeaderLine,
  delimitedRowLine,
  rowJsonObject,
  isExportFormat,
  xlsxDocument,
  buildExportMeta,
  LIVE_STATE_NOTE,
  VERSION_STATE_NOTE,
  PARQUET_MAX_ROWS,
} from './serializers'
import type { ExportField, ExportFormat, ExportRow } from './serializers'
import { parquetDocument } from './parquet'
import { buildEvidencePackage } from './evidence-package'
import { renderRevisionPdf } from './revision-pdf'
import {
  auditEventMatchesCategory,
  auditEventsCsv,
  auditEventsPageSchema,
  auditEventsRpcArgs,
  auditHistoryCategories,
} from '../audit-history'
import type { AuditEventWire } from '../audit-history'

import {
  recordDataExportReceipt,
  requestErrorResponse,
  resolveSessionAuth,
  postgrestRpc,
  postgrestSelect,
} from '../request-auth'
import type { SessionAuthContext, SessionAuthDeps } from '../request-auth'

const PAGE_SIZE = 1000

interface DatasetWire {
  id: string
  workspace_id: string
  name: string
  description: string | null
  lifecycle: string
  revision: number | string
  schema_version_id: string
}

interface SchemaFieldWire {
  field_id: string
  key: string
  label: string
  logical_type: string
  nullable: boolean
  quantity: { kind?: string; dimension?: string; storageUnit?: string } | null
}

interface QueryRowsResult {
  rows: Array<{
    rowId: string
    revision: number | string
    values: Record<string, unknown>
  }>
  totalCount?: number
  hasMore?: boolean
}

function exportResponse(
  body: BodyInit,
  contentType: string,
  filename: string,
): Response {
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}

async function insertReceipt(input: {
  workspaceId: string
  actorUserId: string
  objectType:
    'dataset' | 'dataset_version' | 'sheet_instance' | 'record' | 'revision'
  objectId: string
  format: string
  rowCount?: number | null
  byteSize?: number | null
}): Promise<void> {
  // Receipt persistence is part of the successful-export contract (review
  // Option A): if the audit record cannot be written, the export fails. The
  // writer is server-only — /api/db has no path to api.data_exports.
  await recordDataExportReceipt(input)
}

/**
 * Stream rendered rows to the response and persist the audit receipt only
 * after the stream completes successfully. Any failure before completion
 * errors the response without a receipt, so `data_exports` never records an
 * export that did not finish. A receipt failure after the bytes were delivered
 * propagates as a stream error (the export is treated as failed).
 */
function streamedRows(args: {
  objectType: 'dataset' | 'dataset_version' | 'sheet_instance'
  target: { workspaceId: string; objectId: string }
  format: string
  filename: string
  contentType: string
  context: SessionAuthContext
  rows: AsyncIterable<ExportRow>
  renderHeader?: () => string | null
  renderRow: (row: ExportRow, isFirst: boolean) => string
  renderFooter?: () => string | null
}): Response {
  const encoder = new TextEncoder()
  let exportedRows = 0
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const header = args.renderHeader?.()
        if (header !== null && header !== undefined) {
          controller.enqueue(encoder.encode(header))
        }
        let isFirst = true
        for await (const row of args.rows) {
          controller.enqueue(encoder.encode(args.renderRow(row, isFirst)))
          isFirst = false
          exportedRows += 1
        }
        const footer = args.renderFooter?.()
        if (footer !== null && footer !== undefined) {
          controller.enqueue(encoder.encode(footer))
        }
        controller.close()
        closed = true
      } catch (error) {
        if (!closed) controller.error(error)
        throw error
      }
      // Receipt persistence happens strictly after a successful close.
      await insertReceipt({
        actorUserId: args.context.userId,
        workspaceId: args.target.workspaceId,
        objectType: args.objectType,
        objectId: args.target.objectId,
        format: args.format,
        rowCount: exportedRows,
      })
    },
  })
  return exportResponse(stream, args.contentType, args.filename)
}

// ---------------------------------------------------------------------------
// Shared dataset / dataset-version pipeline.
// ---------------------------------------------------------------------------

interface DatasetTarget {
  workspaceId: string
  objectId: string
  name: string
  description: string | null
  lifecycle: string
  sourceRevision: number | string
  schemaVersionId: string
  kind: 'sheetbase.dataset.export' | 'sheetbase.dataset-version.export'
  state: 'live' | 'version'
  versionInfo?: {
    datasetVersionId: string
    sourceDatasetRevision: number | string
    label: string
    schemaVersionId: string
  }
}

async function loadDatasetFields(
  token: string,
  schemaVersionId: string,
): Promise<ExportField[]> {
  const res = await postgrestSelect<SchemaFieldWire[]>(
    'dataset_schema_version_fields',
    `schema_version_id=eq.${schemaVersionId}&lifecycle=eq.active&order=display_order.asc&select=field_id,key,label,logical_type,nullable,quantity`,
    token,
  )
  if (res.status >= 400 || !Array.isArray(res.body)) return []
  return res.body.map((f) => ({
    id: f.field_id,
    key: f.key,
    label: f.label,
    logicalType: f.logical_type,
    nullable: f.nullable,
    unit: f.quantity?.storageUnit ?? null,
  }))
}

/**
 * Stream pages of the canonical query RPC into a line renderer. Memory stays
 * bounded by one page of rows; CSV/TSV/JSON/NDJSON never materialise fully.
 */
function isQueryRowsResult(value: unknown): value is QueryRowsResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as QueryRowsResult).rows)
  )
}

function pagedRows(
  rpcName: string,
  args: Record<string, unknown>,
  token: string,
): { rows: AsyncIterable<ExportRow>; totalCount: () => number | null } {
  let totalCount: number | null = null

  async function* iterate(): AsyncIterable<ExportRow> {
    let offset = 0
    for (;;) {
      const page = await postgrestRpc<QueryRowsResult>(
        rpcName,
        { ...args, p_offset: offset, p_limit: PAGE_SIZE },
        token,
      )
      const body =
        page.status < 400 && isQueryRowsResult(page.body) ? page.body : null
      if (!body) break
      if (totalCount === null) {
        totalCount = body.totalCount === undefined ? 0 : Number(body.totalCount)
      }
      for (const row of body.rows) yield row
      offset += PAGE_SIZE
      if (!body.hasMore && body.rows.length < PAGE_SIZE) break
      if (body.totalCount !== undefined && offset >= Number(body.totalCount))
        break
    }
  }

  return { rows: iterate(), totalCount: () => totalCount }
}

export async function handleDatasetExport(
  request: Request,
  datasetId: string,
  deps: SessionAuthDeps,
  variant: 'live' | 'version' = 'live',
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok) {
    return requestErrorResponse(auth.status, auth.code, auth.message)
  }
  const { context } = auth

  const url = new URL(request.url)
  const formatParam = url.searchParams.get('format') ?? 'csv'
  if (!isExportFormat(formatParam)) {
    return requestErrorResponse(400, 'invalid_format', 'Unknown export format.')
  }
  const format: ExportFormat = formatParam

  let dataset: DatasetWire | null = null
  if (variant === 'live') {
    // Metadata is read through the same RLS the rest of the app uses, so an
    // inaccessible dataset looks exactly like a missing one (404, no leak).
    const datasetRes = await postgrestSelect<DatasetWire[]>(
      'datasets',
      `id=eq.${encodeURIComponent(datasetId)}&select=id,workspace_id,name,description,lifecycle,revision,schema_version_id&limit=1`,
      context.token,
    )
    const list = Array.isArray(datasetRes.body) ? datasetRes.body : []
    if (datasetRes.status >= 400) {
      return requestErrorResponse(
        502,
        'upstream_error',
        'Could not load dataset.',
      )
    }
    if (list.length === 0) {
      return requestErrorResponse(404, 'not_found', 'Dataset not found.')
    }
    dataset = list[0]
  }

  const target: DatasetTarget =
    variant === 'live' && dataset
      ? {
          workspaceId: dataset.workspace_id,
          objectId: dataset.id,
          name: dataset.name,
          description: dataset.description,
          lifecycle: dataset.lifecycle,
          sourceRevision: dataset.revision,
          schemaVersionId: dataset.schema_version_id,
          kind: 'sheetbase.dataset.export',
          state: 'live',
        }
      : // Filled by the version branch below.
        {
          workspaceId: '',
          objectId: datasetId,
          name: '',
          description: null,
          lifecycle: '',
          sourceRevision: '',
          schemaVersionId: '',
          kind: 'sheetbase.dataset-version.export',
          state: 'version',
        }

  let rpcName = 'query_dataset_rows'
  let rpcArgs: Record<string, unknown> = { p_dataset_id: datasetId }

  if (variant === 'version') {
    // `datasetId` is the Dataset Version id here. The parent dataset only
    // contributes its stable name.
    const versionRes = await postgrestSelect<
      Array<{
        id: string
        dataset_id: string
        workspace_id: string
        label: string
        source_dataset_revision: number | string
        schema_version_id: string
      }>
    >(
      'dataset_versions',
      `id=eq.${encodeURIComponent(datasetId)}&select=id,dataset_id,workspace_id,label,source_dataset_revision,schema_version_id&limit=1`,
      context.token,
    )
    const versions = Array.isArray(versionRes.body) ? versionRes.body : []
    if (versionRes.status >= 400 || versions.length === 0) {
      return requestErrorResponse(
        404,
        'not_found',
        'Dataset Version not found.',
      )
    }
    const version = versions[0]
    target.workspaceId = version.workspace_id
    target.objectId = version.id
    target.sourceRevision = version.source_dataset_revision
    target.schemaVersionId = version.schema_version_id
    target.name = version.label
    target.versionInfo = {
      datasetVersionId: version.id,
      sourceDatasetRevision: version.source_dataset_revision,
      label: version.label,
      schemaVersionId: version.schema_version_id,
    }
    rpcName = 'query_dataset_version_rows'
    rpcArgs = { p_dataset_version_id: version.id }
  }

  const fields = await loadDatasetFields(context.token, target.schemaVersionId)

  const meta = buildExportMeta({
    kind: target.kind,
    state: target.state,
    objectId: target.objectId,
    workspaceId: target.workspaceId,
    name: target.name,
    fields,
    sourceRevision: target.sourceRevision,
    datasetVersion: target.versionInfo,
    notes: [target.state === 'version' ? VERSION_STATE_NOTE : LIVE_STATE_NOTE],
  })

  const base = `${slug(target.name)}-${target.state}`
  const filename = `${base}.${format}`

  const rows = pagedRows(rpcName, rpcArgs, context.token)

  if (format === 'xlsx') {
    const all: ExportRow[] = []
    for await (const row of rows.rows) all.push(row)
    const metaLines: Array<[string, string]> = [
      ['kind', String(meta.kind)],
      ['state', String(meta.state)],
      ['objectId', String(meta.objectId)],
      ['sourceRevision', String(meta.sourceRevision ?? '')],
    ]
    const notes = meta.notes
    if (Array.isArray(notes)) {
      for (const note of notes) metaLines.push(['note', String(note)])
    }
    for (const f of fields) {
      metaLines.push([
        `field:${f.key}`,
        `${f.logicalType}${f.unit ? ` (${f.unit})` : ''}${f.nullable ? '' : ' required'}`,
      ])
    }
    const bytes = await xlsxDocument(fields, all, metaLines)
    await insertReceipt({
      actorUserId: context.userId,
      workspaceId: target.workspaceId,
      objectType: variant === 'version' ? 'dataset_version' : 'dataset',
      objectId: target.objectId,
      format,
      rowCount: all.length,
      byteSize: bytes.byteLength,
    })
    return exportResponse(
      bytes as unknown as BodyInit,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename,
    )
  }

  if (format === 'parquet') {
    const all: ExportRow[] = []
    for await (const row of rows.rows) {
      all.push(row)
      if (all.length > PARQUET_MAX_ROWS) break
    }
    let bytes: Uint8Array
    try {
      bytes = await parquetDocument(fields, all)
    } catch (error) {
      return requestErrorResponse(
        413,
        'oversize',
        error instanceof Error ? error.message : 'Parquet export too large.',
      )
    }
    await insertReceipt({
      actorUserId: context.userId,
      workspaceId: target.workspaceId,
      objectType: variant === 'version' ? 'dataset_version' : 'dataset',
      objectId: target.objectId,
      format,
      rowCount: all.length,
      byteSize: bytes.byteLength,
    })
    return exportResponse(
      bytes as unknown as BodyInit,
      'application/octet-stream',
      filename,
    )
  }

  if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'csv' ? ',' : '\t'
    return streamedRows({
      objectType: variant === 'version' ? 'dataset_version' : 'dataset',
      target,
      format,
      filename,
      contentType:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'text/tab-separated-values; charset=utf-8',
      context,
      rows: rows.rows,
      renderHeader: () => delimitedHeaderLine(fields, delimiter) + '\r\n',
      renderRow: (row) => delimitedRowLine(fields, row, delimiter) + '\r\n',
    })
  }

  // JSON / NDJSON.
  return streamedRows({
    objectType: variant === 'version' ? 'dataset_version' : 'dataset',
    target,
    format,
    filename,
    contentType: 'application/json; charset=utf-8',
    context,
    rows: rows.rows,
    renderHeader: () =>
      format === 'ndjson'
        ? null
        : '{"_meta":' + JSON.stringify(meta) + ',"rows":[',
    renderRow: (row, isFirst) =>
      format === 'ndjson'
        ? JSON.stringify(rowJsonObject(row)) + '\n'
        : (isFirst ? '' : ',') + JSON.stringify(rowJsonObject(row)),
    renderFooter: () => (format === 'ndjson' ? null : ']}'),
  })
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'dataset'
  )
}

// ---------------------------------------------------------------------------
// Sheet Instance export.
//
// JSON carries the full instance document (state included). CSV/TSV/XLSX/
// Parquet render the local grid: active localFields × localValues rows. Bound
// Dataset data is exported through Dataset/Dataset Version exports (one
// canonical source per object) instead of being duplicated through Sheets.
// ---------------------------------------------------------------------------

interface SheetInstanceWire {
  id: string
  workspace_id: string
  project_id: string | null
  notebook_record_id: string | null
  name: string
  lifecycle: string
  revision: number | string
  state: {
    localFields?: Array<Record<string, unknown>>
    localValues?: Record<string, Record<string, unknown>>
    presentation?: { columnOrder?: string[]; hiddenColumnIds?: string[] }
  }
}

function fieldKey(field: Record<string, unknown>, fallback: string): string {
  return typeof field.key === 'string' && field.key ? field.key : fallback
}

export async function handleSheetInstanceExport(
  request: Request,
  instanceId: string,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const formatParam = new URL(request.url).searchParams.get('format') ?? 'json'
  if (!isExportFormat(formatParam)) {
    return requestErrorResponse(400, 'invalid_format', 'Unknown export format.')
  }

  const res = await postgrestSelect<SheetInstanceWire[]>(
    'sheet_instances',
    `id=eq.${encodeURIComponent(instanceId)}&select=id,workspace_id,project_id,notebook_record_id,name,lifecycle,revision,state&limit=1`,
    context.token,
  )
  const instances = Array.isArray(res.body) ? res.body : []
  if (res.status >= 400 || instances.length === 0) {
    return requestErrorResponse(404, 'not_found', 'Sheet Instance not found.')
  }
  const instance = instances[0]

  const state = instance.state
  const activeFields = (state.localFields ?? []).filter(
    (f) => f.lifecycle === undefined || f.lifecycle === 'active',
  )
  const presentation = state.presentation ?? {}
  const order = Array.isArray(presentation.columnOrder)
    ? presentation.columnOrder
    : []
  const hidden = new Set(
    Array.isArray(presentation.hiddenColumnIds)
      ? presentation.hiddenColumnIds
      : [],
  )
  const ordered = [
    ...order
      .map((id) => activeFields.find((f) => f.fieldId === id))
      .filter(
        (f): f is Record<string, unknown> =>
          Boolean(f) && !hidden.has(String(f?.fieldId)),
      ),
    ...activeFields.filter(
      (f) =>
        !order.includes(String(f.fieldId)) && !hidden.has(String(f.fieldId)),
    ),
  ]
  const fields: ExportField[] = ordered.map((f, index) => ({
    id: String(f.fieldId),
    key: fieldKey(f, `field_${index + 1}`),
    label: typeof f.label === 'string' ? f.label : String(f.fieldId),
    logicalType: typeof f.logicalType === 'string' ? f.logicalType : 'text',
    nullable: f.nullable !== false,
    unit:
      f.quantity &&
      typeof f.quantity === 'object' &&
      typeof (f.quantity as { storageUnit?: unknown }).storageUnit === 'string'
        ? String((f.quantity as { storageUnit: string }).storageUnit)
        : null,
  }))
  const rawRows: ExportRow[] = Object.entries(state.localValues ?? {}).map(
    ([rowKey, values]) => ({
      rowId: rowKey,
      revision: instance.revision,
      values,
    }),
  )

  const meta = buildExportMeta({
    kind: 'sheetbase.sheet-instance.export',
    state: 'live',
    objectId: instance.id,
    workspaceId: instance.workspace_id,
    name: instance.name,
    fields,
    sourceRevision: instance.revision,
    notes: [LIVE_STATE_NOTE],
  })
  const filename = `${slug(instance.name)}-sheet.${formatParam}`
  // Receipts are written only after the export content has been generated
  // successfully, so a serialization failure never leaves a successful
  // audit row behind (invariant: generated => exactly one receipt).
  async function recordSheetReceipt(byteSize?: number | null): Promise<void> {
    await insertReceipt({
      actorUserId: context.userId,
      workspaceId: instance.workspace_id,
      objectType: 'sheet_instance',
      objectId: instance.id,
      format: formatParam,
      rowCount: formatParam === 'json' ? null : rawRows.length,
      byteSize: byteSize ?? null,
    })
  }

  if (formatParam === 'json') {
    const doc = {
      _meta: meta,
      sheetInstance: {
        id: instance.id,
        name: instance.name,
        projectId: instance.project_id,
        notebookRecordId: instance.notebook_record_id,
        lifecycle: instance.lifecycle,
        revision: instance.revision,
        state,
      },
    }
    const body = JSON.stringify(doc, null, 2)
    await recordSheetReceipt(new TextEncoder().encode(body).byteLength)
    return exportResponse(body, 'application/json; charset=utf-8', filename)
  }

  if (formatParam === 'xlsx') {
    const metaLines: Array<[string, string]> = [
      ['kind', String(meta.kind)],
      ['state', 'live'],
      ['objectId', instance.id],
      ['revision', String(instance.revision)],
      ['note', LIVE_STATE_NOTE],
    ]
    for (const f of fields) {
      metaLines.push([`field:${f.key}`, String(f.logicalType)])
    }
    const bytes = await xlsxDocument(fields, rawRows, metaLines)
    await recordSheetReceipt(bytes.byteLength)
    return exportResponse(
      bytes as unknown as BodyInit,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename,
    )
  }

  if (formatParam === 'parquet') {
    let bytes: Uint8Array
    try {
      bytes = await parquetDocument(fields, rawRows)
    } catch (error) {
      return requestErrorResponse(
        413,
        'oversize',
        error instanceof Error ? error.message : 'Parquet export too large.',
      )
    }
    await recordSheetReceipt(bytes.byteLength)
    return exportResponse(
      bytes as unknown as BodyInit,
      'application/octet-stream',
      filename,
    )
  }

  // CSV / TSV of the local grid.
  const delimiter = formatParam === 'csv' ? ',' : '\t'
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(delimitedHeaderLine(fields, delimiter) + '\r\n'),
      )
      for (const row of rawRows) {
        controller.enqueue(
          encoder.encode(delimitedRowLine(fields, row, delimiter) + '\r\n'),
        )
      }
      controller.close()
    },
  })
  await recordSheetReceipt(null)
  return exportResponse(
    stream,
    formatParam === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'text/tab-separated-values; charset=utf-8',
    filename,
  )
}

// ---------------------------------------------------------------------------
// Record (Notebook) canonical JSON export.
// ---------------------------------------------------------------------------

interface BlockWire {
  id: string
  type: string
  payload: unknown
  payload_schema_version: number
  order: number
}

interface RecordLinkWire {
  target_identifier: string
  target_kind: string
  link_type: string
  target_record_id: string | null
}

export async function handleRecordExport(
  request: Request,
  recordId: string,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const formatParam = new URL(request.url).searchParams.get('format') ?? 'json'
  if (formatParam !== 'json') {
    return requestErrorResponse(
      400,
      'invalid_format',
      'Record exports support JSON only.',
    )
  }

  const records = await postgrestSelect<
    Array<{
      id: string
      workspace_id: string
      identifier: string
      title: string
      kind: string
      status: string
      tags: string[]
      properties: unknown
      custom_fields: unknown
      structure_version: number
      metadata_version: number
      archived_at: string | null
      locked_at: string | null
    }>
  >(
    'records',
    `id=eq.${encodeURIComponent(recordId)}&select=id,workspace_id,identifier,title,kind,status,tags,properties,custom_fields,structure_version,metadata_version,archived_at,locked_at&limit=1`,
    context.token,
  )
  const list = Array.isArray(records.body) ? records.body : []
  if (records.status >= 400 || list.length === 0) {
    return requestErrorResponse(404, 'not_found', 'Record not found.')
  }
  const record = list[0]

  const blocksRes = await postgrestSelect<BlockWire[]>(
    'blocks',
    `record_id=eq.${encodeURIComponent(record.id)}&select=id,type,payload,payload_schema_version,order&order=order.asc`,
    context.token,
  )
  const linksRes = await postgrestSelect<RecordLinkWire[]>(
    'record_links',
    `source_record_id=eq.${encodeURIComponent(record.id)}&select=target_identifier,target_kind,link_type,target_record_id`,
    context.token,
  )

  const doc = {
    _meta: buildExportMeta({
      kind: 'sheetbase.record.export',
      // A live Record export is never evidence, even when the record is
      // locked or archived: locked/archived live rows are still mutable
      // workspace state. Immutable evidence comes from the revision
      // evidence package (/api/export/revision/$id/package) instead.
      state: 'live',
      objectId: record.id,
      workspaceId: record.workspace_id,
      name: record.title,
      notes: [LIVE_STATE_NOTE],
    }),
    record: {
      identifier: record.identifier,
      title: record.title,
      kind: record.kind,
      status: record.status,
      tags: record.tags,
      properties: record.properties,
      customFields: record.custom_fields,
      structureVersion: record.structure_version,
      metadataVersion: record.metadata_version,
      locked: record.locked_at !== null,
      archived: record.archived_at !== null,
    },
    blocks: (Array.isArray(blocksRes.body) ? blocksRes.body : []).map((b) => ({
      id: b.id,
      type: b.type,
      order: b.order,
      payloadSchemaVersion: b.payload_schema_version,
      payload: b.payload,
    })),
    links: Array.isArray(linksRes.body) ? linksRes.body : [],
  }

  const body = JSON.stringify(doc, null, 2)
  await insertReceipt({
    actorUserId: context.userId,
    workspaceId: record.workspace_id,
    objectType: 'record',
    objectId: record.id,
    format: 'json',
    byteSize: new TextEncoder().encode(body).byteLength,
  })

  const filename = `${slug(record.identifier)}-notebook.json`
  return exportResponse(body, 'application/json; charset=utf-8', filename)
}

/** Export the selected immutable audit prefix, not events arriving after the view loaded. */
export async function handleRecordAuditExport(
  request: Request,
  recordId: string,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const search = new URL(request.url).searchParams
  const filter = z
    .object({
      recordId: z.uuid(),
      category: z.enum(auditHistoryCategories),
      actor: z.string().min(1).max(256).nullable(),
      before: z.coerce.number().int().positive(),
    })
    .safeParse({
      recordId,
      category: search.get('category') ?? 'all',
      actor: search.get('actor'),
      before: search.get('before'),
    })
  if (!filter.success)
    return requestErrorResponse(
      400,
      'invalid_filter',
      'Invalid audit selection.',
    )

  const records = await postgrestSelect<Array<{ id: string }>>(
    'records',
    `id=eq.${recordId}&select=id&limit=1`,
    context.token,
  )
  if (records.status >= 500)
    return requestErrorResponse(502, 'upstream_error', 'Audit is unavailable.')
  if (
    records.status >= 400 ||
    !Array.isArray(records.body) ||
    !records.body.length
  )
    return requestErrorResponse(404, 'not_found', 'Record not found.')

  const events: AuditEventWire[] = []
  let beforeSequence = filter.data.before
  for (;;) {
    const result = await postgrestRpc(
      'audit_events',
      auditEventsRpcArgs({
        object: recordId,
        actorUserId: filter.data.actor ?? undefined,
        beforeSequence,
        limit: 200,
      }),
      context.token,
    )
    if (result.status >= 500)
      return requestErrorResponse(
        502,
        'upstream_error',
        'Audit is unavailable.',
      )
    if (result.status >= 400)
      return requestErrorResponse(404, 'not_found', 'Record not found.')
    const parsed = auditEventsPageSchema.safeParse(result.body)
    if (!parsed.success)
      return requestErrorResponse(502, 'upstream_error', 'Invalid audit page.')
    const page = parsed.data
    events.push(
      ...page.events.filter((event) =>
        auditEventMatchesCategory(event, filter.data.category),
      ),
    )
    if (!page.hasMore) break
    if (page.nextCursor === null || page.nextCursor >= beforeSequence)
      return requestErrorResponse(
        502,
        'upstream_error',
        'Invalid audit cursor.',
      )
    beforeSequence = page.nextCursor
  }
  const body = auditEventsCsv(events)
  await insertReceipt({
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    objectType: 'record',
    objectId: recordId,
    format: 'audit-csv',
    rowCount: events.length,
    byteSize: new TextEncoder().encode(body).byteLength,
  })
  return exportResponse(
    body,
    'text/csv; charset=utf-8',
    `audit-${recordId}.csv`,
  )
}

// ---------------------------------------------------------------------------
// Revision evidence package (ZIP).
// ---------------------------------------------------------------------------

export async function handleRevisionEvidencePackage(
  request: Request,
  revisionId: string,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const rpcRes = await postgrestRpc<unknown>(
    'revision_evidence_package',
    { p_revision_id: revisionId },
    context.token,
  )
  if (rpcRes.status >= 400 || !rpcRes.body) {
    // Denials and missing revisions are indistinguishable by design.
    return requestErrorResponse(404, 'not_found', 'Revision not found.')
  }

  const pkg = rpcRes.body as Parameters<typeof buildEvidencePackage>[0]
  const bytes = await buildEvidencePackage(pkg)

  await insertReceipt({
    actorUserId: context.userId,
    workspaceId: pkg.revision.workspaceId,
    objectType: 'revision',
    objectId: pkg.revision.id,
    format: 'evidence-package-zip',
    byteSize: bytes.byteLength,
  })

  return exportResponse(
    bytes as unknown as BodyInit,
    'application/zip',
    `evidence-${pkg.revision.id}.zip`,
  )
}

/**
 * Internal PDF of a signed revision, rendered from the same evidence package
 * as the ZIP. The receipt is written only after the bytes exist.
 */
export async function handleRevisionPdf(
  request: Request,
  revisionId: string,
  deps: SessionAuthDeps,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  const rpcRes = await postgrestRpc<unknown>(
    'revision_evidence_package',
    { p_revision_id: revisionId },
    context.token,
  )
  if (rpcRes.status >= 400 || !rpcRes.body) {
    return requestErrorResponse(404, 'not_found', 'Revision not found.')
  }
  const pkg = rpcRes.body as Parameters<typeof buildEvidencePackage>[0]
  const bytes = await renderRevisionPdf(pkg)

  await insertReceipt({
    actorUserId: context.userId,
    workspaceId: pkg.revision.workspaceId,
    objectType: 'revision',
    objectId: pkg.revision.id,
    format: 'evidence-pdf',
    byteSize: bytes.byteLength,
  })

  return exportResponse(
    bytes as unknown as BodyInit,
    'application/pdf',
    `evidence-${pkg.revision.id}.pdf`,
  )
}
