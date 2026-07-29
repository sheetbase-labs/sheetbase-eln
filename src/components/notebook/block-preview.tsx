import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  CircleAlert,
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIconLucide,
  FlaskConical,
  Info,
  Link2,
  StickyNote,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import {
  KNOWN_BLOCK_TYPES,
  RichTextContent,
  isRichTextPayload,
} from '#/lib/blocks'
import {
  notebookDataClient,
  notebookQueryKeys,
  fetchFileObjectByRecordId,
} from '#/lib/notebook-data'
import { fetchRecordById } from '#/lib/scientific-records'
import { materialAlerts } from '#/lib/protocol-materials'
import type { MaterialItem } from '#/lib/protocol-materials'
import {
  formatFileSize,
  formatCellValue,
  formatMetricValue,
} from '#/lib/format-numbers'
import { Badge } from '#/components/ui'
import {
  materialiseFrozenChart,
  materialiseLiveChart,
  useLiveChartDataset,
} from '#/lib/chart-data'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartBlockPayload, ChartSpec } from '#/lib/chart-spec'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { PlateMap } from '#/components/viz/plate-map'
import type {
  PlateWell,
  PlateMapRoleLegendEntry,
} from '#/components/viz/plate-map'
import { PLATE_MAP_SPEC_VERSION, ROLE_STYLES } from '#/lib/plate-map'
import type { PlateMapSpec, WellAssignment } from '#/lib/plate-map'
import {
  scientificDataClient,
  scientificQueryKeys,
  fetchScientificTable,
  fetchScientificRows,
} from '#/lib/scientific-sheet-data'

/**
 * Read-only preview of a block's typed payload (ELN-004). Renders the
 * content a reviewer can read and reference today; ELN-005 adds edit
 * behaviour, insertion and the block picker on top of this shape.
 *
 * Known block types render a compact, honest preview of their payload.
 * Unknown future block types — a type the DB allows but this client does
 * not yet know how to render, or a payload_schema_version ahead of the
 * client — render as a readable placeholder that preserves the block id
 * and type so the document never silently hides or rewrites them.
 */

export interface BlockPreviewProps {
  block: NotebookBlock
  className?: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asArray<T = unknown>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function BlockPreview({ block, className }: BlockPreviewProps) {
  const { type, payload } = block
  const body = renderPayload(type, payload)
  return <div className={cn('text-sm leading-6', className)}>{body}</div>
}

function renderPayload(type: string, payload: unknown): React.ReactNode {
  switch (type) {
    case 'rich_text':
      return renderRichText(payload)
    case 'checklist':
      return renderChecklist(payload)
    case 'callout':
      return renderCallout(payload)
    case 'linked_record':
      return renderLinkedRecord(payload)
    case 'procedure_step':
      return renderProcedureStep(payload)
    case 'protocol_reference':
      return <ProtocolReferencePreview payload={payload} />
    case 'materials':
      return <MaterialsPreview payload={payload} />
    case 'metric':
      return renderMetric(payload)
    case 'table':
      return renderTable(payload)
    case 'sheet':
      return <SheetBlockPreview payload={payload} />
    case 'chart':
      return <ChartBlockPreview payload={payload} />
    case 'plate_map':
      return <PlateMapBlockPreview payload={payload} />
    case 'file':
      return <FileBlockPreview payload={payload} />
    default:
      return renderUnsupported(type, payload)
  }
}

function renderRichText(payload: unknown): React.ReactNode {
  return isRichTextPayload(payload) ? (
    <RichTextContent payload={payload} />
  ) : null
}

function renderChecklist(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const items = asArray<{ text?: unknown; checked?: unknown }>(obj.items)
  if (!items) return null
  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const text = asString(item.text) ?? ''
        const checked = item.checked === true
        return (
          <li key={i} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background',
              )}
            >
              {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <span
              className={cn(
                'text-sm leading-6',
                checked
                  ? 'text-muted-foreground line-through'
                  : 'text-foreground',
              )}
            >
              {text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function renderCallout(payload: unknown): React.ReactNode {
  // The callout payload contract (src/lib/blocks validateCallout) is
  // { text, variant } with variant one of info|warning|note|danger. The
  // renderer must read the same fields the validator enforces.
  const obj = asObject(payload)
  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const variant = asString(obj.variant) ?? 'info'
  const styles = CALLOUT_STYLES[variant] ?? CALLOUT_STYLES.info
  const Icon = styles.icon
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border py-3 pr-3 pl-3.5 text-sm leading-6',
        styles.container,
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', styles.iconClass)}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  )
}

interface CalloutStyle {
  container: string
  icon: LucideIcon
  iconClass: string
}

const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  info: {
    container:
      'border-info/20 bg-info/10 text-foreground',
    icon: Info,
    iconClass: 'text-info',
  },
  warning: {
    container:
      'border-warning/30 bg-warning/15 text-foreground',
    icon: TriangleAlert,
    iconClass: 'text-warning-foreground',
  },
  danger: {
    container:
      'border-destructive/20 bg-destructive/10 text-foreground',
    icon: CircleAlert,
    iconClass: 'text-destructive',
  },
  note: {
    container:
      'border-success/20 bg-success/10 text-foreground',
    icon: StickyNote,
    iconClass: 'text-success',
  },
}

function renderLinkedRecord(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const targetKind = asString(obj.targetKind) ?? 'Record'
  const targetIdentifier = asString(obj.targetIdentifier) ?? ''
  const label = asString(obj.label) ?? ''
  const linkType = asString(obj.linkType) ?? 'general'
  const Icon = LINKED_RECORD_ICONS[targetKind] ?? Link2
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">
          {targetKind}
          {targetIdentifier ? (
            <span className="ml-1 font-mono text-muted-foreground">
              {targetIdentifier}
            </span>
          ) : null}
        </span>
      </Badge>
      {label ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : null}
      {linkType && linkType !== 'general' ? (
        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
          {linkType}
        </span>
      ) : null}
    </div>
  )
}

const LINKED_RECORD_ICONS: Record<string, LucideIcon> = {
  experiment: FlaskConical,
  protocol: FlaskConical,
  sample: FileImage,
  dataset: FileSpreadsheet,
  file: FileText,
}

function renderProcedureStep(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const number = asNumber(obj.stepNumber)
  const completed = obj.completed === true
  const note = asString(obj.note)
  const completedAt = asString(obj.completedAt)
  return (
    <div className="flex items-start gap-3">
      <span
        aria-label={completed ? 'Completed' : 'Not completed'}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          completed
            ? 'border-success bg-success text-success-foreground'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        {completed ? <Check className="size-3.5" strokeWidth={3} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-6',
            completed
              ? 'text-muted-foreground line-through'
              : 'text-foreground',
          )}
        >
          {text}
        </p>
        {note ? (
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        ) : null}
        {completedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Completed {new Date(completedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ProtocolReferencePreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const protocolRecordId = asString(obj?.protocolRecordId)
  const current = useQuery({
    queryKey: notebookQueryKeys.record(
      protocolRecordId ?? 'unresolved-protocol',
    ),
    queryFn: () => fetchRecordById(notebookDataClient, protocolRecordId ?? ''),
    enabled: Boolean(protocolRecordId),
  })
  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No protocol version pinned. Select this block to choose a protocol.
      </p>
    )
  }
  const approvalStatus = asString(obj.approvalStatus) ?? 'Unknown approval'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <FlaskConical
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {asString(obj.protocolTitle) ?? 'Protocol'}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {asString(obj.protocolIdentifier)} · revision{' '}
            {(asString(obj.protocolRevisionId) ?? '').slice(0, 8)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="info">Version {asString(obj.version) ?? '—'}</Badge>
        <Badge variant="outline">{approvalStatus}</Badge>
        {current.isLoading ? (
          <span className="text-xs text-muted-foreground">
            Checking current status…
          </span>
        ) : current.error ? (
          <span className="text-xs text-muted-foreground">
            Current status unavailable
          </span>
        ) : current.data?.archivedAt ? (
          <Badge variant="warning">Protocol archived</Badge>
        ) : current.data === null ? (
          <Badge variant="danger">Protocol unavailable</Badge>
        ) : null}
      </div>
    </div>
  )
}

function MaterialsPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const items = asArray<MaterialItem>(obj?.items) ?? []
  const records = useQueries({
    queries: items.map((item) => ({
      queryKey: notebookQueryKeys.record(item.materialRecordId),
      queryFn: () => fetchRecordById(notebookDataClient, item.materialRecordId),
    })),
  })
  const loading = records.some((query) => query.isLoading)
  const error = records.some((query) => query.error)
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No materials linked.</p>
  }
  return (
    <div className="divide-y divide-border" aria-busy={loading}>
      {error ? (
        <p role="alert" className="pb-2 text-xs text-destructive">
          Current material availability could not be loaded. Stored observations
          remain visible.
        </p>
      ) : null}
      {items.map((item, index) => {
        const alerts =
          loading || error ? [] : materialAlerts(records[index]?.data ?? null)
        return (
          <div
            key={item.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {item.title}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {item.identifier}
              </p>
            </div>
            <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
              <span className="font-mono text-sm tabular-nums text-foreground">
                {item.quantity} {item.unit.symbol}
              </span>
              {loading ? (
                <span className="text-xs text-muted-foreground">
                  Checking availability…
                </span>
              ) : null}
              {alerts.map((alert) => (
                <Badge
                  key={alert.kind}
                  variant={alert.kind === 'unavailable' ? 'danger' : 'warning'}
                >
                  {alert.label}
                </Badge>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function renderMetric(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const label = asString(obj.label) ?? ''
  const unit = asString(obj.unit) ?? ''
  const value = formatMetricValue(obj.value)
  return (
    <dl className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label || 'Metric'}
      </dt>
      <dd className="font-display text-2xl font-semibold leading-tight tabular-nums text-foreground">
        {value}
        {unit ? (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </dd>
    </dl>
  )
}

function renderTable(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const rawColumns = asArray(obj.columns)
  const rows = asArray(obj.rows)
  if (!rawColumns || !rows) return null

  // Canonical table payload (validated by validateTable): columns is an
  // array of strings, rows is an array of arrays.  A legacy object-based
  // format (columns with {key,label}, rows as keyed objects) is also handled.
  const isStringColumns = rawColumns.every(
    (c): c is string => typeof c === 'string',
  )
  const columns = isStringColumns
    ? rawColumns.map((label, i) => ({
        label,
        key: String(i),
      }))
    : rawColumns.map((c, i) => ({
        label: asString((c as Record<string, unknown>).label) ?? `col ${i + 1}`,
        key: asString((c as Record<string, unknown>).key) ?? String(i),
      }))

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {columns.map((col, i) => (
              <th
                key={i}
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="bg-background">
              {columns.map((col, j) => {
                const cell = Array.isArray(row)
                  ? row[j]
                  : (row as Record<string, unknown>)[col.key]
                return (
                  <td
                    key={j}
                    className="px-3 py-2 font-mono tabular-nums text-foreground"
                  >
                    {formatCellValue(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <td
              colSpan={columns.length}
              className="px-3 py-1.5 text-xs text-muted-foreground"
            >
              {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * Read-only preview of a scientific sheet block (SCI-003).  Fetches the
 * table metadata and first page of rows via the same data client the
 * notebook editor uses, then renders a compact HTML table.  No HyperFormula
 * or Handsontable — the preview is intentionally lightweight for the
 * overview and read-only contexts.
 */
function SheetBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const tableId = obj ? asString(obj.tableId) : null
  const tableQuery = useQuery({
    queryKey: scientificQueryKeys.table(tableId ?? ''),
    queryFn: () => fetchScientificTable(scientificDataClient, tableId!),
    enabled: !!tableId,
  })
  const table = tableQuery.data
  const rowsQuery = useQuery({
    queryKey: scientificQueryKeys.rows(tableId ?? '', 0),
    queryFn: () => fetchScientificRows(scientificDataClient, table!, 0),
    enabled: !!table,
  })

  if (!tableId) {
    return (
      <div className="rounded-lg border border-muted-foreground/30 p-3 text-xs text-muted-foreground">
        Scientific sheet not configured yet.
      </div>
    )
  }
  if (tableQuery.isLoading) {
    return (
      <div className="rounded-lg border p-3 text-sm text-muted-foreground">
        Preparing scientific sheet…
      </div>
    )
  }
  if (tableQuery.error || !table) {
    return (
      <div className="rounded-lg border border-dashed border-warning/30 bg-warning/10 p-3 text-xs">
        <p className="font-medium text-foreground">
          Scientific sheet unavailable
        </p>
        <p className="mt-1 text-muted-foreground">
          The sheet data could not be loaded. It may have been deleted or you
          may not have access.
        </p>
      </div>
    )
  }

  const columns = [...table.columns].sort(
    (a, b) => a.display_order - b.display_order,
  )
  const rows = rowsQuery.data ?? []

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{table.name}</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-2 text-muted-foreground"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="bg-background">
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className="px-3 py-2 font-mono tabular-nums text-foreground"
                    >
                      {formatCellValue(row[col.field_name])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function renderUnsupported(type: string, payload: unknown): React.ReactNode {
  const known = (KNOWN_BLOCK_TYPES as readonly string[]).includes(type)
  return (
    <div className="rounded-lg border border-dashed border-warning/30 bg-warning/10 p-3 text-xs">
      <p className="font-medium text-foreground">
        {known ? 'Unsupported payload version' : `Unknown block type: ${type}`}
      </p>
      <p className="mt-1 text-muted-foreground">
        The block is preserved as stored. Its content will render here once a
        renderer for this type and schema version is available.
      </p>
      <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCI-003 file block preview. Renders name, size, media type and the LIVE
// file_objects status — active, quarantined, deleted, or missing — honestly.
// Status is never cached in the block payload, so this always reflects the
// authoritative row. An empty draft `{}` prompts the user to attach a file.
// ---------------------------------------------------------------------------

function FileBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const fileRecordId = asString(obj?.fileRecordId)
  const draftName = asString(obj?.displayName) ?? ''
  const draftMediaType = asString(obj?.mediaType) ?? ''
  const draftByteSize = asNumber(obj?.byteSize)

  const live = useQuery({
    queryKey: notebookQueryKeys.fileObject(fileRecordId ?? 'unresolved-file'),
    queryFn: () =>
      fetchFileObjectByRecordId(notebookDataClient, fileRecordId ?? ''),
    enabled: Boolean(fileRecordId),
  })

  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No file attached. Select this block to upload a file.
      </p>
    )
  }
  if (!fileRecordId) {
    return (
      <p className="text-sm text-muted-foreground">
        This file block is incomplete.
      </p>
    )
  }

  const name = live.data?.displayName ?? draftName
  const mediaType = live.data?.mediaType ?? draftMediaType
  const byteSize = live.data?.byteSize ?? draftByteSize ?? 0
  const status = live.data?.status ?? null

  if (live.isLoading) {
    return (
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <FileIcon mediaType={mediaType} />
        <span>{name || 'Loading file…'}</span>
      </div>
    )
  }
  if (live.error) {
    return (
      <div className="text-sm">
        <p className="font-medium text-foreground">{name || 'File'}</p>
        <p role="alert" className="mt-1 text-xs text-destructive">
          File status could not be loaded.
        </p>
      </div>
    )
  }

  if (status === 'missing' || !live.data) {
    return (
      <div className="text-sm">
        <p className="font-medium text-foreground">{name || 'File'}</p>
        <p className="mt-1 text-xs text-warning-foreground">
          The storage object for this file is missing.
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }
  if (status === 'quarantined') {
    return (
      <div className="text-sm">
        <p className="font-medium text-foreground">{name}</p>
        <p className="mt-1 text-xs text-warning-foreground">
          Quarantined
          {live.data.statusReason ? ` — ${live.data.statusReason}` : ''}.
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }
  if (status === 'deleted') {
    return (
      <div className="text-sm">
        <p className="font-medium text-muted-foreground line-through">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This file is deleted.
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }

  // active
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileIcon mediaType={mediaType} />
        <div className="min-w-0">
          <a
            href={`/api/files/${fileRecordId}/download`}
            className="font-medium text-foreground underline-offset-2 hover:underline"
            download
          >
            {name}
          </a>
          <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
        </div>
      </div>
      <Badge variant="success">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Active
      </Badge>
    </div>
  )
}

function FileMetaLine({
  mediaType,
  byteSize,
}: {
  mediaType: string
  byteSize: number
}) {
  return (
    <p className="font-mono text-xs text-muted-foreground">
      {mediaType || 'unknown'} · {formatFileSize(byteSize)}
    </p>
  )
}

function fileIconForType(mediaType: string): LucideIcon {
  if (mediaType.startsWith('image/')) return FileImage
  if (mediaType === 'application/pdf') return FileText
  if (mediaType.includes('spreadsheet') || mediaType === 'text/csv') {
    return FileSpreadsheet
  }
  if (mediaType.includes('wordprocessing')) return FileText
  return FileIconLucide
}

function FileIcon({ mediaType }: { mediaType: string }) {
  const Icon = fileIconForType(mediaType)
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      <Icon className="size-5" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// SCI-004 chart block preview. Renders the chart inside `ChartFrame` using
// the approved palette and scientific number formatting. A frozen chart
// renders its immutable snapshot; a live chart re-reads the current dataset
// state through the shared scientific-sheet-data client and surfaces
// missing-field, empty-dataset, log-scale-invalid and stale-calculation
// states honestly instead of plotting. An empty draft `{}` prompts the user
// to configure the chart in the editor.
// ---------------------------------------------------------------------------

function ChartBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No chart configured. Select this block to choose a dataset and fields.
      </p>
    )
  }
  const title = asString(obj.title) ?? 'Chart'
  const provenance = asString(obj.provenance) ?? undefined
  const spec = parseChartSpec(obj.spec)
  const frozen = parseFrozenChart(obj.frozen)

  // No spec and no frozen snapshot: nothing to plot. Avoid the live resolver
  // (and its React Query context) when the chart is still an empty draft.
  if (!spec && !frozen) {
    return (
      <p className="text-sm text-muted-foreground">
        No chart configured. Select this block to choose a dataset and fields.
      </p>
    )
  }

  // Frozen charts render the immutable snapshot directly — no live re-read,
  // no stale detection.
  if (frozen) {
    const materialised = materialiseFrozenChart(frozen)
    return (
      <ChartRenderer
        title={title}
        provenance={provenance}
        spec={spec}
        materialised={materialised}
        frozen={frozen}
      />
    )
  }

  // Live chart: resolve the dataset and calculation results.
  return <LiveChartPreview title={title} provenance={provenance} spec={spec} />
}

function LiveChartPreview({
  title,
  provenance,
  spec,
}: {
  title: string
  provenance?: string
  spec: ChartSpec | null
}) {
  const { datasetQuery, calcQuery } = useLiveChartDataset(spec)
  const loading = datasetQuery.isLoading || calcQuery.isLoading
  if (loading) {
    return (
      <ChartRenderer
        title={title}
        provenance={provenance}
        spec={spec}
        materialised={emptyMaterialised(spec)}
        frozen={null}
        loading
      />
    )
  }
  if (datasetQuery.error) {
    return (
      <ChartRenderer
        title={title}
        provenance={provenance}
        spec={spec}
        materialised={emptyMaterialised(spec)}
        frozen={null}
        error="The dataset could not be loaded. You may not have access to it."
      />
    )
  }
  const materialised = spec
    ? materialiseLiveChart(
        spec,
        datasetQuery.data ?? null,
        calcQuery.data ?? null,
      )
    : emptyMaterialised(spec)
  return (
    <ChartRenderer
      title={title}
      provenance={provenance}
      spec={spec}
      materialised={materialised}
      frozen={null}
    />
  )
}

function emptyMaterialised(spec: ChartSpec | null) {
  return {
    state: { kind: 'missing_dataset' as const },
    columns: [],
    rows: [],
    series: [],
    xLabel: spec?.display.axes.x.label ?? spec?.fields.x?.fieldName ?? 'x',
    yLabel: spec?.display.axes.y.label ?? 'y',
    xUnit: spec?.display.axes.x.unit,
    yUnit: spec?.display.axes.y.unit,
  }
}

function parseChartSpec(v: unknown): ChartSpec | null {
  if (!asObject(v)) return null
  if ((v as { specVersion?: unknown }).specVersion !== CHART_SPEC_VERSION)
    return null
  return v as ChartSpec
}

function parseFrozenChart(v: unknown): ChartBlockPayload['frozen'] {
  if (!asObject(v)) return null
  return v as ChartBlockPayload['frozen']
}

// ---------------------------------------------------------------------------
// SCI-005 plate map block preview. Renders the plate grid with assignment-
// role colours, a legend, and honest sample-reference resolution. An empty
// draft `{}` prompts the user to configure the plate in the editor.
// ---------------------------------------------------------------------------

function PlateMapBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const isEmpty = !obj || Object.keys(obj).length === 0
  const titleStr = obj ? asString(obj.title) : null
  const title = titleStr ?? 'Plate map'
  const spec = obj && !isEmpty ? parsePlateMapSpec(obj.spec) : null

  // Resolve sample references for honest display (active vs archived).
  // Hooks must be unconditional, so always call useQueries (empty array when
  // there is nothing to resolve).
  const sampleRefs =
    spec?.wells.filter((w) => w.sampleRef).map((w) => w.sampleRef!) ?? []
  const sampleQueries = useQueries({
    queries: sampleRefs.map((ref) => ({
      queryKey: notebookQueryKeys.record(ref.recordId),
      queryFn: () => fetchRecordById(notebookDataClient, ref.recordId),
      staleTime: 30_000,
    })),
  })

  if (isEmpty) {
    return (
      <p className="text-sm text-muted-foreground">
        No plate map configured. Select this block to set dimensions and assign
        wells.
      </p>
    )
  }

  if (!spec) {
    return (
      <p className="text-sm text-muted-foreground">
        {title} — plate map spec is incomplete or unsupported.
      </p>
    )
  }

  const loading = sampleQueries.some((q) => q.isLoading)
  const sampleError = sampleQueries.some((q) => q.error)

  // Build a lookup of recordId → live record state
  const liveRecords = new Map<string, { archivedAt: string | null } | null>()
  sampleRefs.forEach((ref, i) => {
    liveRecords.set(ref.recordId, sampleQueries[i]?.data ?? null)
  })

  // Convert WellAssignments to PlateWells with role-based coloring
  const plateWells: PlateWell[] = spec.wells.map((w) => {
    const roleStyle = ROLE_STYLES[w.role]
    const liveRecord = w.sampleRef
      ? liveRecords.get(w.sampleRef.recordId)
      : null
    const isArchived = Boolean(w.sampleRef?.archived || liveRecord?.archivedAt)
    const displayLabel = w.sampleRef
      ? `${w.sampleRef.identifier}${isArchived ? ' (arch)' : ''}`
      : w.role === 'empty'
        ? ''
        : ROLE_STYLES[w.role].label[0].toUpperCase()
    return {
      row: w.row,
      col: w.col,
      wellCode: w.wellCode,
      roleClass: roleStyle.cellClass,
      displayLabel,
      label: buildWellLabel(w, isArchived),
    }
  })

  // Build role legend from the roles present on the plate
  const presentRoles = new Set(spec.wells.map((w) => w.role))
  const roleLegend: PlateMapRoleLegendEntry[] = Array.from(presentRoles).map(
    (role) => ({
      label: ROLE_STYLES[role].label,
      className: ROLE_STYLES[role].cellClass,
    }),
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{title}</p>
        {spec.wells.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No wells assigned
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {spec.wells.length} well{spec.wells.length !== 1 ? 's' : ''} ·{' '}
            {spec.rows}×{spec.cols}
          </span>
        )}
      </div>
      {sampleError ? (
        <p role="alert" className="text-xs text-destructive">
          Some sample references could not be loaded. Stored observations remain
          visible.
        </p>
      ) : null}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading sample details…</p>
      ) : null}
      <PlateMap
        wells={plateWells}
        rows={spec.rows}
        cols={spec.cols}
        ariaLabel={`${title} — ${spec.rows}×${spec.cols} plate`}
        roleLegend={roleLegend}
        readOnly
        compact
      />
    </div>
  )
}

function buildWellLabel(w: WellAssignment, isArchived: boolean): string {
  const parts = [w.wellCode, ROLE_STYLES[w.role].label]
  if (w.sampleRef) {
    parts.push(w.sampleRef.identifier)
    if (w.sampleRef.title) parts.push(w.sampleRef.title)
    if (isArchived) parts.push('archived')
  }
  if (w.replicate) parts.push(`replicate ${w.replicate}`)
  if (w.volume) parts.push(`${w.volume.value} ${w.volume.unit}`)
  if (w.notes) parts.push(w.notes)
  return parts.join(' · ')
}

function parsePlateMapSpec(v: unknown): PlateMapSpec | null {
  if (!asObject(v)) return null
  if ((v as { specVersion?: unknown }).specVersion !== PLATE_MAP_SPEC_VERSION)
    return null
  return v as PlateMapSpec
}
