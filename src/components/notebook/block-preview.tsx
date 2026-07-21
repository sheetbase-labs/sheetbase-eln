import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import {
  KNOWN_BLOCK_TYPES,
  RichTextContent,
  isRichTextPayload,
} from '#/lib/blocks'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { fetchRecordById } from '#/lib/scientific-records'
import { materialAlerts } from '#/lib/protocol-materials'
import type { MaterialItem } from '#/lib/protocol-materials'

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
    case 'chart':
      return renderResultsChart(payload)
    case 'plate_map':
    case 'file':
      return renderVisualPlaceholder(type, payload)
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
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const text = asString(item.text) ?? ''
        const checked = item.checked === true
        return (
          <li key={i} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]',
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background',
              )}
            >
              {checked ? '✓' : ''}
            </span>
            <span
              className={cn(checked && 'text-muted-foreground line-through')}
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
  const obj = asObject(payload)
  if (!obj) return null
  const body = asString(obj.body) ?? ''
  const tone = asString(obj.tone) ?? 'info'
  return (
    <div
      className={cn(
        'rounded-md border p-3 text-sm',
        tone === 'warning' && 'border-warning/40 bg-warning/10',
        tone === 'danger' && 'border-destructive/40 bg-destructive/10',
        (tone === 'info' || tone === 'neutral') &&
          'border-primary/30 bg-primary/5',
      )}
    >
      {body}
    </div>
  )
}

function renderLinkedRecord(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const targetKind = asString(obj.targetKind) ?? 'Record'
  const targetIdentifier = asString(obj.targetIdentifier) ?? ''
  const label = asString(obj.label) ?? ''
  const linkType = asString(obj.linkType) ?? 'general'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">
        {linkType}
      </span>
      <span className="font-medium text-foreground">
        {targetKind} {targetIdentifier}
      </span>
      {label ? <span className="text-muted-foreground">— {label}</span> : null}
    </div>
  )
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
          'flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
          completed
            ? 'border-success bg-success text-white'
            : 'border-primary/30 bg-primary/10 text-primary',
        )}
      >
        {completed ? '✓' : number}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'whitespace-pre-wrap text-foreground',
            completed && 'line-through opacity-70',
          )}
        >
          {text}
        </p>
        {note ? (
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        ) : null}
        {completedAt ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
      <div>
        <p className="font-medium text-foreground">
          {asString(obj.protocolTitle) ?? 'Protocol'}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {asString(obj.protocolIdentifier)} · revision{' '}
          {(asString(obj.protocolRevisionId) ?? '').slice(0, 8)}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-primary/10 px-2 py-1 font-medium text-primary">
          Version {asString(obj.version) ?? '—'}
        </span>
        <span className="rounded-full border px-2 py-1 text-muted-foreground">
          {asString(obj.approvalStatus) ?? 'Unknown approval'}
        </span>
        {current.isLoading ? (
          <span className="text-muted-foreground">
            Checking current status…
          </span>
        ) : current.error ? (
          <span className="text-muted-foreground">
            Current status unavailable
          </span>
        ) : current.data?.archivedAt ? (
          <span className="rounded-full bg-warning/15 px-2 py-1 font-medium text-warning-foreground">
            Protocol archived
          </span>
        ) : current.data === null ? (
          <span className="rounded-full bg-destructive/10 px-2 py-1 font-medium text-destructive">
            Protocol unavailable
          </span>
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
    <div className="space-y-2" aria-busy={loading}>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
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
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{item.title}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {item.identifier}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="font-mono text-sm tabular-nums">
                {item.quantity} {item.unit.symbol}
              </span>
              {loading ? (
                <span className="text-xs text-muted-foreground">
                  Checking availability…
                </span>
              ) : null}
              {alerts.map((alert) => (
                <span
                  key={alert.kind}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    alert.kind === 'unavailable'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-warning/15 text-warning-foreground',
                  )}
                >
                  {alert.label}
                </span>
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
  const value = asString(obj.value) ?? asNumber(obj.value)?.toString() ?? ''
  const unit = asString(obj.unit) ?? ''
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label || 'Metric'}
      </dt>
      <dd className="font-mono tabular-nums text-foreground">
        {value}
        {unit ? (
          <span className="ml-1 text-muted-foreground">{unit}</span>
        ) : null}
      </dd>
    </dl>
  )
}

function renderTable(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const columns = asArray<{ key?: unknown; label?: unknown }>(obj.columns)
  const rows = asArray<Record<string, unknown>>(obj.rows)
  if (!columns || !rows) return null
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((col, i) => (
              <th
                key={i}
                scope="col"
                className="border-b px-3 py-2 text-left font-medium text-muted-foreground"
              >
                {asString(col.label) ?? asString(col.key) ?? `col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-background">
              {columns.map((col, j) => {
                const key = asString(col.key) ?? ''
                const cell = key ? row[key] : undefined
                return (
                  <td
                    key={j}
                    className="border-b px-3 py-2 font-mono tabular-nums text-foreground"
                  >
                    {cell === null || cell === undefined ? '' : String(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderVisualPlaceholder(
  type: string,
  payload: unknown,
): React.ReactNode {
  const obj = asObject(payload) ?? {}
  const title = asString(obj.title) ?? asString(obj.caption) ?? ''
  const label =
    type === 'chart'
      ? 'Chart'
      : type === 'plate_map'
        ? 'Plate map'
        : type === 'file'
          ? 'File'
          : 'Visualisation'
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">
        {label}
        {title ? ` — ${title}` : ''}
      </p>
      <p className="mt-1">
        Rendered by its dedicated component in a later ticket. The block payload
        is preserved and readable through the API.
      </p>
    </div>
  )
}

function renderResultsChart(payload: unknown): React.ReactNode {
  const obj = asObject(payload) ?? {}
  const title =
    asString(obj.title) ?? 'Vector genome copy number over storage time'
  const series = [
    {
      color: '#006edc',
      dash: '',
      points: '70,54 180,76 290,104 400,136 510,170',
    },
    {
      color: '#006edc',
      dash: '6 5',
      points: '70,62 180,84 290,112 400,146 510,180',
    },
    {
      color: '#00a659',
      dash: '',
      points: '70,78 180,96 290,124 400,154 510,192',
    },
    {
      color: '#00a659',
      dash: '6 5',
      points: '70,86 180,106 290,134 400,166 510,204',
    },
  ]
  return (
    <figure aria-label={title} className="overflow-hidden rounded-md border">
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Illustrative preview
          </span>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="rounded border px-2 py-1">Line</span>
          <span className="rounded border px-2 py-1">Log Y</span>
          <span className="rounded border px-2 py-1">Customize</span>
        </span>
      </figcaption>
      <div className="grid grid-cols-[1fr_150px] gap-3 p-3">
        <svg
          viewBox="0 0 560 240"
          className="h-[240px] w-full"
          role="img"
          aria-label="Four qPCR series decline across days 0 through 28"
        >
          {[48, 100, 152, 204].map((y, index) => (
            <g key={y}>
              <line x1="70" y1={y} x2="520" y2={y} stroke="#dfe3e8" />
              <text x="8" y={y + 4} fontSize="11" fill="#6b7280">
                {['1e+09', '1e+08', '1e+07', '1e+06'][index]}
              </text>
            </g>
          ))}
          {[70, 180, 290, 400, 510].map((x, index) => (
            <g key={x}>
              <line x1={x} y1="48" x2={x} y2="204" stroke="#eef0f3" />
              <text
                x={x}
                y="225"
                textAnchor="middle"
                fontSize="11"
                fill="#6b7280"
              >
                {[0, 7, 14, 21, 28][index]}
              </text>
            </g>
          ))}
          {series.map((line, index) => (
            <g key={index}>
              <polyline
                points={line.points}
                fill="none"
                stroke={line.color}
                strokeWidth="2.5"
                strokeDasharray={line.dash}
              />
              {line.points.split(' ').map((point) => {
                const [cx, cy] = point.split(',')
                return (
                  <circle
                    key={point}
                    cx={cx}
                    cy={cy}
                    r="3"
                    fill="white"
                    stroke={line.color}
                    strokeWidth="2"
                  />
                )
              })}
            </g>
          ))}
          <text
            x="295"
            y="239"
            textAnchor="middle"
            fontSize="11"
            fill="#4b5563"
          >
            Time (days)
          </text>
          <text
            x="12"
            y="130"
            textAnchor="middle"
            fontSize="11"
            fill="#4b5563"
            transform="rotate(-90 12 130)"
          >
            GCN per mL
          </text>
        </svg>
        <div className="space-y-4 border-l pl-3 text-[11px]">
          <div>
            <p className="font-semibold text-foreground">Batch</p>
            <p className="mt-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#006edc]" />
              LVV-250601
            </p>
            <p className="mt-2 flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#00a659]" />
              LVV-250602
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground">Replicate</p>
            <p className="mt-2">━━ Rep 1</p>
            <p className="mt-2">┅┅ Rep 2</p>
          </div>
        </div>
      </div>
    </figure>
  )
}

function renderUnsupported(type: string, payload: unknown): React.ReactNode {
  const known = (KNOWN_BLOCK_TYPES as readonly string[]).includes(type)
  return (
    <div className="rounded-md border border-dashed border-warning/50 bg-warning/5 p-3 text-xs">
      <p className="font-medium text-foreground">
        {known ? 'Unsupported payload version' : `Unknown block type: ${type}`}
      </p>
      <p className="mt-1 text-muted-foreground">
        The block is preserved as stored. Its content will render here once a
        renderer for this type and schema version is available.
      </p>
      <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  )
}
