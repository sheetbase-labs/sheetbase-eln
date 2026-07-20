import * as React from 'react'

import { cn } from '#/lib/utils'
import type { NotebookBlock } from '#/lib/notebook-data'
import { KNOWN_BLOCK_TYPES } from '#/lib/blocks'

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
    case 'heading':
      return renderHeading(payload)
    case 'rich_text':
      return renderRichText(payload)
    case 'checklist':
      return renderChecklist(payload)
    case 'list':
      return renderList(payload)
    case 'callout':
      return renderCallout(payload)
    case 'linked_record':
      return renderLinkedRecord(payload)
    case 'procedure_step':
      return renderProcedureStep(payload)
    case 'metric':
      return renderMetric(payload)
    case 'table':
      return renderTable(payload)
    case 'chart':
    case 'plate_map':
    case 'file':
      return renderVisualPlaceholder(type, payload)
    default:
      return renderUnsupported(type, payload)
  }
}

function renderHeading(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const level = asNumber(obj.level)
  const Tag = headingTag(level)
  return (
    <Tag
      className={cn(
        'font-display font-semibold tracking-tight text-foreground',
        level === 1 && 'text-2xl leading-8',
        (level === null || level === 2) && 'text-lg leading-7',
        level === 3 && 'text-base leading-6',
        level !== null && level >= 4 && 'text-sm leading-5',
      )}
    >
      {text || 'Untitled heading'}
    </Tag>
  )
}

function headingTag(level: number | null) {
  const n = level && level >= 1 && level <= 6 ? level : 2
  return `h${n}` as keyof React.JSX.IntrinsicElements
}

function renderRichText(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const body = asString(obj.body) ?? ''
  return <p className="whitespace-pre-wrap text-foreground">{body}</p>
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

function renderList(payload: unknown): React.ReactNode {
  const obj = asObject(payload)
  if (!obj) return null
  const items = asArray<string>(obj.items)
  const ordered = obj.ordered === true
  if (!items) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={cn('space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
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
  return (
    <div className="flex items-start gap-2">
      {number !== null ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {number}
        </span>
      ) : null}
      <p className="whitespace-pre-wrap text-foreground">{text}</p>
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
