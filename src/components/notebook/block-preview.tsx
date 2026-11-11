import { ReactionPreview, StructurePreview } from './chemistry-block'
import { t } from '#/copy'
import * as React from 'react'
import { useStepNumber } from '#/lib/step-numbers'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'

import { cn } from '#/lib/utils'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import { RichTextContent, isRichTextPayload } from '#/lib/blocks'
import { isBlockType } from '#/lib/blocks/registry'
import {
  CONCLUSION_VERDICT_LABELS,
  conclusionVerdictOf,
} from '#/lib/conclusion-block'
import type { ConclusionVerdict } from '#/lib/conclusion-block'
import { CALLOUT_STYLES, calloutVariantOf } from './callout-styles'
import {
  formatNotebookDateTime,
  notebookDataClient,
  notebookQueryKeys,
  fetchFileObjectByRecordId,
} from '#/lib/notebook-data'
import { fetchRecordById } from '#/lib/scientific-records'
import { materialAlerts } from '#/lib/protocol-materials'
import { materialItems } from './material-payload'
import {
  HazardPictograms,
  SignalWordBadge,
} from '#/components/materials/material-safety'
import {
  fetchMaterialSafetyFor,
  isHazardous,
  materialSafetyKeys,
} from '#/lib/material-safety'
import type { MaterialSafety } from '#/lib/material-safety'
import {
  formatFileSize,
  formatCellValue,
  formatMetricValue,
} from '#/lib/format-numbers'
import { Badge } from '#/components/ui/badge'
import { SequenceFileViewer } from '#/components/sequence'
import { isSequenceFileName } from '#/lib/sequence'
import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { StepTimerControl } from './step-timer'
import { PluginFilePreview } from '#/components/plugins/plugin-file-preview'
import { OfficeFileBlock } from './office-preview/office-file-block'
import { formatDuration, stepDurationSeconds } from '#/lib/step-timers'
import { AnnotatedImage } from './annotated-image'
import { renderAnnotatedPng } from './image-annotation-rendering'
import { OfficeEditButton } from './office-editor'
import { readAnnotations } from '#/lib/image-annotations'
import { isInlinePreviewableImage } from '#/lib/file-policy'
import { linkedRecordDestination } from './linked-record-destination'
import { readOnlyEntries } from './read-only-entries'
import {
  datasetPath,
  datasetVersionPath,
  recordDestination,
  sheetPath,
} from '#/lib/navigation'
import { PipelineOutputBlockPreview } from './pipeline-output-block-preview'
import { CodeCellBlockPreview } from './code-cell-block'
import { DatasetImportBlockPreview } from './dataset-import-block'
import {
  CorrectiveActionsPreview,
  SignatureRequestPreview,
} from './action-block-previews'
import type { ActionBlockContext } from '#/lib/notebook-action-blocks'
import { useUnsyncedBlock } from '#/components/offline/offline-edits'
import { UnsyncedMark } from '#/components/offline/unsynced-changes'
import { sheetInstanceEmbedErrorMessage } from './sheet-embed-error'
import {
  resolveDatasetRef,
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
import { PluginBlockView } from '#/components/extensions/plugin-block'
import { analysisBlockParts, runAnalysis } from '#/lib/analysis-definition'
import type { AnalysisBlockDefinition } from '#/lib/analysis-definition'
import type { FrozenAnalysis } from '#/lib/analysis-block'
import {
  analysisDefinition,
  chartSpec,
  frozenAnalysis,
  frozenChart,
  plateSpec,
} from './scientific-payload'
import {
  frozenAnalysisMethodMismatch,
  frozenAnalysisMethodVersion,
} from '#/lib/analysis-block'
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
import {
  PLATE_MAP_SPEC_VERSION,
  ROLE_STYLES,
  liveSampleObservationFromQuery,
  resolveWellSample,
  wellSelectionContext,
} from '#/lib/plate-map'
import type {
  LiveSampleObservation,
  WellAssignment,
  WellSampleResolution,
  WellSelectionContext,
} from '#/lib/plate-map'
import {
  fetchSheetInstance,
  sheetInstanceDataClient,
} from '#/lib/sheet-instance-data'
import { GateBlockView, StepWaitNote } from '#/components/notebook/gates'
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
  /**
   * R5-NOTE-02: the revision a sign-and-attach block is being read against.
   * Absent on live canvases; the two action block kinds then read as "applies
   * to the next submission". Passed unchanged to their previews.
   */
  actionContext?: ActionBlockContext
}

const stringValue = z.string().nullable().catch(null)
const asString = stringValue.parse.bind(stringValue)
const numberValue = z.number().nullable().catch(null)
const asNumber = numberValue.parse.bind(numberValue)
const arrayValue = z.array(z.json()).nullable().catch(null)
const asArray = arrayValue.parse.bind(arrayValue)
const objectValue = z.record(z.string(), z.json()).nullable().catch(null)
const asObject = objectValue.parse.bind(objectValue)

const checklistItems = z
  .array(
    z.object({
      text: z.string().catch(''),
      checked: z.boolean().catch(false),
    }),
  )
  .nullable()
  .catch(null)

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
  const workspace = useWorkspaceNavigation()

  return (
    <Link
      to={to}
      className="text-xs text-link underline underline-offset-2"
      onClick={(event) => {
        event.stopPropagation()
        openBesideOnAlt(workspace, to, event)
      }}
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
  actionContext,
}: BlockPreviewProps) {
  const { type, payload } = block
  // EXP-05.2: a block with a local draft carries a marker where it renders.
  const unsynced = useUnsyncedBlock(block.id)

  // NOTE-02: read previews carry the same stable heading anchors as the
  // read-only editor view so outline links resolve in every mode.
  const body = renderPayload(
    type,
    payload,
    `section-${block.id}`,
    hiddenNodeIndexes,
    frozen,
    actionContext,
    block.recordId,
    block.id,
  )

  return (
    <div className={cn('text-sm leading-6', className)}>
      {unsynced ? <UnsyncedMark className="mb-1" /> : null}
      {body}
    </div>
  )
}

function renderPayload(
  type: string,
  payload: NotebookBlock['payload'],
  anchorPrefix?: string,
  hiddenNodeIndexes?: ReadonlySet<number>,
  frozen?: boolean,
  actionContext?: ActionBlockContext,
  recordId?: string,
  blockId?: string,
): React.ReactNode {
  switch (type) {
    case 'rich_text':
      return renderRichText(payload, anchorPrefix, hiddenNodeIndexes)
    case 'checklist':
      return renderChecklist(payload)
    case 'callout':
      return renderCallout(payload)
    case 'conclusion':
      return renderConclusion(payload)
    case 'linked_record':
      return renderLinkedRecord(payload)
    case 'procedure_step':
      return renderProcedureStep(payload, blockId)
    case 'gate':
      return (
        <GateBlockView blockId={blockId} payload={asObject(payload) ?? {}} />
      )
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
    case 'plugin':
      return (
        <PluginBlockView
          payload={payload}
          recordId={recordId}
          blockId={blockId}
        />
      )
    case 'analysis':
      return <AnalysisBlockPreview payload={payload} />
    case 'pipeline_output':
      return <PipelineOutputBlockPreview payload={payload} />
    case 'code_cell':
      return <CodeCellBlockPreview payload={payload} recordId={recordId} />
    case 'dataset_import':
      return <DatasetImportBlockPreview payload={payload} recordId={recordId} />
    case 'plate_map':
      return <PlateMapBlockPreview payload={payload} frozen={frozen} />
    case 'structure':
      return <StructurePreview payload={payload} />
    case 'reaction':
      return <ReactionPreview payload={payload} />
    case 'file':
      return <FileBlockPreview payload={payload} recordId={recordId} />
    case 'signature_request':
      return (
        <SignatureRequestPreview payload={payload} context={actionContext} />
      )
    case 'corrective_actions':
      return (
        <CorrectiveActionsPreview payload={payload} context={actionContext} />
      )
    default:
      return renderUnsupported(type, payload)
  }
}

function renderRichText(
  payload: NotebookBlock['payload'],
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

function renderChecklist(payload: NotebookBlock['payload']): React.ReactNode {
  const obj = asObject(payload)

  if (!obj) return null
  const items = checklistItems.parse(obj.items)

  if (!items) return null

  return (
    <ul className="space-y-1.5">
      {readOnlyEntries(items, (item) => JSON.stringify(item)).map(
        ({ key, value: item }) => {
          const text = asString(item.text) ?? ''
          const checked = item.checked === true

          return (
            <li key={key} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                  checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-surface',
                )}
              >
                {checked ? (
                  <Icon name="check" size={14} strokeWidth={3} />
                ) : null}
              </span>
              <span
                className={cn(
                  'text-sm leading-6',
                  checked ? 'text-fg-muted line-through' : 'text-fg',
                )}
              >
                {text}
              </span>
            </li>
          )
        },
      )}
    </ul>
  )
}

function renderCallout(payload: NotebookBlock['payload']): React.ReactNode {
  // The callout payload contract (src/lib/blocks validateCallout) is
  // { text, variant } with variant one of info|warning|note|danger. The
  // renderer must read the same fields the validator enforces.
  const obj = asObject(payload)

  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const variant = calloutVariantOf(obj.variant)
  const styles = CALLOUT_STYLES[variant]

  return (
    <div
      className={cn(
        'flex gap-3 rounded-md px-3.5 py-2 text-sm leading-6',
        styles.container,
      )}
    >
      <Icon
        name={styles.icon}
        size={16}
        className={cn('mt-0.5 shrink-0', styles.iconClass)}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  )
}

const CONCLUSION_VERDICT_STYLES: Record<ConclusionVerdict, string> = {
  supported: 'bg-success/[0.12] text-success-text',
  not_supported: 'bg-destructive/[0.1] text-danger-text',
  inconclusive: 'bg-fg/[0.06] text-fg-muted',
}

function renderConclusion(payload: NotebookBlock['payload']): React.ReactNode {
  const obj = asObject(payload)

  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const basis = asString(obj.basis) ?? ''
  const verdict = conclusionVerdictOf(obj.verdict)

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm leading-6">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {t('notebook.blockPreview.conclusion')}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            CONCLUSION_VERDICT_STYLES[verdict],
          )}
        >
          {CONCLUSION_VERDICT_LABELS[verdict]}
        </span>
      </div>
      <p className="text-fg">
        {text || (
          <span className="text-fg-muted">
            {t('notebook.blockPreview.noConclusionWritten')}
          </span>
        )}
      </p>
      {basis ? (
        <p className="text-xs text-fg-muted">
          <span className="font-medium">
            {t('notebook.blockPreview.basedOn')}
          </span>{' '}
          {basis}
        </p>
      ) : null}
    </div>
  )
}

function renderLinkedRecord(
  payload: NotebookBlock['payload'],
): React.ReactNode {
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

  const targetKind =
    asString(obj.targetKind) ?? t('notebook.blockPreview.record')

  const targetIdentifier = asString(obj.targetIdentifier) ?? ''
  const label = asString(obj.label) ?? ''
  const linkType = asString(obj.linkType) ?? 'general'
  const targetId = asString(obj.targetId) ?? ''

  const partNumber = z
    .number()
    .min(1)
    .nullable()
    .catch(null)
    .parse(obj.partNumber)

  const datasetVersionId = asString(obj.datasetVersionId)
  const linkedIcon = LINKED_RECORD_ICONS.get(targetKind) ?? 'link'

  const openTo = linkedRecordDestination({
    targetKind,
    targetId,
    datasetVersionId,
    partNumber,
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="kind" className="gap-1.5 px-2.5 py-1 text-xs">
        <Icon
          name={linkedIcon}
          size={14}
          className="text-fg-muted"
          aria-hidden="true"
        />
        <span className="font-medium text-fg">
          {targetKind}
          {targetIdentifier ? (
            <span className="ml-1 font-mono text-fg-muted">
              {targetIdentifier}
            </span>
          ) : null}
          {partNumber ? (
            <span className="ml-1 text-fg-muted">
              › {t('notebook.parts.partNumber', { number: String(partNumber) })}
            </span>
          ) : null}
        </span>
      </Badge>
      {label ? <span className="text-xs text-fg-muted">{label}</span> : null}
      {linkType && linkType !== 'general' ? (
        <span className="text-xs uppercase tracking-wide text-fg-muted/70">
          {linkType}
        </span>
      ) : null}
      {openTo ? (
        <OpenLink to={openTo}>
          {datasetVersionId
            ? t('notebook.blockPreview.openCitedSnapshot')
            : t('common.actions.open')}
        </OpenLink>
      ) : null}
    </div>
  )
}

const LINKED_RECORD_ICONS = new Map<string, IconName>([
  ['experiment', 'flask'],
  ['protocol', 'flask'],
  ['sample', 'box'],
  ['dataset', 'table'],
  ['file', 'download'],
])

function renderProcedureStep(
  payload: NotebookBlock['payload'],
  blockId?: string,
): React.ReactNode {
  return <ProcedureStepView payload={payload} blockId={blockId} />
}

function ProcedureStepView({
  payload,
  blockId,
}: {
  payload: unknown
  blockId?: string
}): React.ReactNode {
  const obj = asObject(payload)
  const number = useStepNumber(blockId, asNumber(obj?.stepNumber))

  if (!obj) return null
  const text = asString(obj.text) ?? ''
  const completed = obj.completed === true
  const note = asString(obj.note)
  const completedAt = asString(obj.completedAt)
  const durationSeconds = stepDurationSeconds(obj)
  const isExecution = z.boolean().safeParse(obj.completed).success

  return (
    <div className="flex items-start gap-3">
      <span
        aria-label={
          completed
            ? t('notebook.blockPreview.ariaLabel')
            : t('notebook.blockPreview.notCompletedAriaLabel')
        }
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          completed
            ? 'border-success bg-success text-success-text-foreground'
            : 'border-border bg-surface-muted text-fg-muted',
        )}
      >
        {completed ? <Icon name="check" size={14} strokeWidth={3} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-6',
            completed ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {text}
        </p>
        {note ? <p className="mt-1 text-xs text-fg-muted">{note}</p> : null}
        {completed ? null : <StepWaitNote blockId={blockId} />}
        {durationSeconds !== null && isExecution && !completed && blockId ? (
          <StepTimerControl
            blockId={blockId}
            durationSeconds={durationSeconds}
            className="mt-2"
          />
        ) : durationSeconds !== null ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <Icon name="clock" size={12} />
            {t('notebook.stepTimers.runsFor', {
              length: formatDuration(durationSeconds),
            })}
          </p>
        ) : null}
        {completedAt ? (
          <p className="mt-1 text-xs text-fg-muted">
            {t('notebook.blockPreview.completedNotebookdatetime', {
              notebookDateTime: formatNotebookDateTime(completedAt, {
                zone: true,
              }),
            })}
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
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noProtocolVersionPinned')}
      </p>
    )
  }

  const approvalStatus =
    asString(obj.approvalStatus) ?? t('notebook.blockPreview.unknownApproval')

  return (
    // The block toolbar sits over the block's top-right corner and this row is
    // one line tall, so keep the right-aligned link clear of it.
    <div className="flex flex-wrap items-center justify-between gap-3 pr-16">
      <div className="flex items-start gap-2.5">
        <Icon
          name="flask"
          size={16}
          className="mt-0.5 shrink-0 text-fg-muted"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-medium text-fg">
            {asString(obj.protocolTitle) ?? t('notebook.blockPreview.protocol')}
          </p>
          <p className="font-mono text-xs text-fg-muted">
            {t('notebook.blockPreview.asstringRevisionAsstring2', {
              asString: asString(obj.protocolIdentifier) ?? '',
              asString2: (asString(obj.protocolRevisionId) ?? '').slice(0, 8),
            })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="kind">
          {t('notebook.blockPreview.versionAsstring', {
            asString: asString(obj.version) ?? '—',
          })}
        </Badge>
        <Badge variant="kind">{approvalStatus}</Badge>
        <ProtocolAvailability current={current} />
        {/* NOTE-03: open the canonical protocol Record via its stable UUID. */}
        {protocolRecordId ? (
          <OpenLink
            to={recordDestination('protocol_template', protocolRecordId)}
          >
            {t('notebook.blockPreview.openProtocol')}
          </OpenLink>
        ) : null}
      </div>
    </div>
  )
}

/** Current availability is separate from the immutable approval citation. */
function ProtocolAvailability({
  current,
}: {
  current: UseQueryResult<NotebookRecord | null>
}) {
  if (current.isLoading)
    return (
      <span className="text-xs text-fg-muted">
        {t('notebook.blockPreview.checkingCurrentStatus')}
      </span>
    )

  if (current.error)
    return (
      <span className="text-xs text-fg-muted">
        {t('notebook.blockPreview.currentStatusUnavailable')}
      </span>
    )

  if (current.data?.archivedAt)
    return (
      <Badge variant="chg">{t('notebook.blockPreview.protocolArchived')}</Badge>
    )

  if (current.data === null)
    return (
      <Badge variant="del">
        {t('notebook.blockPreview.protocolUnavailable')}
      </Badge>
    )

  return null
}

/** A material's hazards on a notebook line: pictograms and signal word, if it has any. */
function MaterialHazards({ safety }: { safety: MaterialSafety | undefined }) {
  if (!isHazardous(safety)) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <HazardPictograms pictograms={safety?.pictograms ?? []} size={20} />
      {safety?.signalWord ? <SignalWordBadge word={safety.signalWord} /> : null}
    </div>
  )
}

function MaterialsPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)
  const items = materialItems.parse(obj?.items)

  const records = useQueries({
    queries: items.map((item) => ({
      queryKey: notebookQueryKeys.record(item.materialRecordId),
      queryFn: () => fetchRecordById(notebookDataClient, item.materialRecordId),
    })),
  })

  const loading = records.some((query) => query.isLoading)
  const error = records.some((query) => query.error)
  const materialIds = items.map((item) => item.materialRecordId)

  const safety = useQuery({
    queryKey: materialSafetyKeys.many(materialIds),
    queryFn: () => fetchMaterialSafetyFor(notebookDataClient, materialIds),
    enabled: materialIds.length > 0,
  })

  if (items.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noMaterialsLinked')}
      </p>
    )
  }

  return (
    <div aria-busy={loading}>
      {error ? (
        <p role="alert" className="pb-2 text-xs text-danger-text">
          {t('notebook.blockPreview.currentMaterialAvailabilityCould')}
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
                <p className="text-sm font-medium text-fg">{item.title}</p>
                <p className="font-mono text-xs text-fg-muted">
                  {item.identifier}
                </p>
                <MaterialHazards
                  safety={safety.data?.get(item.materialRecordId)}
                />
              </div>
              <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
                <span className="font-mono text-sm tabular-nums text-fg">
                  {item.quantity} {item.unit.symbol}
                </span>
                {loading ? (
                  <span className="text-xs text-fg-muted">
                    {t('notebook.blockPreview.checkingAvailability')}
                  </span>
                ) : null}
                {alerts.map((alert) => (
                  <Badge
                    key={alert.kind}
                    variant={alert.kind === 'unavailable' ? 'del' : 'chg'}
                  >
                    {alert.label}
                  </Badge>
                ))}
                {/* NOTE-03: open the material's canonical Record (Sample or
                Material) by stable UUID. Suppressed while the record cannot
                be resolved — an unresolvable link would be dishonest. */}
                {currentRecord ? (
                  <OpenLink
                    to={recordDestination(item.kind, item.materialRecordId)}
                  >
                    {t('common.actions.open')}
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

function renderMetric(payload: NotebookBlock['payload']): React.ReactNode {
  const obj = asObject(payload)

  if (!obj) return null
  const label = asString(obj.label) ?? ''
  const unit = asString(obj.unit) ?? ''
  const provenance = asString(obj.provenance) ?? ''

  // A value that carries its workings (a calculator answer) keeps four
  // significant figures: a weigh-out of 12.11 mg must not read as 12.1.
  const numeric = asNumber(obj.value)

  const value =
    provenance && numeric !== null
      ? String(Number(numeric.toPrecision(4)))
      : formatMetricValue(obj.value)

  return (
    <dl className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
        {label || t('notebook.blockPreview.metric')}
      </dt>
      <dd className="font-display text-2xl font-semibold leading-tight tabular-nums text-fg">
        {value}
        {unit ? (
          <span className="ml-1.5 text-sm font-normal text-fg-muted">
            {unit}
          </span>
        ) : null}
      </dd>
      {provenance ? (
        <dd className="text-xs text-fg-muted">{provenance}</dd>
      ) : null}
    </dl>
  )
}

function renderTable(payload: NotebookBlock['payload']): React.ReactNode {
  const obj = asObject(payload)

  if (!obj) return null
  const rawColumns = asArray(obj.columns)
  const rows = asArray(obj.rows)

  if (!rawColumns || !rows) return null

  // Canonical table payload (validated by validateTable): columns is an
  // array of strings, rows is an array of arrays.  A legacy object-based
  // format (columns with {key,label}, rows as keyed objects) is also handled.
  const stringColumns = z.array(z.string()).safeParse(rawColumns)

  const columns = stringColumns.success
    ? stringColumns.data.map((label, i) => ({
        label,
        key: String(i),
      }))
    : rawColumns.map((c, i) => ({
        label:
          asString(asObject(c)?.label) ??
          t('notebook.blockPreview.columnN', { n: i + 1 }),
        key: asString(asObject(c)?.key) ?? String(i),
      }))

  const columnEntries = readOnlyEntries(columns, (column) =>
    stringColumns.success ? column.label : column.key,
  )

  const rowEntries = readOnlyEntries(rows, (row) => JSON.stringify(row))

  const gridColumns: RegistryColumn<(typeof rowEntries)[number]>[] =
    columnEntries.map(({ key: columnKey, value: col }, j) => ({
      id: columnKey,
      header: col.label,
      accessorFn: ({ value: row }) =>
        formatCellValue(Array.isArray(row) ? row[j] : asObject(row)?.[col.key]),
    }))

  // The shared table box scrolls sideways, so a table wider than a phone
  // screen can be swiped across instead of being cut off at the edge.
  return (
    <div>
      <TableBox data-testid="notebook-table-block">
        <RegistryGrid
          label={t('notebook.blockPreview.tableLabel')}
          rows={rowEntries}
          columns={gridColumns}
          getRowId={(entry) => entry.key}
          selectable={false}
        />
      </TableBox>
      <p className="mt-1.5 text-xs text-fg-muted">
        {rows.length} {rows.length === 1 ? 'row' : 'rows'}
      </p>
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
    <p className="p-3 text-sm text-fg-muted" role="status">
      {t('notebook.blockPreview.thisBlockHasNo')}
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
      <div className="rounded-lg border p-3 text-sm text-fg-muted">
        {t('notebook.blockPreview.loadingSheet')}
      </div>
    )
  }

  if (instanceQuery.error || !instanceQuery.data) {
    return (
      <div
        className="rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 text-xs"
        role="alert"
      >
        <p className="font-medium text-fg">
          {t('notebook.blockPreview.sheetUnavailable')}
        </p>
        <p className="mt-1 text-fg-muted">
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
        <p className="text-xs font-medium text-fg">{instance.name}</p>
        {/* NOTE-03: the read preview carries the same canonical Sheet link
        as the live embed, built from the instance's stable UUID. */}
        <OpenLink to={sheetPath(instanceId)}>
          {t('notebook.blockPreview.openFullSheet')}
        </OpenLink>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {instance.sourceDefinitionVersionId
          ? t('notebook.blockPreview.sheetFromADefinition')
          : t('notebook.blockPreview.adHocSheetOpen')}
        {instance.lifecycle === 'archived'
          ? t('notebook.blockPreview.thisSheetIsArchived')
          : ''}
      </p>
    </div>
  )
}

function renderUnsupported(
  type: string,
  payload: NotebookBlock['payload'],
): React.ReactNode {
  const known = isBlockType(type)

  return (
    <div className="rounded-lg border border-dashed border-warning/30 bg-warning/10 p-3 text-xs">
      <p className="font-medium text-fg">
        {known
          ? t('notebook.blockPreview.unsupportedPayloadVersion')
          : t('notebook.blockPreview.unknownBlockTypeType', { type })}
      </p>
      <p className="mt-1 text-fg-muted">
        {t('notebook.blockPreview.thisKindOfBlock')}
      </p>
      <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-muted/40 p-2 font-mono text-xs">
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

function FileBlockPreview({
  payload,
  recordId,
}: {
  payload: unknown
  recordId?: string
}) {
  const obj = asObject(payload)
  const fileRecordId = asString(obj?.fileRecordId)

  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noFileAttachedSelect')}
      </p>
    )
  }

  if (!fileRecordId) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.thisFileBlockIs')}
      </p>
    )
  }

  return (
    <StoredFilePreview
      payload={obj}
      fileRecordId={fileRecordId}
      recordId={recordId}
    />
  )
}

/** The storage read, not the block's draft metadata, controls preview availability. */
function StoredFilePreview({
  payload: obj,
  fileRecordId,
  recordId,
}: {
  payload: NotebookBlock['payload']
  fileRecordId: string
  recordId?: string
}) {
  const draftName = asString(obj.displayName) ?? ''
  const draftMediaType = asString(obj.mediaType) ?? ''
  const draftByteSize = asNumber(obj.byteSize)

  const live = useQuery({
    queryKey: notebookQueryKeys.fileObject(fileRecordId),
    queryFn: () => fetchFileObjectByRecordId(notebookDataClient, fileRecordId),
  })

  const name = live.data?.displayName ?? draftName
  const mediaType = live.data?.mediaType ?? draftMediaType
  const byteSize = live.data?.byteSize ?? draftByteSize ?? 0

  return (
    <StoredFileState
      live={live}
      name={name}
      mediaType={mediaType}
      byteSize={byteSize}
      payload={obj}
      fileRecordId={fileRecordId}
      recordId={recordId}
    />
  )
}

/** Storage availability controls whether retained metadata may become a preview. */
function StoredFileState({
  live,
  name,
  mediaType,
  byteSize,
  payload,
  fileRecordId,
  recordId,
}: {
  live: UseQueryResult<Awaited<ReturnType<typeof fetchFileObjectByRecordId>>>
  name: string
  mediaType: string
  byteSize: number
  payload: NotebookBlock['payload']
  fileRecordId: string
  recordId?: string
}) {
  const status = live.data?.status ?? null

  if (live.isLoading) {
    return (
      <div className="flex items-center gap-2.5 text-sm text-fg-muted">
        <FileIcon mediaType={mediaType} />
        <span>{name || t('notebook.blockPreview.loadingFile')}</span>
      </div>
    )
  }

  if (live.error) {
    return (
      <div className="text-sm">
        <p className="font-medium text-fg">
          {name || t('notebook.blockPreview.file')}
        </p>
        <p role="alert" className="mt-1 text-xs text-danger-text">
          {t('notebook.blockPreview.fileStatusCouldNot')}
        </p>
      </div>
    )
  }

  if (status === 'missing' || !live.data) {
    return (
      <div className="text-sm">
        <p className="font-medium text-fg">
          {name || t('notebook.blockPreview.file')}
        </p>
        <p className="mt-1 text-xs text-warning-text">
          {t('notebook.blockPreview.theStorageObjectFor')}
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }

  if (status === 'quarantined') {
    return (
      <div className="text-sm">
        <p className="font-medium text-fg">{name}</p>
        <p className="mt-1 text-xs text-warning-text">
          {live.data.statusReason
            ? t('notebook.blockPreview.quarantinedWithReason', {
                reason: live.data.statusReason,
              })
            : t('notebook.blockPreview.quarantined')}
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }

  if (status === 'deleted') {
    return (
      <div className="text-sm">
        <p className="font-medium text-fg-muted line-through">{name}</p>
        <p className="mt-1 text-xs text-fg-muted">
          {t('notebook.blockPreview.thisFileIsDeleted')}
        </p>
        <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
      </div>
    )
  }

  return (
    <AvailableFilePreview
      payload={payload}
      fileRecordId={fileRecordId}
      name={name}
      mediaType={mediaType}
      byteSize={byteSize}
      recordId={recordId}
    />
  )
}

function AvailableFilePreview({
  payload,
  fileRecordId,
  name,
  mediaType,
  byteSize,
  recordId,
}: {
  payload: NotebookBlock['payload']
  fileRecordId: string
  name: string
  mediaType: string
  byteSize: number
  recordId?: string
}) {
  const showImage = isInlinePreviewableImage(mediaType)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileIcon mediaType={mediaType} />
          <div className="min-w-0">
            <a
              href={`/api/files/${fileRecordId}/download`}
              className="font-medium text-fg underline-offset-2 hover:underline"
              download
            >
              {name}
            </a>
            <FileMetaLine mediaType={mediaType} byteSize={byteSize} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OfficeEditButton
            fileRecordId={fileRecordId}
            fileName={name}
            recordId={recordId}
          />
          <Badge variant="add">
            <Icon name="check" size={12} aria-hidden="true" />
            {t('notebook.blockPreview.active')}
          </Badge>
        </div>
      </div>
      {showImage ? (
        <ImageWithMarks
          src={`/api/files/${fileRecordId}/download`}
          name={name}
          annotations={readAnnotations(payload)}
        />
      ) : null}
      {isSequenceFileName(name) ? (
        <SequenceToggle fileRecordId={fileRecordId} />
      ) : null}
      <PluginFilePreview fileRecordId={fileRecordId} fileName={name} />
      {!showImage && !isSequenceFileName(name) ? (
        <OfficeFileBlock payload={payload} />
      ) : null}
    </div>
  )
}

/** A sequence file opens as a map on request, so a notebook with several
 * does not download them all just to be read. */
function SequenceToggle({ fileRecordId }: { fileRecordId: string }) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? t('sequences.viewer.hide') : t('sequences.viewer.open')}
      </Button>
      {open ? <SequenceFileViewer fileRecordId={fileRecordId} /> : null}
    </div>
  )
}

/**
 * The image with its marks. When there are marks, a switch shows the original
 * and a download hands back a PNG copy with the marks baked in.
 */
function ImageWithMarks({
  src,
  name,
  annotations,
}: {
  src: string
  name: string
  annotations: ReturnType<typeof readAnnotations>
}) {
  const [showMarks, setShowMarks] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const marked = annotations.length > 0

  async function download() {
    setBusy(true)

    try {
      const blob = await renderAnnotatedPng(src, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name.replace(/\.[^.]+$/, '')}-annotated.png`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <AnnotatedImage
        src={src}
        alt={
          marked && showMarks
            ? t('notebook.imageAnnotations.imageAlt', { name })
            : name
        }
        annotations={showMarks ? annotations : []}
        imageClassName="max-h-80"
      />
      {marked ? (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t('notebook.imageAnnotations.viewToggle')}
            className="flex gap-1"
          >
            <Button
              size="sm"
              variant={showMarks ? 'primary' : 'secondary'}
              aria-pressed={showMarks}
              onClick={() => setShowMarks(true)}
            >
              {t('notebook.imageAnnotations.showAnnotated')}
            </Button>
            <Button
              size="sm"
              variant={showMarks ? 'secondary' : 'primary'}
              aria-pressed={!showMarks}
              onClick={() => setShowMarks(false)}
            >
              {t('notebook.imageAnnotations.showOriginal')}
            </Button>
          </div>
          <Button size="sm" icon="download" disabled={busy} onClick={download}>
            {t('notebook.imageAnnotations.downloadAnnotated')}
          </Button>
        </div>
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
    <p className="font-mono text-xs text-fg-muted">
      {mediaType || 'unknown'} · {formatFileSize(byteSize)}
    </p>
  )
}

function fileIconForType(mediaType: string): IconName {
  if (mediaType.startsWith('image/')) return 'box'

  if (mediaType === 'application/pdf') return 'download'

  if (mediaType.includes('spreadsheet') || mediaType === 'text/csv') {
    return 'table'
  }

  if (mediaType.includes('wordprocessing')) return 'download'

  return 'download'
}

function FileIcon({ mediaType }: { mediaType: string }) {
  const iconName = fileIconForType(mediaType)

  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted"
    >
      <Icon name={iconName} size={16} />
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
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noChartConfiguredSelect')}
      </p>
    )
  }

  const title = asString(obj.title) ?? t('notebook.blockPreview.chart')
  const provenance = asString(obj.provenance) ?? undefined
  const spec = parseChartSpec(obj.spec)
  const frozen = parseFrozenChart(obj.frozen)

  // A broken frozen payload must never become a live chart of today's rows.
  if (obj.frozen != null && !frozen) {
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.frozenVersionLost')}
      </EvidenceAlert>
    )
  }

  // No spec and no frozen snapshot: nothing to plot. Avoid the live resolver
  // (and its React Query context) when the chart is still an empty draft.
  if (!spec && !frozen) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noChartConfiguredSelect')}
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
    .filter((d) => d.datasetId.length > 0)
    .map((d) => ({ datasetId: d.datasetId }))
}

function chartSourcesFromFrozen(
  frozen: NonNullable<ChartBlockPayload['frozen']>,
): ChartDatasetSource[] {
  return frozen.datasetProvenance
    .filter((p) => p.datasetId.length > 0)
    .map((p) => ({
      datasetId: p.datasetId,
      versionId:
        p.datasetVersionId && p.datasetVersionId.length > 0
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
function ChartOpenDatasetActions({
  sources,
}: {
  sources: ChartDatasetSource[]
}) {
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
          to={
            source.versionId
              ? datasetVersionPath(source.datasetId, source.versionId)
              : datasetPath(source.datasetId)
          }
          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
        >
          {multi
            ? source.versionId
              ? t('notebook.blockPreview.datasetIndexVersionVersionid', {
                  index: index + 1,
                  versionId: source.versionId.slice(0, 8),
                })
              : t('notebook.blockPreview.datasetIndex', { index: index + 1 })
            : t('notebook.blockPreview.openDataset')}
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
      ? t('notebook.blockPreview.datasetVersionVersionid', {
          versionId: versionId.slice(0, 8),
        })
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
          error={t('notebook.blockPreview.frozenVersionLost')}
          subtitle={versionSubtitle}
          actions={openDataset}
        />
      )
    }

    const reconstructed = reconstructFrozenVisualisation({
      spec,
      frozen,
      rows: pinned.data.rows,
      flags: pinned.data.flags,
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
        error={t('notebook.blockPreview.datasetNotLoaded')}
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

const previewChartSpec = chartSpec
  .refine((spec) => spec.specVersion === CHART_SPEC_VERSION)
  .nullable()
  .catch(null)

const parseChartSpec = previewChartSpec.parse.bind(previewChartSpec)
const previewFrozenChart = frozenChart.nullable().catch(null)
const parseFrozenChart = previewFrozenChart.parse.bind(previewFrozenChart)

// ---------------------------------------------------------------------------
// SCI-005 plate map block preview. Renders the plate grid with assignment-
// role colours, a legend, and honest sample-reference resolution. An empty
// draft `{}` prompts the user to configure the plate in the editor.
// ---------------------------------------------------------------------------

/** Only live plates resolve current samples; frozen plates use their saved citations. */
function usePlateSampleObservations(
  spec: ReturnType<typeof parsePlateMapSpec>,
  frozen: boolean,
) {
  const sampleRefs =
    spec?.wells.flatMap((well) => (well.sampleRef ? [well.sampleRef] : [])) ??
    []

  const sampleQueries = useQueries({
    queries: frozen
      ? []
      : sampleRefs.map((ref) => ({
          queryKey: notebookQueryKeys.record(ref.recordId),
          queryFn: () => fetchRecordById(notebookDataClient, ref.recordId),
          staleTime: 30_000,
        })),
  })

  const observations = new Map<string, LiveSampleObservation>()

  if (!frozen) {
    sampleRefs.forEach((ref, i) => {
      const query = sampleQueries.at(i)
      observations.set(
        ref.recordId,
        liveSampleObservationFromQuery({
          data: query?.data ?? null,
          error: query?.error ?? null,
          isLoading: query?.isLoading ?? false,
        }),
      )
    })
  }

  return observations
}

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
  const title = titleStr ?? t('notebook.blockPreview.plateMap')
  const spec = obj && !isEmpty ? parsePlateMapSpec(obj.spec) : null

  if (isEmpty) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noPlateMapConfigured')}
      </p>
    )
  }

  if (!spec) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.titlePlateMapSpec', { title })}
      </p>
    )
  }

  return <ResolvedPlateMap spec={spec} title={title} frozen={frozen} />
}

/** Only a validated plate owns sample queries and read-only well selection. */
function ResolvedPlateMap({
  spec,
  title,
  frozen,
}: {
  spec: NonNullable<ReturnType<typeof parsePlateMapSpec>>
  title: string
  frozen: boolean
}) {
  const [selectedWellCode, setSelectedWellCode] = React.useState<string | null>(
    null,
  )

  const observations = usePlateSampleObservations(spec, frozen)

  // VIEW-01: the shared representation frame owns the outer chrome (title,
  // frozen-vs-live badge) for spec-backed plates, mirroring the chart
  // preview. The plate grid stays plugged in as children.
  const handle = plateMapToRepresentationHandle({ spec, title, frozen })

  const resolutionByWell = new Map<string, WellSampleResolution>()

  for (const w of spec.wells) {
    if (!w.sampleRef) continue

    const resolution = resolveWellSample(
      w,
      observations.get(w.sampleRef.recordId),
    )

    if (resolution) resolutionByWell.set(w.wellCode, resolution)
  }

  const loading = [...observations.values()].some((o) => o.status === 'loading')

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
          <span className="text-xs text-fg-muted">
            {t('notebook.blockPreview.noWellsAssigned')}
          </span>
        ) : (
          <span className="text-xs text-fg-muted">
            {spec.wells.length} well{spec.wells.length !== 1 ? 's' : ''} ·{' '}
            {spec.rows}×{spec.cols}
          </span>
        )}
      </div>
      {referenceFailure ? (
        <p role="alert" className="text-xs text-danger-text">
          {t('notebook.blockPreview.someSampleReferencesCould')}
        </p>
      ) : null}
      {loading ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.blockPreview.loadingSampleDetails')}
        </p>
      ) : null}
      <PlateMap
        wells={plateWells}
        rows={spec.rows}
        cols={spec.cols}
        ariaLabel={t('notebook.blockPreview.titleRowsColsPlateAriaLabel', {
          title,
          rows: spec.rows,
          cols: spec.cols,
        })}
        roleLegend={roleLegend}
        readOnly
        selectable
        selectedWellCode={selectedWellCode}
        onSelectWellCode={(code) =>
          setSelectedWellCode((prev) => (prev === code ? null : code))
        }
        compact
      />
      {selection ? <PlateWellSelectionSummary selection={selection} /> : null}
      {linkedSamples.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-fg-muted">
            {t('notebook.blockPreview.samples')}
          </span>
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
      className="rounded-md border bg-surface-muted/20 px-2 py-1.5"
      aria-live="polite"
    >
      <p className="text-xs font-medium">
        {well
          ? t('notebook.blockPreview.wellWithRole', {
              wellCode: selection.wellCode,
              role: ROLE_STYLES[well.role].label,
            })
          : t('notebook.blockPreview.wellUnassigned', {
              wellCode: selection.wellCode,
            })}
      </p>
      {well?.replicate ? (
        <p className="text-xs text-fg-muted">
          {well.volume
            ? t('notebook.blockPreview.replicateWithVolume', {
                replicate: well.replicate,
                value: well.volume.value,
                unit: well.volume.unit,
              })
            : t('notebook.blockPreview.replicate', {
                replicate: well.replicate,
              })}
        </p>
      ) : well?.volume ? (
        <p className="text-xs text-fg-muted">
          {well.volume.value} {well.volume.unit}
        </p>
      ) : null}
      {sampleRef ? (
        <p className="truncate text-xs text-fg-muted">
          {sampleRef.identifier.trim() || sampleRef.recordId}
          {sampleRef.title ? ` · ${sampleRef.title}` : ''}
          {resolution ? ` · ${describeWellSampleState(resolution)}` : ''}
        </p>
      ) : null}
      {sampleRef && resolution?.state !== 'loading' ? (
        <OpenLink to={recordDestination('sample', sampleRef.recordId)}>
          {t('notebook.blockPreview.openSampleRecord')}
        </OpenLink>
      ) : null}
    </div>
  )
}

function describeWellSampleState(resolution: WellSampleResolution): string {
  switch (resolution.state) {
    case 'active':
      return resolution.snapshotOnly
        ? t('notebook.blockPreview.activeSnapshot')
        : 'active'
    case 'archived':
      return resolution.snapshotOnly
        ? t('notebook.blockPreview.archivedSnapshot')
        : 'archived'
    case 'loading':
      return t('notebook.blockPreview.loading')
    case 'missing':
      return t('notebook.blockPreview.missingDeletedOrInaccessible')
    case 'restricted':
      return t('notebook.blockPreview.restrictedNoAccess')
    case 'error':
      return t('notebook.blockPreview.referenceCouldNotBe')
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

  if (w.replicate)
    parts.push(
      t('notebook.blockPreview.replicateLower', { replicate: w.replicate }),
    )

  if (w.volume) parts.push(`${w.volume.value} ${w.volume.unit}`)

  if (w.notes) parts.push(w.notes)

  return parts.join(' · ')
}

const previewPlateSpec = plateSpec
  .refine((spec) => spec.specVersion === PLATE_MAP_SPEC_VERSION)
  .nullable()
  .catch(null)

const parsePlateMapSpec = previewPlateSpec.parse.bind(previewPlateSpec)

// ---------------------------------------------------------------------------
// SCI-03 analysis block preview. A live block loads the referenced saved
// definition and executes it against current dataset rows (Reload re-runs
// on demand). A frozen block re-executes the pinned definition over the
// pinned inputs — never a live re-read — so evidence stays reproducible.
// ---------------------------------------------------------------------------

const previewFrozenAnalysis = frozenAnalysis.nullable().catch(null)

const parseFrozenAnalysis = previewFrozenAnalysis.parse.bind(
  previewFrozenAnalysis,
)

export function AnalysisBlockPreview({ payload }: { payload: unknown }) {
  const obj = asObject(payload)

  if (!obj || Object.keys(obj).length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noAnalysisConfiguredSelect')}
      </p>
    )
  }

  const definitionId = asString(obj.definitionId)
  const title = asString(obj.title) ?? t('notebook.blockPreview.analysis')
  const provenance = asString(obj.provenance) ?? undefined
  const frozen = parseFrozenAnalysis(obj.frozen)

  // Keep the immutable/live boundary even when the recorded payload is malformed.
  if (obj.frozen != null && !frozen) {
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.frozenVersionLost')}
      </EvidenceAlert>
    )
  }

  if (frozen) {
    return (
      <FrozenAnalysisPreview
        frozen={frozen}
        provenance={provenance}
        title={title}
      />
    )
  }

  if (!definitionId) {
    return (
      <p className="text-sm text-fg-muted">
        {t('notebook.blockPreview.noAnalysisConfiguredSelect')}
      </p>
    )
  }

  return (
    <LiveAnalysisPreview
      title={title}
      provenance={provenance}
      definitionId={definitionId}
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
      <div role="status" className="text-xs text-fg-muted">
        {t('notebook.blockPreview.loadingAnalysis')}
      </div>
    )

  if (definitionQuery.error || !definitionQuery.data)
    return (
      <div role="alert" className="text-xs text-danger-text">
        {t('notebook.blockPreview.theSavedAnalysisCould')}
      </div>
    )
  const saved = definitionQuery.data
  const parsed = analysisDefinition.safeParse(saved.definition)
  const definition = parsed.success ? parsed.data : null

  if (!definition)
    return (
      <div role="alert" className="text-xs text-danger-text">
        {t('notebook.blockPreview.theSavedAnalysisHas')}
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
  definition: AnalysisBlockDefinition
  datasetId: string
}) {
  const parts = analysisBlockParts(definition)

  const resolvedQuery = useQuery({
    queryKey: [
      'analysis-block-dataset',
      datasetId,
      definition.datasets[0]?.datasetVersionId,
    ] as const,
    queryFn: () => resolveDatasetRef(sciDataClient, definition.datasets[0]),
    enabled: Boolean(datasetId),
    staleTime: 10_000,
  })

  const executed =
    parts.statistic &&
    !resolvedQuery.isError &&
    resolvedQuery.data &&
    !resolvedQuery.data.truncated
      ? runAnalysis(
          parts.statistic,
          resolvedQuery.data.source.columns,
          resolvedQuery.data.rows,
          resolvedQuery.data.flags,
        )
      : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="kind">
          {name} · v{version}
        </Badge>
        {/* NOTE-03: open the canonical Dataset the analysis executes over. */}
        {datasetId ? (
          <OpenLink
            to={
              definition.datasets[0]?.datasetVersionId
                ? datasetVersionPath(
                    datasetId,
                    definition.datasets[0].datasetVersionId,
                  )
                : datasetPath(datasetId)
            }
          >
            {t('notebook.blockPreview.openDataset')}
          </OpenLink>
        ) : null}
        {resolvedQuery.isFetching ? (
          <span className="text-xs text-fg-muted">
            {t('notebook.blockPreview.loadingRows')}
          </span>
        ) : null}
      </div>
      {parts.chart ? (
        <LiveChartPreview
          title={title}
          spec={parts.chart}
          sources={chartSourcesFromSpec(parts.chart)}
          hideTitle
        />
      ) : null}
      {definition.datasets[0]?.datasetVersionId ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.blockPreview.readingDatasetVersionDatasetversionid', {
            datasetVersionId: definition.datasets[0].datasetVersionId,
          })}
        </p>
      ) : null}
      <AnalysisExecutionResult
        error={resolvedQuery.error}
        hasStatistic={Boolean(parts.statistic)}
        executed={executed}
      />
      {provenance ? (
        <p className="text-xs text-fg-muted">{provenance}</p>
      ) : null}
      <span className="sr-only">{title}</span>
    </div>
  )
}

/** Execution states are separate from chart/pinned-source query ownership. */
function AnalysisExecutionResult({
  error,
  hasStatistic,
  executed,
}: {
  error: Error | null
  hasStatistic: boolean
  executed: ReturnType<typeof runAnalysis> | null
}) {
  if (error)
    return (
      <div role="alert" className="text-xs text-danger-text">
        {error.message}
      </div>
    )

  if (!hasStatistic) return null

  if (executed?.ok) return <AnalysisResultTable result={executed.result} />

  if (executed)
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-danger-text"
      >
        {executed.error.code === 'empty_dataset'
          ? t('notebook.blockPreview.theDatasetHasNo')
          : t('notebook.blockPreview.thisAnalysisCannotExecute', {
              code: executed.error.code,
            })}
      </div>
    )

  return (
    <div role="status" className="text-xs text-fg-muted">
      {t('notebook.blockPreview.preparingAnalysis')}
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
    queryKey: [
      'analysis-frozen-version-rows',
      pin?.datasetVersionId,
      pin?.rowCount,
      frozen.exclusionPolicy,
    ] as const,
    queryFn: () => {
      if (!pin)
        throw new Error(t('notebook.blockPreview.noPinnedDatasetVersion'))

      return fetchFrozenAnalysisRows(
        sciDataClient,
        pin.datasetVersionId,
        pin.rowCount,
        frozen.exclusionPolicy,
      )
    },
    enabled: Boolean(pin),
    staleTime: 10_000,
  })

  const provenanceParts = frozen.datasetProvenance.map((p) =>
    t('notebook.blockPreview.datasetDatasetidVersionDatasetversionid', {
      datasetId: p.datasetId.slice(0, 8),
      datasetVersionId: p.datasetVersionId.slice(0, 8),
      rowCount: p.rowCount,
      checksum: p.checksum.slice(0, 8),
    }),
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="chg">
          <Icon name="archive" size={12} aria-hidden />
          {t('notebook.blockPreview.frozenSnapshotFrozenat', {
            frozenAt: frozen.frozenAt,
          })}
        </Badge>
        <span className="text-xs text-fg-muted">
          {t('notebook.blockPreview.provenanceProvenanceparts', {
            provenanceParts: provenanceParts.join(', '),
          })}
        </span>
        <span className="text-xs text-fg-muted">
          {frozen.exclusionPolicy === 'exclude_bound_fields'
            ? t('notebook.blockPreview.flagPolicyExcludeRows')
            : t('notebook.blockPreview.flagPolicyIncludeAll')}
        </span>
        {pin ? (
          <OpenLink
            to={datasetVersionPath(pin.datasetId, pin.datasetVersionId)}
          >
            {t('notebook.blockPreview.openDataset')}
          </OpenLink>
        ) : null}
      </div>
      <FrozenAnalysisEvidence
        frozen={frozen}
        title={title}
        rows={rowsQuery.data}
        isLoading={rowsQuery.isLoading}
        hasError={Boolean(rowsQuery.error)}
      />
      {provenance ? (
        <p className="text-xs text-fg-muted">{provenance}</p>
      ) : null}
      <span className="sr-only">{title}</span>
    </div>
  )
}

/** Reconstruct only after the immutable input and recorded method checks pass. */
function FrozenAnalysisEvidence({
  frozen,
  title,
  rows,
  isLoading,
  hasError,
}: {
  frozen: FrozenAnalysis
  title: string
  rows: Awaited<ReturnType<typeof fetchFrozenAnalysisRows>> | undefined
  isLoading: boolean
  hasError: boolean
}) {
  const pin = frozen.datasetProvenance.at(0)

  if (!pin)
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.thisFrozenBlockDoes')}
      </EvidenceAlert>
    )

  if (isLoading)
    return (
      <div role="status" className="text-xs text-fg-muted">
        {t('notebook.blockPreview.rebuildingFromTheFrozen')}
      </div>
    )

  if (hasError)
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.theDatasetVersionThis')}
      </EvidenceAlert>
    )

  if (rows && !rows.matchesProvenance)
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.evidenceMismatchTheDataset', {
          totalCount: rows.totalCount,
          rowCount: pin.rowCount,
        })}
      </EvidenceAlert>
    )

  // R5-STUDIO-01: never silently execute under a different method version.
  const methodMismatch = frozenAnalysisMethodMismatch(frozen)

  if (methodMismatch)
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.methodMismatchThisSnapshot', {
          recorded: methodMismatch.recorded,
          current: methodMismatch.current,
        })}
      </EvidenceAlert>
    )

  if (!rows) return null

  const columns = frozen.columns.map((c) => ({
    id: c.fieldId,
    label: c.label,
    logicalType: c.logicalType,
    unit: c.unit,
  }))

  const parts = analysisBlockParts(frozen.definition)

  const executed = parts.statistic
    ? runAnalysis(parts.statistic, columns, rows.rows, rows.flags)
    : null

  // Chart and statistics use the same pinned rows, never a live re-read.
  const chartMaterialised = parts.chart
    ? materialiseLiveChart(parts.chart, {
        source: {
          datasetId: pin.datasetId,
          name: 'Pinned Dataset Version',
          workspaceId: '',
          schemaVersionId: '',
          schemaVersionNumber: pin.schemaVersionNumber,
          revision: pin.sourceDatasetRevision,
          columns,
        },
        rows: rows.rows,
        flags: rows.flags,
        truncated: false,
        totalCount: pin.rowCount,
      })
    : null

  return (
    <>
      {parts.chart && chartMaterialised ? (
        <ChartRenderer
          title={title}
          hideTitle
          spec={parts.chart}
          materialised={chartMaterialised}
          frozen={null}
        />
      ) : null}
      <FrozenStatisticResult
        executed={executed}
        legacyMethod={frozenAnalysisMethodVersion(frozen) === null}
      />
    </>
  )
}

function FrozenStatisticResult({
  executed,
  legacyMethod,
}: {
  executed: ReturnType<typeof runAnalysis> | null
  legacyMethod: boolean
}) {
  if (!executed) return null

  if (!executed.ok)
    return (
      <EvidenceAlert>
        {t('notebook.blockPreview.thePinnedInputsNo', {
          code: executed.error.code,
        })}
      </EvidenceAlert>
    )

  return (
    <>
      <AnalysisResultTable result={executed.result} />
      {legacyMethod ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.blockPreview.thisSnapshotWasTaken')}
        </p>
      ) : null}
    </>
  )
}

function EvidenceAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-danger-text"
    >
      {children}
    </div>
  )
}
