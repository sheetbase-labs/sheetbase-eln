import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
  Snowflake,
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
import { isInlinePreviewableImage } from '#/lib/file-policy'
import { datasetPath, recordDestination, sheetPath } from '#/lib/navigation'
import { PipelineOutputBlockPreview } from './pipeline-output-block-preview'
import { sheetInstanceEmbedErrorMessage } from './notebook-sheet-block'
import {
  fetchCanonicalDataset,
  fetchDatasetRows,
  fetchFrozenAnalysisRows,
  frozenPinsDatasetVersion,
  materialiseFrozenChart,
  materialiseFrozenFacets,
  materialiseLiveChart,
  reconstructFrozenVisualisation,
  sciDataClient,
  useFrozenPinnedRows,
  useLiveChartDataset,
} from '#/lib/chart-data'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartBlockPayload, ChartSpec } from '#/lib/chart-spec'
import { runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisDefinition } from '#/lib/analysis-definition'
import type { AnalysisBlockPayload, FrozenAnalysis } from '#/lib/analysis-block'
import {
  analysisDefinitionQueryKeys,
  fetchAnalysisDefinition,
} from '#/lib/analysis-definitions-data'
import { AnalysisResultTable } from '#/components/viz/analysis-panel'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { RepresentationFrame } from '#/components/viz/representation-frame'
import {
  chartToRepresentationHandle,
  plateMapToRepresentationHandle,
} from '#/lib/representations'
import { PlateMap } from '#/components/viz/plate-map'
import type {
  PlateWell,
  PlateMapRoleLegendEntry,
} from '#/components/viz/plate-map'
import { PLATE_MAP_SPEC_VERSION, ROLE_STYLES } from '#/lib/plate-map'
import type {
  LiveSampleObservation,
  PlateMapSpec,
  WellAssignment,
  WellSampleResolution,
  WellSelectionContext,
} from '#/lib/plate-map'
import {
  liveSampleObservationFromQuery,
  resolveWellSample,
  wellSelectionContext,
} from '#/lib/plate-map'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import { sheetBlockInstanceId } from '#/lib/sheet-block'

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
  /**
   * NOTE-02 same-block collapse: rich_text node indexes hidden by a
   * collapsed section (kept in the DOM for print). Absent elsewhere.
   */
  hiddenNodeIndexes?: ReadonlySet<number>
  /**
   * VIEW-02 frozen mode: the block renders from a pinned revision snapshot
   * (`block_snapshot`). Reconstructions must not run live reads — the plate
   * preview resolves sample links from the stored `SampleRef` snapshots only
   * and renders inside a frozen representation frame. Charts carry their own
   * frozen payload and ignore this flag.
   */
  frozen?: boolean
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

/**
 * NOTE-03 — compact "open the canonical object" affordance shared by the
 * scientific block previews. `to` must come from a navigation helper
 * (datasetPath, recordDestination, sheetPath, …) so the link always carries
 * the object's stable UUID, never a label or display name.
 */
export function OpenLink({
  to,
  children,
}: {
  to: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </Link>
  )
}

export function BlockPreview({
  block,
  className,
  hiddenNodeIndexes,
  frozen = false,
}: BlockPreviewProps) {
  const { type, payload } = block
  // NOTE-02: read previews carry the same stable heading anchors as the
  // read-only editor view so outline links resolve in every mode.
  const body = renderPayload(
    type,
    payload,
    `section-${block.id}`,
    hiddenNodeIndexes,
    frozen,
  )
  return <div className={cn('text-sm leading-6', className)}>{body}</div>
}

function renderPayload(
  type: string,
  payload: unknown,
  anchorPrefix?: string,
  hiddenNodeIndexes?: ReadonlySet<number>,
  frozen?: boolean,
): React.ReactNode {
  switch (type) {
    case 'rich_text':
      return renderRichText(payload, anchorPrefix, hiddenNodeIndexes)
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
    case 'analysis':
      return <AnalysisBlockPreview payload={payload} />
    case 'pipeline_output':
      return <PipelineOutputBlockPreview payload={payload} />
    case 'plate_map':
      return <PlateMapBlockPreview payload={payload} frozen={frozen} />
    case 'file':
      return <FileBlockPreview payload={payload} />
    default:
      return renderUnsupported(type, payload)
  }
}

function renderRichText(
  payload: unknown,
  anchorPrefix?: string,
  hiddenNodeIndexes?: ReadonlySet<number>,
): React.ReactNode {
  return isRichTextPayload(payload) ? (
    <RichTextContent
      payload={payload}
      anchorPrefix={anchorPrefix}
      hiddenNodeIndexes={hiddenNodeIndexes}
    />
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
        'flex gap-3 rounded-md px-3.5 py-2 text-sm leading-6',
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
    container: 'bg-info/[0.07] text-foreground',
    icon: Info,
    iconClass: 'text-info',
  },
  warning: {
    container: 'bg-warning/[0.09] text-foreground',
    icon: TriangleAlert,
    iconClass: 'text-warning-foreground',
  },
  danger: {
    container: 'bg-destructive/[0.07] text-foreground',
    icon: CircleAlert,
    iconClass: 'text-destructive',
  },
  note: {
    container: 'bg-success/[0.07] text-foreground',
    icon: StickyNote,
    iconClass: 'text-success',
  },
}

function renderLinkedRecord(payload: unknown): React.ReactNode {
  return <LinkedRecordPreview payload={payload} />
}

/**
 * NOTE-03 — linked_record preview. The payload optionally carries
 * `targetId`, the stable UUID of the referenced canonical object (Dataset
 * UUID for `targetKind: 'dataset'`, Record UUID otherwise), captured when
 * the link was picked from search. When present the preview offers an
 * "Open" affordance built from the navigation helpers; legacy payloads
 * store only the human identifier, which is deliberately not enough to
 * build a canonical link (identity is never carried by labels).
 */
function LinkedRecordPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  if (!obj) return null
  const targetKind = asString(obj.targetKind) ?? 'Record'
  const targetIdentifier = asString(obj.targetIdentifier) ?? ''
  const label = asString(obj.label) ?? ''
  const linkType = asString(obj.linkType) ?? 'general'
  const targetId = asString(obj.targetId) ?? ''
  const Icon = LINKED_RECORD_ICONS[targetKind] ?? Link2
  const openTo = targetId
    ? targetKind === 'dataset'
      ? datasetPath(targetId)
      : recordDestination(targetKind, targetId)
    : null
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
      {openTo ? <OpenLink to={openTo}>Open</OpenLink> : null}
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
        {/* NOTE-03: open the canonical protocol Record via its stable UUID. */}
        {protocolRecordId ? (
          <OpenLink
            to={recordDestination('protocol_template', protocolRecordId)}
          >
            Open protocol
          </OpenLink>
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
    <div aria-busy={loading}>
      {error ? (
        <p role="alert" className="pb-2 text-xs text-destructive">
          Current material availability could not be loaded. Stored observations
          remain visible.
        </p>
      ) : null}
      <div className="divide-y divide-border">
        {items.map((item, index) => {
          const alerts =
            loading || error ? [] : materialAlerts(records[index]?.data ?? null)
          const currentRecord = error ? null : (records[index]?.data ?? null)
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
                    variant={
                      alert.kind === 'unavailable' ? 'danger' : 'warning'
                    }
                  >
                    {alert.label}
                  </Badge>
                ))}
                {/* NOTE-03: open the material's canonical Record (Sample or
                Reagent) by stable UUID. Suppressed while the record cannot
                be resolved — an unresolvable link would be dishonest. */}
                {currentRecord ? (
                  <OpenLink
                    to={recordDestination(item.kind, item.materialRecordId)}
                  >
                    Open
                  </OpenLink>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
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
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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

function SheetBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const instanceId = obj ? sheetBlockInstanceId(obj) : null
  if (instanceId) {
    return <CanonicalSheetBlockPreview instanceId={instanceId} />
  }
  return (
    <p className="p-3 text-sm text-muted-foreground" role="status">
      This block has no Sheet Instance.
    </p>
  )
}

function CanonicalSheetBlockPreview({ instanceId }: { instanceId: string }) {
  const instanceQuery = useQuery({
    queryKey: ['sheet-instance', instanceId],
    queryFn: () => fetchSheetInstance(instanceId, sheetInstanceDataClient),
  })
  if (instanceQuery.isLoading) {
    return (
      <div className="rounded-lg border p-3 text-sm text-muted-foreground">
        Loading Sheet…
      </div>
    )
  }
  if (instanceQuery.error || !instanceQuery.data) {
    return (
      <div
        className="rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 text-xs"
        role="alert"
      >
        <p className="font-medium text-foreground">Sheet unavailable</p>
        <p className="mt-1 text-muted-foreground">
          {sheetInstanceEmbedErrorMessage(
            instanceQuery.error,
            !instanceQuery.data,
          )}
        </p>
      </div>
    )
  }
  const instance = instanceQuery.data
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{instance.name}</p>
        {/* NOTE-03: the read preview carries the same canonical Sheet link
        as the live embed, built from the instance's stable UUID. */}
        <OpenLink to={sheetPath(instanceId)}>Open full sheet</OpenLink>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {instance.sourceDefinitionVersionId
          ? 'Sheet from a Definition. Open the block to edit.'
          : 'Ad hoc Sheet. Open the block to edit.'}
        {instance.lifecycle === 'archived' ? ' This Sheet is archived.' : ''}
      </p>
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
  const showImage = isInlinePreviewableImage(mediaType)
  return (
    <div className="space-y-2">
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
      {showImage ? (
        <img
          alt={name}
          src={`/api/files/${fileRecordId}/download`}
          className="mt-2 max-h-80 max-w-full rounded-md border"
        />
      ) : null}
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
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
    >
      <Icon className="size-4" />
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

  // NOTE-03: canonical Dataset affordances, shared by live and frozen charts.
  // Both spec.datasets and frozen.datasetProvenance are ARRAYS — a chart can
  // bind multiple sources, so every source gets its own stable-ID link.
  // A frozen chart prefers the pinned provenance's identities; a live chart
  // resolves the spec's sources. Both carry a stable UUID.
  const frozenSources = frozen ? chartSourcesFromFrozen(frozen) : []
  const sources =
    frozenSources.length > 0 ? frozenSources : chartSourcesFromSpec(spec)

  // VIEW-01: the shared representation frame owns the outer chrome (title,
  // source/version badge, frozen-vs-live badge) for spec-backed charts. The
  // kind renderer stays plugged in as children with its own title hidden so
  // the visible title renders once; materialisation and plot behaviour are
  // unchanged. Legacy frozen snapshots without a spec keep the legacy path.
  const handle = chartToRepresentationHandle({ spec, frozen, title })
  const frameActions = <ChartOpenDatasetActions sources={sources} />

  // Frozen charts render the immutable snapshot directly — no live re-read,
  // no stale detection.
  if (frozen) {
    const body = (
      <PinnedFrozenChartPreview
        title={title}
        provenance={provenance}
        spec={spec}
        frozen={frozen}
        sources={sources}
        hideTitle={handle !== null}
      />
    )
    if (!handle) return body
    return (
      <RepresentationFrame title={title} handle={handle} actions={frameActions}>
        {body}
      </RepresentationFrame>
    )
  }

  // Live chart: resolve the dataset and calculation results.
  const liveBody = (
    <LiveChartPreview
      title={title}
      provenance={provenance}
      spec={spec}
      sources={chartSourcesFromSpec(spec)}
      hideTitle={handle !== null}
    />
  )
  if (!handle) return liveBody
  return (
    <RepresentationFrame title={title} handle={handle} actions={frameActions}>
      {liveBody}
    </RepresentationFrame>
  )
}

/**
 * NOTE-03 — one Dataset source a chart binds to. Live charts carry only the
 * stable Dataset UUID; frozen charts additionally pin the immutable Dataset
 * Version (SCI-04) the snapshot was reconstructed from.
 */
interface ChartDatasetSource {
  datasetId: string
  versionId?: string
}

function chartSourcesFromSpec(spec: ChartSpec | null): ChartDatasetSource[] {
  return (spec?.datasets ?? [])
    .filter((d) => typeof d.datasetId === 'string' && d.datasetId.length > 0)
    .map((d) => ({ datasetId: d.datasetId }))
}

function chartSourcesFromFrozen(
  frozen: NonNullable<ChartBlockPayload['frozen']>,
): ChartDatasetSource[] {
  return frozen.datasetProvenance
    .filter((p) => typeof p.datasetId === 'string' && p.datasetId.length > 0)
    .map((p) => ({
      datasetId: p.datasetId,
      versionId:
        typeof p.datasetVersionId === 'string' && p.datasetVersionId.length > 0
          ? p.datasetVersionId
          : undefined,
    }))
}

/**
 * NOTE-03 — "Open dataset" affordances rendered inside the ChartFrame header
 * so both live and frozen chart blocks expose every canonical source. One
 * stable-ID link per source: single-source charts keep the plain "Open
 * dataset" label; multi-source charts disambiguate ("Dataset 1", "Dataset 2")
 * and frozen multi-source charts also surface each pinned Version short-id.
 */
function ChartOpenDatasetActions({ sources }: { sources: ChartDatasetSource[] }) {
  if (sources.length === 0) return null
  const multi = sources.length > 1
  return (
    <span className="mr-1 flex flex-wrap items-center gap-x-3">
      {sources.map((source, index) => (
        <Link
          key={
            source.versionId
              ? `${source.datasetId}@${source.versionId}`
              : source.datasetId
          }
          to={datasetPath(source.datasetId)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {multi
            ? source.versionId
              ? `Dataset ${index + 1} · version ${source.versionId.slice(0, 8)}`
              : `Dataset ${index + 1}`
            : 'Open dataset'}
        </Link>
      ))}
    </span>
  )
}

function PinnedFrozenChartPreview({
  title,
  provenance,
  spec,
  frozen,
  sources,
  hideTitle = false,
}: {
  title: string
  provenance?: string
  spec: ChartSpec | null
  frozen: NonNullable<ChartBlockPayload['frozen']>
  sources: ChartDatasetSource[]
  // VIEW-01: when plugged into RepresentationFrame the frame owns the
  // visible title; the inner ChartFrame keeps an sr-only title.
  hideTitle?: boolean
}) {
  const versionId = frozenPinsDatasetVersion(frozen)
  const pinned = useFrozenPinnedRows(frozen)
  const openDataset = <ChartOpenDatasetActions sources={sources} />
  // NOTE-03: the version subtitle only works when the chart pins exactly one
  // Dataset Version; with multiple sources every pinned Version short-id is
  // surfaced on its own link instead.
  const versionSubtitle =
    versionId && sources.length === 1
      ? `Dataset Version ${versionId.slice(0, 8)}`
      : undefined
  if (versionId && spec) {
    if (pinned.isLoading) {
      return (
        <ChartRenderer
          title={title}
          hideTitle={hideTitle}
          provenance={provenance}
          spec={spec}
          materialised={emptyMaterialised(spec)}
          frozen={frozen}
          loading
          // NOTE-03: pin the Dataset Version at a glance, not only in the
          // sr-only description.
          subtitle={versionSubtitle}
          actions={openDataset}
        />
      )
    }
    if (pinned.error || !pinned.data) {
      return (
        <ChartRenderer
          title={title}
          hideTitle={hideTitle}
          provenance={provenance}
          spec={spec}
          materialised={emptyMaterialised(spec)}
          frozen={frozen}
          error="Frozen Dataset Version could not be reconstructed."
          subtitle={versionSubtitle}
          actions={openDataset}
        />
      )
    }
    const reconstructed = reconstructFrozenVisualisation({
      spec,
      frozen,
      rows: pinned.data.rows,
    })
    return (
      <ChartRenderer
        title={title}
          hideTitle={hideTitle}
        provenance={provenance}
        spec={spec}
        materialised={reconstructed.chart}
        frozen={frozen}
        facets={reconstructed.facets?.panels}
        facetTotal={reconstructed.facets?.total}
        subtitle={versionSubtitle}
        actions={openDataset}
      />
    )
  }
  const materialised = materialiseFrozenChart(frozen)
  const facets = materialiseFrozenFacets(frozen)
  return (
    <ChartRenderer
      title={title}
          hideTitle={hideTitle}
      provenance={provenance}
      spec={spec}
      materialised={materialised}
      frozen={frozen}
      facets={facets?.panels}
      facetTotal={facets?.total}
      actions={openDataset}
    />
  )
}

function LiveChartPreview({
  title,
  provenance,
  spec,
  sources,
  hideTitle = false,
}: {
  title: string
  provenance?: string
  spec: ChartSpec | null
  sources: ChartDatasetSource[]
  // VIEW-01: when plugged into RepresentationFrame the frame owns the
  // visible title; the inner ChartFrame keeps an sr-only title.
  hideTitle?: boolean
}) {
  const { datasetQuery } = useLiveChartDataset(spec)
  const openDataset = <ChartOpenDatasetActions sources={sources} />
  const loading = datasetQuery.isLoading
  if (loading) {
    return (
      <ChartRenderer
        title={title}
        hideTitle={hideTitle}
        provenance={provenance}
        spec={spec}
        materialised={emptyMaterialised(spec)}
        frozen={null}
        loading
        actions={openDataset}
      />
    )
  }
  if (datasetQuery.error) {
    return (
      <ChartRenderer
        title={title}
        hideTitle={hideTitle}
        provenance={provenance}
        spec={spec}
        materialised={emptyMaterialised(spec)}
        frozen={null}
        error="The dataset could not be loaded. You may not have access to it."
        actions={openDataset}
      />
    )
  }
  const materialised = spec
    ? materialiseLiveChart(spec, datasetQuery.data ?? null)
    : emptyMaterialised(spec)
  return (
    <ChartRenderer
      title={title}
        hideTitle={hideTitle}
      provenance={provenance}
      spec={spec}
      materialised={materialised}
      frozen={null}
      actions={openDataset}
    />
  )
}

function emptyMaterialised(spec: ChartSpec | null) {
  return {
    state: { kind: 'missing_dataset' as const },
    columns: [],
    rows: [],
    series: [],
    xLabel: spec?.display.axes.x.label ?? 'x',
    yLabel: spec?.display.axes.y.label ?? 'y',
    xUnit: spec?.display.axes.x.unit,
    yUnit: spec?.display.axes.y.unit,
    droppedPoints: 0,
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

function PlateMapBlockPreview({
  payload,
  frozen = false,
}: {
  payload: unknown
  frozen?: boolean
}) {
  const obj = asObject(payload)
  const isEmpty = !obj || Object.keys(obj).length === 0
  const titleStr = obj ? asString(obj.title) : null
  const title = titleStr ?? 'Plate map'
  const spec = obj && !isEmpty ? parsePlateMapSpec(obj.spec) : null
  const [selectedWellCode, setSelectedWellCode] = React.useState<string | null>(
    null,
  )

  // Resolve sample references for honest display (active vs archived vs
  // missing vs restricted). Hooks must be unconditional, so always call
  // useQueries — with an empty list when frozen. A frozen (historical)
  // render reconstructs the pinned spec with no live reads: the stored
  // SampleRef snapshots are the evidence.
  const sampleRefs =
    spec?.wells.filter((w) => w.sampleRef).map((w) => w.sampleRef!) ?? []
  const sampleQueries = useQueries({
    queries: frozen
      ? []
      : sampleRefs.map((ref) => ({
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

  // VIEW-01: the shared representation frame owns the outer chrome (title,
  // frozen-vs-live badge) for spec-backed plates, mirroring the chart
  // preview. The plate grid stays plugged in as children.
  const handle = plateMapToRepresentationHandle({ spec, title, frozen })

  const observations = new Map<string, LiveSampleObservation>()
  if (!frozen) {
    sampleRefs.forEach((ref, i) => {
      const q = sampleQueries[i]
      observations.set(
        ref.recordId,
        liveSampleObservationFromQuery({
          data: q?.data ?? null,
          error: q?.error ?? null,
          isLoading: q?.isLoading ?? false,
        }),
      )
    })
  }

  const resolutionByWell = new Map<string, WellSampleResolution>()
  for (const w of spec.wells) {
    if (!w.sampleRef) continue
    const resolution = resolveWellSample(w, observations.get(w.sampleRef.recordId))
    if (resolution) resolutionByWell.set(w.wellCode, resolution)
  }

  const loading = [...observations.values()].some(
    (o) => o.status === 'loading',
  )
  const referenceFailure = [...observations.values()].some(
    (o) => o.status === 'error' || o.status === 'restricted',
  )

  // Convert WellAssignments to PlateWells with role-based coloring
  const plateWells: PlateWell[] = spec.wells.map((w) => {
    const roleStyle = ROLE_STYLES[w.role]
    // In compact/read-only mode, show only the well code (A1, B2) inside
    // the circle — full sample identifiers overflow the tiny wells. The
    // complete info (sample ID, role, replicate) is in the tooltip/title.
    const displayLabel = w.role === 'empty' ? '' : w.wellCode
    return {
      row: w.row,
      col: w.col,
      wellCode: w.wellCode,
      roleClass: roleStyle.cellClass,
      displayLabel,
      label: buildWellLabel(w, resolutionByWell.get(w.wellCode) ?? null),
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

  // NOTE-03: unique assigned samples as canonical open affordances. The
  // link is built from the sample's stable UUID (SampleRef.recordId), so
  // it survives relabelling and never carries identity by label.
  const linkedSamples = Array.from(
    new Map(
      spec.wells
        .filter((w) => w.sampleRef)
        .map((w) => [w.sampleRef!.recordId, w.sampleRef!]),
    ).values(),
  )

  // VIEW-02 selection model: clicking a well surfaces its linked-record
  // context (assignment summary plus an open action by stable record ID).
  // Selection never edits — the grid stays read-only.
  const selection = selectedWellCode
    ? wellSelectionContext(spec, selectedWellCode, observations)
    : null

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
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
      {referenceFailure ? (
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
        selectable
        selectedWellCode={selectedWellCode}
        onSelectWellCode={(code) =>
          setSelectedWellCode((prev) => (prev === code ? null : code))
        }
        compact
      />
      {selection ? (
        <PlateWellSelectionSummary selection={selection} />
      ) : null}
      {linkedSamples.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground">Samples:</span>
          {linkedSamples.map((ref) => (
            <OpenLink
              key={ref.recordId}
              to={recordDestination('sample', ref.recordId)}
            >
              {/* Identity is the recordId; an empty identifier label would
                  render an invisible anchor, so fall back to the id. */}
              {ref.identifier.trim() || ref.recordId}
            </OpenLink>
          ))}
        </div>
      ) : null}
    </div>
  )
  if (!handle) return body
  return (
    <RepresentationFrame title={title} handle={handle}>
      {body}
    </RepresentationFrame>
  )
}

function PlateWellSelectionSummary({
  selection,
}: {
  selection: WellSelectionContext
}) {
  const { well, sampleRef, resolution } = selection
  return (
    <div
      className="rounded-md border bg-muted/20 px-2 py-1.5"
      aria-live="polite"
    >
      <p className="text-xs font-medium">
        Well {selection.wellCode}
        {well ? ` · ${ROLE_STYLES[well.role].label}` : ' · unassigned'}
      </p>
      {well?.replicate ? (
        <p className="text-xs text-muted-foreground">
          Replicate {well.replicate}
          {well.volume ? ` · ${well.volume.value} ${well.volume.unit}` : ''}
        </p>
      ) : well?.volume ? (
        <p className="text-xs text-muted-foreground">
          {well.volume.value} {well.volume.unit}
        </p>
      ) : null}
      {sampleRef ? (
        <p className="truncate text-xs text-muted-foreground">
          {sampleRef.identifier.trim() || sampleRef.recordId}
          {sampleRef.title ? ` · ${sampleRef.title}` : ''}
          {resolution ? ` · ${describeWellSampleState(resolution)}` : ''}
        </p>
      ) : null}
      {sampleRef && resolution?.state !== 'loading' ? (
        <OpenLink to={recordDestination('sample', sampleRef.recordId)}>
          Open sample record
        </OpenLink>
      ) : null}
    </div>
  )
}

function describeWellSampleState(resolution: WellSampleResolution): string {
  switch (resolution.state) {
    case 'active':
      return resolution.snapshotOnly ? 'active (snapshot)' : 'active'
    case 'archived':
      return resolution.snapshotOnly ? 'archived (snapshot)' : 'archived'
    case 'loading':
      return 'loading…'
    case 'missing':
      return 'missing — deleted or inaccessible'
    case 'restricted':
      return 'restricted — no access'
    case 'error':
      return 'reference could not be loaded'
    case 'unassigned':
      return 'unassigned'
  }
}

function buildWellLabel(
  w: WellAssignment,
  resolution: WellSampleResolution | null,
): string {
  const parts = [w.wellCode, ROLE_STYLES[w.role].label]
  if (w.sampleRef) {
    parts.push(w.sampleRef.identifier)
    if (w.sampleRef.title) parts.push(w.sampleRef.title)
    if (resolution) parts.push(describeWellSampleState(resolution))
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

// ---------------------------------------------------------------------------
// SCI-03 analysis block preview. A live block loads the referenced saved
// definition and executes it against current dataset rows (Reload re-runs
// on demand). A frozen block re-executes the pinned definition over the
// pinned inputs — never a live re-read — so evidence stays reproducible.
// ---------------------------------------------------------------------------

function parseFrozenAnalysis(value: unknown): FrozenAnalysis | null {
  const obj = asObject(value)
  if (!obj) return null
  if (!asObject(obj.definition) || !Array.isArray(obj.datasetProvenance))
    return null
  return obj as unknown as FrozenAnalysis
}

export function AnalysisBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No analysis configured. Select this block to choose a saved analysis.
      </p>
    )
  }
  const block = payload as AnalysisBlockPayload
  const title = asString(obj.title) ?? 'Analysis'
  const provenance = asString(obj.provenance) ?? undefined
  const frozen = parseFrozenAnalysis(obj.frozen)

  if (frozen) {
    return (
      <FrozenAnalysisPreview
        frozen={frozen}
        provenance={provenance}
        title={title}
      />
    )
  }
  if (!block.definitionId) {
    return (
      <p className="text-sm text-muted-foreground">
        No analysis configured. Select this block to choose a saved analysis.
      </p>
    )
  }
  return (
    <LiveAnalysisPreview
      title={title}
      provenance={provenance}
      definitionId={block.definitionId}
    />
  )
}

function LiveAnalysisPreview({
  title,
  provenance,
  definitionId,
}: {
  title: string
  provenance?: string
  definitionId: string
}) {
  const definitionQuery = useQuery({
    queryKey: analysisDefinitionQueryKeys.detail(definitionId),
    queryFn: () => fetchAnalysisDefinition(sciDataClient, definitionId),
    staleTime: 10_000,
  })

  if (definitionQuery.isLoading)
    return (
      <div role="status" className="text-xs text-muted-foreground">
        Loading analysis…
      </div>
    )
  if (definitionQuery.error || !definitionQuery.data)
    return (
      <div role="alert" className="text-xs text-destructive">
        The saved analysis could not be loaded. It may have been deleted.
      </div>
    )
  const saved = definitionQuery.data
  const definition = saved.definition as AnalysisDefinition | null
  if (!definition)
    return (
      <div role="alert" className="text-xs text-destructive">
        The saved analysis has no executable definition body.
      </div>
    )
  const datasetId = definition.datasets[0]?.datasetId ?? ''

  return (
    <LiveAnalysisExecution
      title={title}
      provenance={provenance}
      name={saved.name}
      version={saved.version}
      definition={definition}
      datasetId={datasetId}
    />
  )
}

function LiveAnalysisExecution({
  title,
  provenance,
  name,
  version,
  definition,
  datasetId,
}: {
  title: string
  provenance?: string
  name: string
  version: number
  definition: AnalysisDefinition
  datasetId: string
}) {
  const resolvedQuery = useQuery({
    queryKey: ['analysis-block-dataset', datasetId] as const,
    queryFn: async () => {
      const source = await fetchCanonicalDataset(sciDataClient, datasetId)
      if (!source) return null
      return {
        source,
        ...(await fetchDatasetRows(sciDataClient, source.datasetId)),
      }
    },
    enabled: Boolean(datasetId),
    staleTime: 10_000,
  })

  const executed =
    resolvedQuery.data && !resolvedQuery.data.truncated
      ? runAnalysis(
          definition,
          resolvedQuery.data.source.columns,
          resolvedQuery.data.rows,
        )
      : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {name} · v{version}
        </Badge>
        {/* NOTE-03: open the canonical Dataset the analysis executes over. */}
        {datasetId ? (
          <OpenLink to={datasetPath(datasetId)}>Open dataset</OpenLink>
        ) : null}
        {resolvedQuery.isFetching ? (
          <span className="text-xs text-muted-foreground">Loading rows…</span>
        ) : null}
      </div>
      {executed && executed.ok ? (
        <AnalysisResultTable result={executed.result} />
      ) : executed ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {executed.error.code === 'empty_dataset'
            ? 'The dataset has no rows to analyse.'
            : `This analysis cannot execute: ${executed.error.code}.`}
        </div>
      ) : (
        <div role="status" className="text-xs text-muted-foreground">
          Preparing analysis…
        </div>
      )}
      {provenance ? (
        <p className="text-xs text-muted-foreground">{provenance}</p>
      ) : null}
      <span className="sr-only">{title}</span>
    </div>
  )
}

function FrozenAnalysisPreview({
  frozen,
  provenance,
  title,
}: {
  frozen: FrozenAnalysis
  provenance?: string
  title: string
}) {
  // Frozen evidence reconstructs deterministically from the pinned immutable
  // Dataset Version — the block stores references, never source rows.
  const pin = frozen.datasetProvenance.at(0)
  const rowsQuery = useQuery({
    queryKey: ['analysis-frozen-version-rows', pin?.datasetVersionId] as const,
    queryFn: () => {
      if (!pin) throw new Error('No pinned Dataset Version')
      return fetchFrozenAnalysisRows(
        sciDataClient,
        pin.datasetVersionId,
        pin.rowCount,
      )
    },
    enabled: Boolean(pin),
    staleTime: 10_000,
  })

  const columns = frozen.columns.map((c) => ({
    id: c.fieldId,
    label: c.label,
    logicalType: c.logicalType,
  }))
  const executed =
    rowsQuery.data && rowsQuery.data.matchesProvenance
      ? runAnalysis(frozen.definition, columns, rowsQuery.data.rows)
      : null

  const provenanceParts = frozen.datasetProvenance.map(
    (p) =>
      `dataset ${p.datasetId.slice(0, 8)} · version ${p.datasetVersionId.slice(0, 8)} (${p.rowCount} rows, checksum ${p.checksum.slice(0, 8)})`,
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">
          <Snowflake className="size-3" aria-hidden />
          Frozen snapshot — {frozen.frozenAt}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Provenance: {provenanceParts.join(', ')}
        </span>
        {/* NOTE-03: the frozen evidence pins a Dataset Version; the open
        affordance still targets the canonical Dataset by stable UUID. */}
        {pin ? (
          <OpenLink to={datasetPath(pin.datasetId)}>Open dataset</OpenLink>
        ) : null}
      </div>
      {!pin ? (
        <EvidenceAlert>
          The frozen payload pins no Dataset Version and cannot be
          reconstructed.
        </EvidenceAlert>
      ) : rowsQuery.isLoading ? (
        <div role="status" className="text-xs text-muted-foreground">
          Reconstructing from pinned Dataset Version…
        </div>
      ) : rowsQuery.error ? (
        <EvidenceAlert>
          The pinned Dataset Version could not be read for reconstruction.
        </EvidenceAlert>
      ) : rowsQuery.data && !rowsQuery.data.matchesProvenance ? (
        <EvidenceAlert>
          Evidence mismatch: the Dataset Version row count does not match the
          pinned provenance ({rowsQuery.data.totalCount} ≠ {pin.rowCount}).
        </EvidenceAlert>
      ) : executed && executed.ok ? (
        <AnalysisResultTable result={executed.result} />
      ) : executed ? (
        <EvidenceAlert>
          The pinned inputs no longer execute: {executed.error.code}.
        </EvidenceAlert>
      ) : null}
      {provenance ? (
        <p className="text-xs text-muted-foreground">{provenance}</p>
      ) : null}
      <span className="sr-only">{title}</span>
    </div>
  )
}

function EvidenceAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
    >
      {children}
    </div>
  )
}
