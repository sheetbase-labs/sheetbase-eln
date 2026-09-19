/**
 * Editable block content for the initial authoring types (ELN-005):
 * rich_text, checklist, linked_record.
 *
 * ELN-007 — autosave + conflict handling. Each typed editor drives a
 * `useAutosave` state machine: edits are debounced, saves carry the
 * expected server version (read at call time by the route) and the
 * stable client identity (attached automatically by `createDataClient`),
 * transient failures retry with bounded backoff, validation failures stay
 * attached to the block, and a server version conflict preserves both the
 * local draft and the canonical server value behind an explicit resolution
 * banner — never silently overwriting either side.
 *
 * `readOnly` disables editing (archived notebooks, etc.).
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import { explainBlockValidation } from '#/lib/assist-explain'
import { ExplainPanel } from '#/components/assist/explain-panel'
import {
  RichTextContent,
  isRichTextPayload,
  richTextToPlainText,
  validateBlock,
} from '#/lib/blocks'
import type { BlockValidationError, RichTextPayload } from '#/lib/blocks'
import { notebookDataClient } from '#/lib/notebook-data'
import type {
  NotebookBlock,
  NotebookRecord,
  RecordWire,
} from '#/lib/notebook-data'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { datasetPath, recordDestination } from '#/lib/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  Textarea,
} from '#/components/ui'
import {
  Plus,
  Trash2,
  File as FileIcon,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Snowflake,
  Pencil,
  Link2,
  Pin,
  FlaskConical,
  Beaker,
} from 'lucide-react'
import { RecordPicker } from '#/components/scientific'
import type { RecordPickerResult } from '#/components/scientific'
import {
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { MaterialItem } from '#/lib/protocol-materials'
import { useAutosave } from './use-autosave'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import { SaveStatus } from './save-status'
import { ConflictBanner } from './conflict-banner'
import { OpenLink } from './block-preview'
import { RichTextEditor as TiptapRichTextEditor } from './rich-text-editor'
import {
  AttachFileError,
  formatBytes,
  validateFileForUpload,
} from '#/lib/file-attach'
import { FILE_MAX_BYTES, isInlinePreviewableImage } from '#/lib/file-policy'
import { CHART_SPEC_VERSION, CHART_TYPES } from '#/lib/chart-spec'
import type { AnalysisBlockPayload } from '#/lib/analysis-block'
import { validateAnalysisBlockPayload } from '#/lib/analysis-block'
import { PipelineOutputBlockEditor } from './pipeline-output-block-editor'
import {
  analysisDefinitionQueryKeys,
  fetchAnalysisDefinitions,
} from '#/lib/analysis-definitions-data'
import type {
  ChartBlockPayload,
  ChartSpec,
  ChartType,
  AxisScale,
} from '#/lib/chart-spec'
import {
  fetchCanonicalDataset,
  frozenPinsDatasetVersion,
  materialiseFrozenChart,
  materialiseFrozenFacets,
  materialiseLiveChart,
  reconstructFrozenVisualisation,
  sciDataClient,
  toCanonicalDatasetSource,
  useFrozenPinnedRows,
  useLiveChartDataset,
} from '#/lib/chart-data'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { PlateMap } from '#/components/viz/plate-map'
import {
  ASSIGNMENT_ROLES,
  ROLE_STYLES,
  defaultPlateMapSpec,
  parseWellCode,
} from '#/lib/plate-map'
import type {
  AssignmentRole,
  PlateMapBlockPayload,
  PlateMapSpec,
  WellAssignment,
} from '#/lib/plate-map'
import type { ScientificRecordKind } from '#/lib/scientific-records'

export type { AutosaveStatus, SaveResult }

export interface BlockEditorProps {
  block: NotebookBlock
  /**
   * Persist a validated payload. Returns a structured result so the
   * editor's autosave state machine can branch on conflict / validation /
   * transient. The route reads the latest expected version from the query
   * cache at call time; the editor does not pass a version.
   */
  save: (
    payload: Record<string, unknown>,
  ) => Promise<SaveResult<Record<string, unknown>>>
  /** When true, holds saves (live-event stream offline). */
  offline?: boolean
  /** Called whenever the block's autosave status changes. */
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
  /**
   * NOTE-02: when set (rich_text only), headings in the editable Tiptap DOM
   * get stable `#<prefix>-h<index>` outline anchors, matching read view.
   */
  headingAnchorPrefix?: string
  /**
   * NOTE-02 same-block collapse: rich_text node indexes hidden by a
   * collapsed section. Hidden from view, preserved for print, never removed
   * from the payload.
   */
  hiddenRichTextNodeIndexes?: ReadonlySet<number>
  /** Transactionally pin a selected protocol and copy its procedure steps. */
  pinProtocol?: (protocolRecordId: string) => Promise<void>
  /** SCI-003: attach an uploaded file to an empty file block. */
  onAttachFile?: (file: File) => Promise<void>
  /** SCI-004: freeze a chart block into an immutable snapshot. */
  onFreezeChart?: () => Promise<void>
  /** SCI-004: remove the frozen snapshot so the chart can be edited again. */
  onUnfreezeChart?: () => Promise<void>
  /** SCI-03: freeze an analysis block into an immutable evidence snapshot. */
  onFreezeAnalysis?: () => Promise<void>
  /** SCI-03: remove the frozen analysis snapshot so the block is live again. */
  onUnfreezeAnalysis?: () => Promise<void>
  /** Slash command: user picked a block type from the `/` menu. */
  onSlashCommand?: (type: string) => void
  /** Enter at end of the last paragraph → create a new text block below. */
  onEnterAtEnd?: () => void
  /** Backspace at start of an empty block → delete and focus previous. */
  onBackspaceAtStart?: () => void
  /** ArrowUp at start of first paragraph → focus previous block. */
  onArrowUpFromStart?: () => void
  /** ArrowDown at end of last paragraph → focus next block. */
  onArrowDownFromEnd?: () => void
}

export function BlockEditor(props: BlockEditorProps) {
  if (
    props.block.type === 'rich_text' &&
    !isRichTextPayload(props.block.payload)
  ) {
    return <UnsupportedEditor block={props.block} className={props.className} />
  }
  switch (props.block.type) {
    case 'rich_text':
      return <RichTextEditor {...props} />
    case 'checklist':
      return <ChecklistEditor {...props} />
    case 'linked_record':
      return <LinkedRecordEditor {...props} />
    case 'protocol_reference':
      return <ProtocolReferenceEditor {...props} />
    case 'procedure_step':
      return <ProcedureStepEditor {...props} />
    case 'materials':
      return <MaterialsEditor {...props} />
    case 'file':
      return <FileBlockEditor {...props} />
    case 'chart':
      return <ChartBlockEditor {...props} />
    case 'analysis':
      return <AnalysisBlockEditor {...props} />
    case 'pipeline_output':
      return <PipelineOutputBlockEditor {...props} />
    case 'plate_map':
      return <PlateMapBlockEditor {...props} />
    default:
      return (
        <UnsupportedEditor block={props.block} className={props.className} />
      )
  }
}

// ---------------------------------------------------------------------------
// Shared autosave draft hook. Wraps `useAutosave` with the block's typed
// payload shape and the block validator, so each editor only deals with its
// own draft fields.
// ---------------------------------------------------------------------------

function useBlockAutosave<T>(
  block: NotebookBlock,
  initialDraft: T,
  save: BlockEditorProps['save'],
  offline: boolean | undefined,
  onStatusChange: BlockEditorProps['onStatusChange'],
) {
  const validate = React.useCallback(
    (value: T) => {
      const r = validateBlock({
        type: block.type,
        payload: value,
        payloadSchemaVersion: block.payloadSchemaVersion,
      })
      return r.ok ? [] : r.errors.map((e) => e.message)
    },
    [block.type, block.payloadSchemaVersion],
  )

  const saveAdapter = React.useCallback(
    async (value: T): Promise<SaveResult<T>> => {
      const r = await save(value as unknown as Record<string, unknown>)
      return r as unknown as SaveResult<T>
    },
    [save],
  )

  const [touched, setTouched] = React.useState(false)
  const autosave = useAutosave<T>({
    initialValue: initialDraft,
    validate,
    save: saveAdapter,
    offline: offline ?? false,
    touched,
  })
  // Structured errors for the Explain affordance: re-runs the same kernel
  // over the same draft the string errors came from, so the explanation can
  // cite rule codes and fields instead of raw strings.
  const structuredErrors = React.useMemo(() => {
    const result = validateBlock({
      type: block.type,
      payload: autosave.draft,
      payloadSchemaVersion: block.payloadSchemaVersion,
    })
    return result.ok ? [] : result.errors
  }, [autosave.draft, block.type, block.payloadSchemaVersion])
  // Report before the browser can move focus into another block. The
  // document keeps non-clean editors mounted until autosave settles, which
  // preserves drafts and conflict controls across block navigation.
  React.useLayoutEffect(() => {
    onStatusChange?.(autosave.status)
  }, [autosave.status, onStatusChange])

  return { ...autosave, setTouched, structuredErrors }
}

/**
 * Readable one-line preview of a payload, used in the conflict banner so
 * the user can comprehend the server version without switching tabs.
 */
function summarizePayload(
  type: string,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case 'rich_text':
      return isRichTextPayload(payload)
        ? richTextToPlainText(payload) || '(empty)'
        : '(empty)'
    case 'checklist': {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (items.length === 0) return '(no items)'
      return items
        .map(
          (i) =>
            `[${(i as { checked?: boolean }).checked ? 'x' : ' '}] ${
              (i as { text?: string }).text ?? ''
            }`,
        )
        .join('\n')
    }
    case 'linked_record':
      return `${payload.linkType ?? 'general'}: ${payload.targetKind ?? ''} ${
        payload.targetIdentifier ?? ''
      }${payload.label ? ` — ${payload.label}` : ''}`
    case 'plate_map': {
      const title = typeof payload.title === 'string' ? payload.title : ''
      const spec = payload.spec as { wells?: unknown[] } | undefined
      const wells = Array.isArray(spec?.wells) ? spec.wells : []
      return `${title || 'Plate map'} — ${wells.length} well(s)`
    }
    case 'analysis':
      return `${payload.title || 'Analysis'}${
        payload.frozen ? ' (frozen)' : ''
      }`
    case 'pipeline_output':
      return `Pipeline output${
        payload.runId ? ` — run ${String(payload.runId).slice(0, 8)}` : ''
      }`
    default:
      return JSON.stringify(payload, null, 2)
  }
}

export interface BlockExplainInput {
  blockType: string
  errors: Array<{ code: BlockValidationError; field?: string; message: string }>
}

function ValidationErrors({
  errors,
  explain,
}: {
  errors: string[]
  explain?: BlockExplainInput | null
}) {
  const [showExplain, setShowExplain] = React.useState(false)
  if (errors.length === 0) return null
  // Grounded locally: the same kernel over the same draft, so every claim
  // cites the rule code and field that rejected the save.
  const explanation =
    explain && explain.errors.length > 0
      ? explainBlockValidation(explain)
      : null
  return (
    <Alert variant="destructive" className="mt-2 space-y-1 p-2">
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      {explanation ? (
        <div className="pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={showExplain}
            onClick={() => setShowExplain((value) => !value)}
          >
            {showExplain ? 'Hide explanation' : 'Explain'}
          </Button>
          {showExplain ? (
            <div className="pt-1 text-foreground">
              <ExplainPanel explanation={explanation} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Alert>
  )
}

/**
 * Status + conflict UI rendered below an editor when the block is being
 * edited. Stays unobtrusive while clean; surfaces every other state
 * truthfully (ELN-007).
 */
function AutosaveFooter({
  status,
  error,
  validationErrors,
  explainBlock,
  serverPreview,
  onUseServer,
  onKeepLocal,
  retrying,
}: {
  status: AutosaveStatus
  error: string | null
  validationErrors: string[]
  explainBlock?: BlockExplainInput | null
  serverPreview: string
  onUseServer: () => void
  onKeepLocal: () => void
  retrying: boolean
}) {
  if (status === 'clean') return null
  return (
    <div className="absolute right-0 bottom-0 z-10 max-w-full space-y-1 rounded-md bg-background/90 p-1.5 text-xs shadow-sm backdrop-blur-sm">
      <SaveStatus status={status} message={error} />
      {status === 'conflict' ? (
        <ConflictBanner
          message={error ?? 'The block changed elsewhere.'}
          serverPreview={serverPreview}
          onUseServer={onUseServer}
          onKeepLocal={onKeepLocal}
          retrying={retrying}
        />
      ) : null}
      {status === 'failed' && validationErrors.length > 0 ? (
        <ValidationErrors errors={validationErrors} explain={explainBlock} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rich text.
// ---------------------------------------------------------------------------

function RichTextEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  className,
  headingAnchorPrefix,
  hiddenRichTextNodeIndexes,
  onSlashCommand,
  onEnterAtEnd,
  onBackspaceAtStart,
  onArrowUpFromStart,
  onArrowDownFromEnd,
}: BlockEditorProps) {
  const initialDraft = block.payload as unknown as RichTextPayload
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    return (
      <RichTextContent
        className={className}
        payload={a.draft}
        anchorPrefix={headingAnchorPrefix ?? `section-${block.id}`}
        hiddenNodeIndexes={hiddenRichTextNodeIndexes}
      />
    )
  }

  return (
    <div className={cn('relative', className)}>
      <TiptapRichTextEditor
        payload={a.draft}
        autoFocus={autoFocus}
        anchorPrefix={headingAnchorPrefix ?? `section-${block.id}`}
        hiddenNodeIndexes={hiddenRichTextNodeIndexes}
        onChange={(payload) => {
          a.setTouched(true)
          a.setDraft(payload)
        }}
        onBlur={a.flush}
        onSlashCommand={onSlashCommand}
        onEnterAtEnd={onEnterAtEnd}
        onBackspaceAtStart={onBackspaceAtStart}
        onArrowUpFromStart={onArrowUpFromStart}
        onArrowDownFromEnd={onArrowDownFromEnd}
      />
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checklist.
// ---------------------------------------------------------------------------

interface ChecklistItem {
  text: string
  checked: boolean
}
interface ChecklistDraft {
  items: ChecklistItem[]
}

function ChecklistEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initialDraft = React.useMemo<ChecklistDraft>(() => {
    const initial = block.payload as { items?: ChecklistItem[] }
    return { items: Array.isArray(initial.items) ? initial.items : [] }
  }, [block.payload])
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  function update(i: number, patch: Partial<ChecklistItem>) {
    a.setTouched(true)
    a.setDraft({
      items: a.draft.items.map((item, idx) =>
        idx === i ? { ...item, ...patch } : item,
      ),
    })
  }
  function remove(i: number) {
    a.setTouched(true)
    a.setDraft({ items: a.draft.items.filter((_, idx) => idx !== i) })
  }
  function add() {
    a.setTouched(true)
    a.setDraft({ items: [...a.draft.items, { text: '', checked: false }] })
  }

  if (readOnly) {
    return (
      <ul className={cn('space-y-1.5', className)}>
        {a.draft.items.length === 0 ? (
          <li className="text-sm text-muted-foreground">No checklist items</li>
        ) : null}
        {a.draft.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={item.checked} disabled aria-hidden="true" />
            <span
              className={cn(
                item.checked && 'text-muted-foreground line-through',
              )}
            >
              {item.text || 'Untitled item'}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <ul className="space-y-1.5">
        {a.draft.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <label className="sr-only" htmlFor={`check-${block.id}-${i}`}>
              Item {i + 1} checked
            </label>
            <Checkbox
              id={`check-${block.id}-${i}`}
              checked={item.checked}
              onCheckedChange={(checked) => {
                a.setTouched(true)
                a.setDraft({
                  items: a.draft.items.map((it, idx) =>
                    idx === i ? { ...it, checked: checked === true } : it,
                  ),
                })
              }}
              className="mt-0.5 size-[18px]"
            />
            <label className="sr-only" htmlFor={`check-text-${block.id}-${i}`}>
              Item {i + 1} text
            </label>
            <Input
              id={`check-text-${block.id}-${i}`}
              type="text"
              value={item.text}
              autoFocus={autoFocus && i === a.draft.items.length - 1}
              onChange={(e) => update(i, { text: e.target.value })}
              onBlur={() => a.flush()}
              placeholder={`Item ${i + 1}`}
              className={cn(
                'h-7 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0',
                item.checked && 'text-muted-foreground line-through',
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => remove(i)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={add}
        className="text-muted-foreground"
      >
        <Plus /> Add item
      </Button>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linked record.
// ---------------------------------------------------------------------------

const LINK_TYPES = [
  'general',
  'sample',
  'protocol',
  'dataset',
  'reagent',
  'analysis',
  'file',
] as const

const TARGET_KINDS = [
  'experiment',
  'dataset',
  'sample',
  'reagent',
  'protocol_template',
  'report',
] as const

const TARGET_KIND_LABELS: Record<(typeof TARGET_KINDS)[number], string> = {
  experiment: 'Experiment',
  dataset: 'Dataset',
  sample: 'Sample',
  reagent: 'Reagent',
  protocol_template: 'Protocol template',
  report: 'Report',
}

interface LinkedRecordDraft {
  targetKind: string
  targetIdentifier: string
  /**
   * NOTE-03: stable UUID of the linked canonical object (Dataset UUID for
   * targetKind 'dataset', Record UUID otherwise), captured when the link
   * is picked from search. Optional — legacy payloads predate it, and
   * manually typed identifiers deliberately leave it empty because a
   * label alone never carries canonical identity.
   */
  targetId?: string
  linkType: string
  label: string
}

function LinkedRecordSearch({
  kind,
  onPick,
}: {
  kind: string
  onPick: (picked: {
    /** Stable UUID of the canonical object (Dataset or Record). */
    id: string
    identifier: string
    label: string
    linkType?: string
  }) => void
}) {
  const [query, setQuery] = React.useState('')
  const results = useQuery({
    queryKey: ['notebook-linked-search', kind, query],
    queryFn: async () => {
      if (kind === 'dataset') {
        const rows = await fetchDatasetSummaries(notebookDataClient)
        const q = query.trim().toLowerCase()
        return rows
          .filter((row) => !q || row.name.toLowerCase().includes(q))
          .slice(0, 8)
          .map((row) => ({
            id: row.id,
            identifier: row.name,
            title: row.description || row.name,
            linkType: 'dataset',
          }))
      }
      const trimmed = query.trim()
      const filters = [
        `kind=eq.${encodeURIComponent(kind)}`,
        'deleted_at=is.null',
        'archived_at=is.null',
      ]
      if (trimmed) {
        const enc = encodeURIComponent(`${trimmed}*`)
        filters.push(`or=(identifier.ilike.${enc},title.ilike.${enc})`)
      }
      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        `?${filters.join('&')}&order=identifier.asc&limit=8`,
      )
      return rows.map((row) => ({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
        linkType: undefined as string | undefined,
      }))
    },
  })

  return (
    <div className="space-y-1">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search records or Datasets"
        placeholder="Search by name or identifier"
      />
      {results.isError ? (
        <p className="text-xs text-destructive" role="alert">
          Could not search {kind === 'dataset' ? 'Datasets' : 'records'}.
        </p>
      ) : null}
      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
        {(results.data ?? []).map((row) => (
          <li key={row.identifier}>
            <button
              type="button"
              className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
              onMouseDown={(event) => {
                event.preventDefault()
                onPick({
                  id: row.id,
                  identifier: row.identifier,
                  label: row.title,
                  linkType: row.linkType,
                })
              }}
            >
              <span className="font-mono text-xs">{row.identifier}</span>
              <span className="truncate text-muted-foreground">
                {row.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinkedRecordEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initialDraft = React.useMemo<LinkedRecordDraft>(() => {
    const initial = block.payload as {
      targetKind?: string
      targetIdentifier?: string
      targetId?: string
      linkType?: string
      label?: string
    }
    return {
      targetKind: initial.targetKind ?? 'experiment',
      targetIdentifier: initial.targetIdentifier ?? '',
      targetId: initial.targetId ?? undefined,
      linkType: initial.linkType ?? 'general',
      label: initial.label ?? '',
    }
  }, [block.payload])
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    const openTo = a.draft.targetId
      ? a.draft.targetKind === 'dataset'
        ? datasetPath(a.draft.targetId)
        : recordDestination(a.draft.targetKind, a.draft.targetId)
      : null
    return (
      <div
        className={cn('flex flex-wrap items-center gap-2 text-sm', className)}
      >
        <Badge variant="outline" className="uppercase">
          <Link2 className="size-3" />
          {a.draft.linkType}
        </Badge>
        <span className="font-medium text-foreground">
          {a.draft.targetKind}{' '}
          <span className="font-mono">{a.draft.targetIdentifier || '—'}</span>
        </span>
        {a.draft.label ? (
          <span className="text-muted-foreground">— {a.draft.label}</span>
        ) : null}
        {openTo ? <OpenLink to={openTo}>Open</OpenLink> : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Target kind" htmlFor={`lr-kind-${block.id}`}>
          <Select
            id={`lr-kind-${block.id}`}
            value={a.draft.targetKind}
            onChange={(e) => {
              a.setTouched(true)
              // NOTE-03 review fix: identity is (kind, id) — changing the
              // kind invalidates a previously captured targetId, so it must
              // be dropped or the Open link would point at the wrong object
              // type. The label is also re-typed by the user afterwards.
              a.setDraft({
                ...a.draft,
                targetKind: e.target.value,
                targetId: undefined,
              })
            }}
          >
            {TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {TARGET_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Identifier" htmlFor={`lr-id-${block.id}`}>
          <Input
            id={`lr-id-${block.id}`}
            type="text"
            value={a.draft.targetIdentifier}
            autoFocus={autoFocus}
            onChange={(e) => {
              a.setTouched(true)
              // NOTE-03: a manually typed identifier is a label, not
              // identity — drop any previously captured stable UUID so a
              // stale Open link can never point at the wrong object.
              a.setDraft({
                ...a.draft,
                targetIdentifier: e.target.value,
                targetId: undefined,
              })
            }}
            onBlur={() => a.flush()}
            placeholder="EXP-2025-0001"
            className="font-mono"
          />
        </Field>
        <Field label="Link type" htmlFor={`lr-link-${block.id}`}>
          <Select
            id={`lr-link-${block.id}`}
            value={a.draft.linkType}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, linkType: e.target.value })
            }}
          >
            {LINK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" htmlFor={`lr-label-${block.id}`}>
          <Input
            id={`lr-label-${block.id}`}
            type="text"
            value={a.draft.label}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, label: e.target.value })
            }}
            onBlur={() => a.flush()}
            placeholder="Optional"
          />
        </Field>
      </div>
      <LinkedRecordSearch
        kind={a.draft.targetKind}
        onPick={(picked) => {
          a.setTouched(true)
          a.setDraft({
            ...a.draft,
            targetIdentifier: picked.identifier,
            targetId: picked.id,
            label: picked.label || a.draft.label,
            linkType: picked.linkType ?? a.draft.linkType,
          })
          void a.flush()
        }}
      />
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  )
}

function ProtocolReferenceEditor({ block, pinProtocol }: BlockEditorProps) {
  const pinned = Object.keys(block.payload).length > 0
  const [query, setQuery] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const records = useQuery({
    queryKey: scientificRecordQueryKeys.search('protocol_template', query),
    queryFn: () =>
      searchRecords(notebookDataClient, 'protocol_template', query),
    enabled: !pinned,
  })
  if (pinned) {
    const status = String(block.payload.approvalStatus)
    const statusVariant =
      status === 'Approved'
        ? 'success'
        : status === 'Rejected'
          ? 'danger'
          : 'warning'
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {String(block.payload.protocolTitle)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {String(block.payload.protocolIdentifier)} · Version{' '}
              {String(block.payload.version)}
            </p>
          </div>
          <Badge variant={statusVariant}>{status}</Badge>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Pin className="size-3" />
          Pinned {new Date(String(block.payload.pinnedAt)).toLocaleString()}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3 py-1">
      <p className="text-sm font-medium">Select a protocol version</p>
      <RecordPicker
        kind="protocol_template"
        results={records.data ?? []}
        loading={records.isLoading || pending}
        error={records.error}
        onSearch={setQuery}
        onSelect={(record) => {
          if (!pinProtocol) return
          setPending(true)
          setError(null)
          void pinProtocol(record.id)
            .catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Could not pin protocol.',
              ),
            )
            .finally(() => setPending(false))
        }}
      />
      {error ? (
        <Alert variant="destructive" className="p-2">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

function ProcedureStepEditor(props: BlockEditorProps) {
  const { block } = props
  const payload = block.payload
  const initial = React.useMemo(
    () => ({
      ...payload,
      completed:
        typeof payload.completed === 'boolean' ? payload.completed : false,
      note: typeof payload.note === 'string' ? payload.note : '',
    }),
    [payload],
  )
  const a = useBlockAutosave(
    block,
    initial,
    props.save,
    props.offline,
    props.onStatusChange,
  )
  if (typeof payload.completed !== 'boolean') {
    return <UnsupportedEditor block={block} className={props.className} />
  }
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          checked={a.draft.completed}
          disabled={props.readOnly}
          onCheckedChange={(checked) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, completed: checked === true })
          }}
          onBlur={() => a.flush()}
          className="mt-1"
        />
        <span>
          <span className="block text-xs font-medium text-muted-foreground">
            Step {String(payload.stepNumber ?? '')}
          </span>
          <span
            className={cn(
              'block text-sm',
              a.draft.completed && 'text-muted-foreground line-through',
            )}
          >
            {String(payload.text)}
          </span>
        </span>
      </label>
      <Field label="Execution note" htmlFor={`step-note-${block.id}`}>
        <Textarea
          id={`step-note-${block.id}`}
          value={String(a.draft.note)}
          disabled={props.readOnly}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, note: event.target.value })
          }}
          onBlur={() => a.flush()}
          rows={2}
        />
      </Field>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

function MaterialsEditor(props: BlockEditorProps) {
  const { block } = props
  const initialDraft = React.useMemo<{ items: MaterialItem[] }>(
    () => ({
      items: Array.isArray(block.payload.items)
        ? (block.payload.items as MaterialItem[])
        : [],
    }),
    [block.payload],
  )
  const a = useBlockAutosave(
    block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
  )
  const [kind, setKind] = React.useState<'sample' | 'reagent'>('sample')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<RecordPickerResult | null>(
    null,
  )
  const [quantity, setQuantity] = React.useState('')
  const [unitCode, setUnitCode] = React.useState('')
  const [materialUnitSymbol, setMaterialUnitSymbol] = React.useState('')
  const records = useQuery({
    queryKey: scientificRecordQueryKeys.search(kind, query),
    queryFn: () => searchRecords(notebookDataClient, kind, query),
  })

  const updateItems = (items: MaterialItem[], flush = false) => {
    a.setTouched(true)
    a.setDraft({ items })
    if (flush) window.setTimeout(() => a.flush(), 0)
  }
  return (
    <div className="space-y-4">
      {a.draft.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No materials linked yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {a.draft.items.map((item, index) => (
            <div
              key={item.id}
              className="grid items-center gap-3 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[1fr_8rem_7rem_auto]"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <Badge
                    variant={item.kind === 'sample' ? 'info' : 'violet'}
                    className="shrink-0"
                  >
                    {item.kind === 'sample' ? (
                      <FlaskConical className="size-3" />
                    ) : (
                      <Beaker className="size-3" />
                    )}
                    {item.kind}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.identifier}
                </p>
              </div>
              <Input
                aria-label={`Quantity for ${item.title}`}
                type="number"
                min="0"
                step="any"
                value={item.quantity}
                onChange={(event) => {
                  const items = [...a.draft.items]
                  items[index] = {
                    ...item,
                    quantity: Number(event.target.value),
                  }
                  updateItems(items)
                }}
                onBlur={() => a.flush()}
                className="text-right font-mono tabular-nums"
              />
              <Input
                aria-label={`Unit for ${item.title}`}
                value={item.unit.symbol}
                onChange={(event) => {
                  const items = [...a.draft.items]
                  items[index] = {
                    ...item,
                    unit: { ...item.unit, symbol: event.target.value },
                  }
                  updateItems(items)
                }}
                onBlur={() => a.flush()}
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${item.title}`}
                onClick={() =>
                  updateItems(
                    a.draft.items.filter((x) => x.id !== item.id),
                    true,
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Card className="space-y-3 p-3">
        <div className="flex gap-2">
          {(['sample', 'reagent'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={kind === value ? 'secondary' : 'outline'}
              onClick={() => {
                setKind(value)
                setSelected(null)
              }}
            >
              {value === 'sample' ? <FlaskConical /> : <Beaker />}
              {value === 'sample' ? 'Samples' : 'Reagents'}
            </Button>
          ))}
        </div>
        <RecordPicker
          kind={kind}
          results={records.data ?? []}
          loading={records.isLoading}
          error={records.error}
          onSearch={setQuery}
          onSelect={setSelected}
          selectedId={selected?.id}
        />
        {selected ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input
              aria-label="Material quantity"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Quantity"
              className="font-mono tabular-nums"
            />
            <Input
              aria-label="Canonical unit code"
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              placeholder="Unit code (uL)"
              className="font-mono"
            />
            <Input
              aria-label="Unit symbol"
              value={materialUnitSymbol}
              onChange={(e) => setMaterialUnitSymbol(e.target.value)}
              placeholder="Symbol (µL)"
              className="font-mono"
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !(
                  Number(quantity) > 0 &&
                  unitCode.trim() &&
                  materialUnitSymbol.trim()
                )
              }
              onClick={() => {
                updateItems(
                  [
                    ...a.draft.items,
                    {
                      id: crypto.randomUUID(),
                      materialRecordId: selected.id,
                      kind,
                      identifier: selected.identifier,
                      title: selected.title,
                      quantity: Number(quantity),
                      unit: {
                        code: unitCode.trim(),
                        symbol: materialUnitSymbol.trim(),
                      },
                      observedAt: new Date().toISOString(),
                    },
                  ],
                  true,
                )
                setSelected(null)
                setQuantity('')
                setUnitCode('')
                setMaterialUnitSymbol('')
              }}
            >
              <Plus /> Add material
            </Button>
          </div>
        ) : null}
      </Card>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unsupported — read-only placeholder (never editable). Preserves the block
// payload verbatim so future types are not silently rewritten.
// ---------------------------------------------------------------------------

function UnsupportedEditor({
  block,
  className,
}: {
  block: NotebookBlock
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="rounded-md border border-dashed border-warning/50 bg-warning/5 p-3 text-xs">
        <p className="font-medium text-foreground">
          {block.type} — not editable here
        </p>
        <p className="mt-1 text-muted-foreground">
          This block type or payload schema version is not editable in this
          client yet. Its content is preserved and readable through the API.
        </p>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs">
          {JSON.stringify(block.payload, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCI-003 file block editor. Upload flow: a keyboard-accessible file input
// validates type/size client-side (the server re-validates), then calls
// `onAttachFile`, which authorizes + streams the bytes through the bounded
// `/api/files` routes and persists the file reference in the block payload.
// Once attached, the block renders the file (read-only here; the preview
// shows live status). Replacing a file is a later concern.
// ---------------------------------------------------------------------------

function FileBlockEditor({ block, onAttachFile, readOnly }: BlockEditorProps) {
  const attached = Object.keys(block.payload).length > 0
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (attached) {
    // The preview renders the live file state; the editor just confirms it.
    // No Card/border here so the edit transition doesn't add a box around
    // content that reads as a seamless line in the document flow.
    const name = String(block.payload.displayName ?? 'File')
    const mediaType = String(block.payload.mediaType ?? '')
    const byteSize = Number(block.payload.byteSize ?? 0)
    const fileRecordId = String(block.payload.fileRecordId ?? '')
    const FileGlyph = fileIconFor(mediaType)
    const showImage =
      Boolean(fileRecordId) && isInlinePreviewableImage(mediaType)
    return (
      <div className="space-y-2 py-1">
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
            <FileGlyph className="size-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {mediaType || 'unknown'} · {formatBytes(byteSize)}
            </p>
          </div>
          <Badge variant="success" className="ml-auto shrink-0">
            Attached
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

  async function handleFile(file: File) {
    setError(null)
    const checked = validateFileForUpload(file)
    if (!checked.ok) {
      setError(checked.message)
      return
    }
    if (!onAttachFile) {
      setError('File upload is not available in this context.')
      return
    }
    setPending(true)
    try {
      await onAttachFile(file)
    } catch (cause) {
      setError(
        cause instanceof AttachFileError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'Could not attach the file.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-input bg-muted/20 p-6 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-background text-muted-foreground shadow-xs">
        <FileText className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Attach a file</p>
        <p className="text-xs text-muted-foreground">
          CSV, text, JSON, PDF, images &amp; Office formats · up to{' '}
          {formatBytes(FILE_MAX_BYTES)}
        </p>
      </div>
      <Input
        ref={inputRef}
        type="file"
        aria-label="Attach a file"
        disabled={pending || readOnly}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
          // Reset so selecting the same file again re-triggers.
          event.target.value = ''
        }}
        className="mx-auto h-auto w-full max-w-xs rounded-none border-0 bg-transparent p-0 text-xs shadow-none file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
      />
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading…
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mx-auto max-w-md text-left">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

/** Pick a lucide file glyph from the media type. */
function fileIconFor(mediaType: string) {
  if (mediaType.startsWith('image/')) return ImageIcon
  if (
    mediaType.includes('spreadsheet') ||
    mediaType.includes('csv') ||
    mediaType.includes('excel')
  )
    return FileSpreadsheet
  if (mediaType.startsWith('text/') || mediaType === 'application/json')
    return FileText
  return FileIcon
}

// ---------------------------------------------------------------------------
// SCI-004 chart block editor. Lets the user pick a stable dataset (a
// scientific table in the workspace), map fields to x/y/series, choose a
// chart type (line/scatter/bar) and axis scales, and render a live preview
// inside ChartFrame. Freeze/unfreeze lifecycle actions call the transactional
// RPCs through the route so durable events and audit attribution stay
// canonical. Filters, transformations and error-bar overlays are kept
// explicit in the spec. An empty draft `{}` opens the configuration panel.
// ---------------------------------------------------------------------------

const AXIS_SCALES_EDITOR: readonly AxisScale[] = ['linear', 'log'] as const

function ChartBlockEditor({
  block,
  save,
  offline,
  onStatusChange,
  onFreezeChart,
  onUnfreezeChart,
  readOnly,
}: BlockEditorProps) {
  const initial = block.payload as unknown as ChartBlockPayload
  const a = useBlockAutosave<ChartBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
  )
  const draft = a.draft
  const spec = draft.spec ?? null
  const frozen = draft.frozen ?? null

  // Available datasets: canonical Datasets in the workspace (decision 0037).
  const datasetsQuery = useQuery({
    queryKey: ['chart-available-datasets'] as const,
    queryFn: () => fetchDatasetSummaries(),
    staleTime: 30_000,
  })
  const availableDatasets = (datasetsQuery.data ?? []).map((d) =>
    toCanonicalDatasetSource({ ...d, name: d.name }),
  )

  // Columns for the selected dataset (so field mappings are honest).
  const selectedDatasetId = spec?.datasets[0]?.datasetId ?? ''
  const sourceQuery = useQuery({
    queryKey: ['chart-selected-dataset', selectedDatasetId],
    queryFn: () => fetchCanonicalDataset(sciDataClient, selectedDatasetId),
    enabled: Boolean(selectedDatasetId),
    staleTime: 10_000,
  })
  const columns = sourceQuery.data?.columns ?? []

  function updateSpec(patch: Partial<ChartSpec>) {
    if (!spec) return
    a.setTouched(true)
    a.setDraft({ ...draft, spec: { ...spec, ...patch } })
  }
  function updateDisplay(patch: Partial<ChartSpec['display']>) {
    if (!spec) return
    updateSpec({ display: { ...spec.display, ...patch } })
  }
  function updateFields(patch: Partial<ChartSpec['fields']>) {
    if (!spec) return
    updateSpec({ fields: { ...spec.fields, ...patch } })
  }

  // Switching types keeps the spec coherent: fields that carry no meaning
  // for the new type are cleared (mirrors the DB trigger's rules).
  function setChartType(next: ChartType) {
    if (!spec) return
    const fields = { ...spec.fields }
    let overlays = spec.overlays
    let typeParams: ChartSpec['typeParams'] = {}
    if (next === 'histogram' || next === 'box') {
      fields.x = null
      typeParams =
        next === 'box'
          ? { box: { showOutliers: true } }
          : { histogram: { bins: 10 } }
    } else if (next === 'heatmap') {
      fields.series = null
      fields.color = null
      fields.size = null
      overlays = { errorBars: null }
      typeParams = {
        heatmap: { aggregate: 'count', valueField: null, xBins: 10, yBins: 10 },
      }
    }
    const display = ['line', 'scatter', 'bar'].includes(next)
      ? spec.display
      : { ...spec.display, annotations: [] }
    updateSpec({ type: next, fields, overlays, typeParams, display })
  }

  // Start a spec when the user picks a dataset for an empty draft.
  function chooseDataset(datasetId: string) {
    a.setTouched(true)
    const col = sourceQuery.data?.columns ?? []
    const xCol = col.length > 0 ? col[0] : null
    const yCol = col.length > 1 ? col[1] : col.length > 0 ? col[0] : null
    const next: ChartSpec = {
      specVersion: CHART_SPEC_VERSION,
      type: spec?.type ?? 'line',
      datasets: [{ datasetId }],
      fields: {
        x: xCol ? { fieldId: xCol.id } : null,
        y: yCol ? { fieldId: yCol.id } : { fieldId: '' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
      filters: [],
      transformations: [],
      typeParams: {},
      display: {
        axes: {
          x: {
            label: xCol?.label ?? 'x',
            scale: 'linear',
            unit: unitSymbol(xCol?.unit),
          },
          y: {
            label: yCol?.label ?? 'y',
            scale: 'linear',
            unit: unitSymbol(yCol?.unit),
          },
        },
        series: [],
        legend: { visible: true },
      },
      overlays: { errorBars: null },
    }
    a.setDraft({ ...draft, spec: next })
  }

  const fieldOptions = columns.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ))

  // Live preview materialisation.
  const { datasetQuery } = useLiveChartDataset(spec)
  const pinnedRows = useFrozenPinnedRows(frozen)
  const reconstructed =
    frozen && spec && frozenPinsDatasetVersion(frozen) && pinnedRows.data
      ? reconstructFrozenVisualisation({
          spec,
          frozen,
          rows: pinnedRows.data.rows,
        })
      : null
  const previewMaterialised = frozen
    ? (reconstructed?.chart ?? materialiseFrozenChart(frozen))
    : spec
      ? materialiseLiveChart(spec, datasetQuery.data ?? null)
      : {
          state: { kind: 'missing_dataset' as const },
          columns: [],
          rows: [],
          series: [],
          xLabel: 'x',
          yLabel: 'y',
          xUnit: undefined,
          yUnit: undefined,
          droppedPoints: 0,
        }
  const previewLoading =
    (!frozen && datasetQuery.isLoading) ||
    Boolean(frozen && frozenPinsDatasetVersion(frozen) && pinnedRows.isLoading)
  const frozenFacets =
    reconstructed?.facets ?? (frozen ? materialiseFrozenFacets(frozen) : null)

  return (
    <div className="space-y-4">
      <ChartRenderer
        title={draft.title || 'Untitled chart'}
        provenance={draft.provenance}
        spec={spec}
        materialised={previewMaterialised}
        frozen={frozen}
        loading={previewLoading}
        facets={frozenFacets?.panels}
        facetTotal={frozenFacets?.total}
      />

      {readOnly ? null : (
        <Card className="space-y-4 p-3">
          <ChartField label="Title">
            <Input
              aria-label="Chart title"
              value={draft.title ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, title: e.target.value })
              }}
              onBlur={() => a.flush()}
            />
          </ChartField>

          <ChartField label="Dataset">
            <Select
              aria-label="Dataset"
              value={selectedDatasetId}
              onChange={(e) => chooseDataset(e.target.value)}
              onBlur={() => a.flush()}
              disabled={!!frozen || datasetsQuery.isLoading}
            >
              <option value="">
                {datasetsQuery.isLoading
                  ? 'Loading datasets…'
                  : 'Select a dataset'}
              </option>
              {availableDatasets.map((d) => (
                <option key={d.datasetId} value={d.datasetId}>
                  {d.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Charts plot canonical Dataset data (decision 0037).
            </p>
          </ChartField>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartField label="Chart type">
              <Select
                aria-label="Chart type"
                value={spec?.type ?? 'line'}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
            </ChartField>
            <ChartField label="Series field (optional)">
              {spec?.type === 'heatmap' ? (
                <p className="text-xs text-muted-foreground">
                  Not used for heatmap charts.
                </p>
              ) : (
                <Select
                  aria-label="Series field"
                  value={bindingValue(spec?.fields.series)}
                  onChange={(e) =>
                    updateFields({ series: parseBinding(e.target.value) })
                  }
                  onBlur={() => a.flush()}
                  disabled={!!frozen || !spec}
                >
                  <option value="">(none)</option>
                  {fieldOptions}
                </Select>
              )}
            </ChartField>
            <ChartField label="X field">
              {spec?.type === 'histogram' || spec?.type === 'box' ? (
                <p className="text-xs text-muted-foreground">
                  Not used for {spec.type} charts — the measured value is the Y
                  field.
                </p>
              ) : (
                <Select
                  aria-label="X field"
                  value={bindingValue(spec?.fields.x)}
                  onChange={(e) =>
                    updateFields({ x: parseBinding(e.target.value) })
                  }
                  onBlur={() => a.flush()}
                  disabled={!!frozen || !spec}
                >
                  <option value="">(none)</option>
                  {fieldOptions}
                </Select>
              )}
            </ChartField>
            <ChartField label="Y field">
              <Select
                aria-label="Y field"
                value={bindingValue(spec?.fields.y)}
                onChange={(e) =>
                  updateFields({
                    y: parseBinding(e.target.value) ?? { fieldId: '' },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                <option value="">(none)</option>
                {fieldOptions}
              </Select>
            </ChartField>
            <ChartField label="X axis scale">
              <Select
                aria-label="X axis scale"
                value={spec?.display.axes.x.scale ?? 'linear'}
                onChange={(e) =>
                  updateDisplay({
                    axes: {
                      ...spec!.display.axes,
                      x: {
                        ...spec!.display.axes.x,
                        scale: e.target.value as AxisScale,
                      },
                    },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                {AXIS_SCALES_EDITOR.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </ChartField>
            <ChartField label="Y axis scale">
              <Select
                aria-label="Y axis scale"
                value={spec?.display.axes.y.scale ?? 'linear'}
                onChange={(e) =>
                  updateDisplay({
                    axes: {
                      ...spec!.display.axes,
                      y: {
                        ...spec!.display.axes.y,
                        scale: e.target.value as AxisScale,
                      },
                    },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                {AXIS_SCALES_EDITOR.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </ChartField>
          </div>

          {spec?.type === 'histogram' ? (
            <ChartField label="Bins">
              <Input
                aria-label="Histogram bin count"
                type="number"
                min={1}
                max={200}
                value={spec.typeParams.histogram?.bins ?? 10}
                onChange={(e) =>
                  updateSpec({
                    typeParams: {
                      histogram: {
                        bins: Math.max(1, Number(e.target.value) || 10),
                      },
                    },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen}
              />
            </ChartField>
          ) : null}
          {spec?.type === 'heatmap' ? (
            <ChartField label="Cell value">
              <Select
                aria-label="Heatmap cell aggregation"
                value={spec.typeParams.heatmap?.aggregate ?? 'count'}
                onChange={(e) => {
                  const aggregate = e.target.value as NonNullable<
                    ChartSpec['typeParams']['heatmap']
                  >['aggregate']
                  updateSpec({
                    typeParams: {
                      heatmap:
                        aggregate === 'count'
                          ? { aggregate, valueField: null }
                          : {
                              aggregate,
                              valueField:
                                spec.typeParams.heatmap?.valueField ??
                                spec.fields.y,
                            },
                    },
                  })
                }}
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                <option value="count">Row count</option>
                <option value="mean">Mean of Y</option>
                <option value="median">Median of Y</option>
                <option value="min">Min of Y</option>
                <option value="max">Max of Y</option>
              </Select>
            </ChartField>
          ) : null}

          <ChartField label="Provenance note (optional)">
            <Input
              aria-label="Provenance note"
              value={draft.provenance ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, provenance: e.target.value })
              }}
              onBlur={() => a.flush()}
            />
          </ChartField>

          <div className="flex flex-wrap items-center gap-2">
            {frozen ? (
              <>
                <Badge variant="warning">
                  <Snowflake className="size-3" />
                  Frozen snapshot — immutable
                </Badge>
                {onUnfreezeChart ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onUnfreezeChart()}
                  >
                    <Pencil /> Unfreeze (edit live again)
                  </Button>
                ) : null}
              </>
            ) : onFreezeChart && spec ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void onFreezeChart()}
                disabled={previewMaterialised.state.kind !== 'ok'}
                title={
                  previewMaterialised.state.kind !== 'ok'
                    ? 'Resolve chart state before freezing'
                    : 'Freeze an immutable snapshot of the current dataset'
                }
              >
                <Snowflake /> Freeze snapshot
              </Button>
            ) : null}
          </div>
        </Card>
      )}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

function ChartField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function bindingValue(binding: { fieldId: string } | null | undefined): string {
  return binding?.fieldId ?? ''
}

function parseBinding(v: string): { fieldId: string } | null {
  return v ? { fieldId: v } : null
}

function unitSymbol(unit: unknown): string | undefined {
  if (
    typeof unit === 'object' &&
    unit !== null &&
    'symbol' in unit &&
    typeof unit.symbol === 'string'
  ) {
    return (unit as { symbol: string }).symbol
  }
  return undefined
}

// ---------------------------------------------------------------------------
// SCI-005 plate map block editor. Authors a plate_map block payload with
// 96-well format, well assignments (role, sample link, replicate, volume,
// notes), and validation config. Uses the shared autosave hook, the existing
// RecordPicker for sample links, and the presentational PlateMap for live
// preview with keyboard navigation and well-code-based selection.
// ---------------------------------------------------------------------------

function PlateMapBlockEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
}: BlockEditorProps) {
  const initial = block.payload as unknown as PlateMapBlockPayload
  const a = useBlockAutosave<PlateMapBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
  )
  const draft = a.draft
  const spec = draft.spec ?? null
  const [selectedWellCode, setSelectedWellCode] = React.useState<string | null>(
    null,
  )
  const [sampleSearch, setSampleSearch] = React.useState('')

  // Sample search query for the RecordPicker
  const sampleQuery = useQuery({
    queryKey: [
      ...scientificRecordQueryKeys.search('sample', sampleSearch),
      'includeArchived',
    ],
    queryFn: () =>
      searchRecords(notebookDataClient, 'sample', sampleSearch, {
        includeArchived: true,
      }),
    enabled: Boolean(selectedWellCode) && !readOnly,
    staleTime: 5_000,
  })

  // Initialize spec when user starts editing an empty draft
  function ensureSpec(): PlateMapSpec {
    if (spec) return spec
    const next = defaultPlateMapSpec()
    a.setTouched(true)
    a.setDraft({ ...draft, spec: next })
    return next
  }

  function updateDraft(patch: Partial<PlateMapBlockPayload>) {
    a.setTouched(true)
    a.setDraft({ ...draft, ...patch })
  }

  function updateSpec(patch: Partial<PlateMapSpec>) {
    const current = ensureSpec()
    a.setTouched(true)
    a.setDraft({ ...draft, spec: { ...current, ...patch } })
  }

  // Find a well by wellCode in the current spec
  function findWell(code: string): WellAssignment | undefined {
    if (!spec) return undefined
    return spec.wells.find((w) => w.wellCode === code)
  }

  // Update or insert a well assignment
  function upsertWell(code: string, patch: Partial<WellAssignment>) {
    const current = ensureSpec()
    const parsed = parseWellCode(code)
    if (!parsed) return
    const existing = current.wells.find((w) => w.wellCode === code)
    let wells: WellAssignment[]
    if (existing) {
      wells = current.wells.map((w) =>
        w.wellCode === code ? { ...w, ...patch } : w,
      )
    } else {
      wells = [
        ...current.wells,
        {
          wellCode: code,
          row: parsed.row,
          col: parsed.col,
          role: 'empty',
          ...patch,
        },
      ]
    }
    updateSpec({ wells })
  }

  // Remove a well assignment (revert to unassigned)
  function removeWell(code: string) {
    if (!spec) return
    updateSpec({ wells: spec.wells.filter((w) => w.wellCode !== code) })
  }

  const selectedWell = selectedWellCode ? findWell(selectedWellCode) : undefined

  // Build plate wells for the PlateMap preview
  const plateWells = React.useMemo(() => {
    if (!spec) return []
    return spec.wells.map((w) => ({
      row: w.row,
      col: w.col,
      wellCode: w.wellCode,
      roleClass: ROLE_STYLES[w.role].cellClass,
      displayLabel: w.sampleRef
        ? w.sampleRef.identifier
        : w.role === 'empty'
          ? ''
          : ROLE_STYLES[w.role].label[0].toUpperCase(),
      label: [
        w.wellCode,
        ROLE_STYLES[w.role].label,
        w.sampleRef?.identifier,
        w.replicate && `rep ${w.replicate}`,
        w.volume && `${w.volume.value} ${w.volume.unit}`,
      ]
        .filter(Boolean)
        .join(' · '),
    }))
  }, [spec])

  const roleLegend = React.useMemo(() => {
    if (!spec) return []
    const present = new Set(spec.wells.map((w) => w.role))
    return Array.from(present).map((role) => ({
      label: ROLE_STYLES[role].label,
      className: ROLE_STYLES[role].cellClass,
    }))
  }, [spec])

  if (readOnly) {
    return (
      <div className={cn('space-y-2')}>
        <p className="font-medium text-foreground">
          {draft.title ?? 'Plate map'}
        </p>
        {spec ? (
          <PlateMap
            wells={plateWells}
            rows={spec.rows}
            cols={spec.cols}
            roleLegend={roleLegend}
            readOnly
            compact
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No plate map configured.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Title */}
      <Field label="Title" htmlFor={`pm-title-${block.id}`}>
        <Input
          id={`pm-title-${block.id}`}
          type="text"
          value={draft.title ?? ''}
          onChange={(e) => updateDraft({ title: e.target.value })}
          placeholder="e.g. qPCR titration plate"
        />
      </Field>

      {/* Format info */}
      {spec ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">96-well (8×12)</Badge>
          <span className="tabular-nums">
            {spec.wells.length} wells assigned
          </span>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => ensureSpec()}>
          Initialize 96-well plate
        </Button>
      )}

      {/* Plate grid + inspector */}
      {spec ? (
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          {/* Grid */}
          <div>
            <PlateMap
              wells={plateWells}
              rows={spec.rows}
              cols={spec.cols}
              selectedWellCode={selectedWellCode}
              onSelectWellCode={(code) => setSelectedWellCode(code)}
              roleLegend={roleLegend}
              ariaLabel="Plate map editor — click a well to assign"
            />
          </div>

          {/* Inspector */}
          <Card className="space-y-3 p-3">
            {selectedWellCode ? (
              <WellInspector
                wellCode={selectedWellCode}
                well={selectedWell}
                sampleResults={sampleQuery.data ?? []}
                sampleLoading={sampleQuery.isLoading}
                sampleError={sampleQuery.error ?? null}
                onSampleSearch={setSampleSearch}
                onAssignRole={(role) => upsertWell(selectedWellCode, { role })}
                onSelectSample={(result) =>
                  upsertWell(selectedWellCode, {
                    role:
                      selectedWell?.role === 'empty'
                        ? 'sample'
                        : (selectedWell?.role ?? 'sample'),
                    sampleRef: {
                      recordId: result.id,
                      identifier: result.identifier,
                      title: result.title,
                      archived: result.archived,
                    },
                  })
                }
                onClearSample={() =>
                  upsertWell(selectedWellCode, {
                    sampleRef: undefined,
                  })
                }
                onSetReplicate={(n) =>
                  upsertWell(selectedWellCode, { replicate: n })
                }
                onSetVolume={(value, unit) =>
                  upsertWell(selectedWellCode, {
                    volume: { value, unit },
                  })
                }
                onClearVolume={() =>
                  upsertWell(selectedWellCode, { volume: undefined })
                }
                onSetNotes={(notes) => upsertWell(selectedWellCode, { notes })}
                onRemoveWell={() => {
                  removeWell(selectedWellCode)
                  setSelectedWellCode(null)
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Click a well in the grid to assign it.
              </p>
            )}

            {/* Validation config */}
            <ValidationConfigEditor
              spec={spec}
              onChange={(validation) => updateSpec({ validation })}
            />
          </Card>
        </div>
      ) : null}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

function WellInspector({
  wellCode,
  well,
  sampleResults,
  sampleLoading,
  sampleError,
  onSampleSearch,
  onAssignRole,
  onSelectSample,
  onClearSample,
  onSetReplicate,
  onSetVolume,
  onClearVolume,
  onSetNotes,
  onRemoveWell,
}: {
  wellCode: string
  well: WellAssignment | undefined
  sampleResults: NotebookRecord[]
  sampleLoading: boolean
  sampleError: Error | null
  onSampleSearch: (q: string) => void
  onAssignRole: (role: AssignmentRole) => void
  onSelectSample: (result: RecordPickerResult) => void
  onClearSample: () => void
  onSetReplicate: (n: number) => void
  onSetVolume: (value: number, unit: string) => void
  onClearVolume: () => void
  onSetNotes: (notes: string) => void
  onRemoveWell: () => void
}) {
  const role = well?.role ?? 'empty'
  const sampleKind: ScientificRecordKind = 'sample'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Well {wellCode}</h4>
        {well ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemoveWell}
            className="text-xs text-destructive"
          >
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>

      {/* Role selector */}
      <Field label="Role" htmlFor={`well-role-${wellCode}`}>
        <Select
          id={`well-role-${wellCode}`}
          value={role}
          onChange={(e) => onAssignRole(e.target.value as AssignmentRole)}
        >
          {ASSIGNMENT_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_STYLES[r].label}
            </option>
          ))}
        </Select>
      </Field>

      {/* Sample link (for sample and control roles) */}
      {role !== 'empty' && role !== 'blank' ? (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sample
          </Label>
          {well?.sampleRef ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {well.sampleRef.identifier}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {well.sampleRef.title}
                  {well.sampleRef.archived ? ' · archived' : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearSample}
                className="shrink-0 text-xs text-destructive"
              >
                Clear
              </Button>
            </div>
          ) : (
            <RecordPicker
              kind={sampleKind}
              results={sampleResults}
              loading={sampleLoading}
              error={sampleError}
              onSearch={onSampleSearch}
              onSelect={onSelectSample}
              includeArchived
              searchLabel="Search samples by identifier or title"
              className="max-h-48"
            />
          )}
        </div>
      ) : null}

      {/* Replicate */}
      {role !== 'empty' ? (
        <Field label="Replicate" htmlFor={`well-rep-${wellCode}`}>
          <Input
            id={`well-rep-${wellCode}`}
            type="number"
            min={1}
            value={well?.replicate ?? ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              onSetReplicate(Number.isFinite(v) && v > 0 ? v : 1)
            }}
            placeholder="e.g. 1"
            className="font-mono tabular-nums"
          />
        </Field>
      ) : null}

      {/* Volume */}
      {role !== 'empty' ? (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Volume
          </Label>
          {well?.volume ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step="any"
                value={well.volume.value}
                onChange={(e) =>
                  onSetVolume(
                    parseFloat(e.target.value) || 0,
                    well.volume!.unit,
                  )
                }
                className="w-20 font-mono tabular-nums"
              />
              <Input
                type="text"
                value={well.volume.unit}
                onChange={(e) =>
                  onSetVolume(well.volume!.value, e.target.value)
                }
                className="w-16 font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearVolume}
                className="text-xs text-destructive"
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="value"
                onChange={(e) =>
                  onSetVolume(parseFloat(e.target.value) || 0, 'µL')
                }
                className="w-20 font-mono tabular-nums"
              />
              <span className="text-xs text-muted-foreground">µL</span>
            </div>
          )}
        </div>
      ) : null}

      {/* Notes */}
      {role !== 'empty' ? (
        <Field label="Notes" htmlFor={`well-notes-${wellCode}`}>
          <Textarea
            id={`well-notes-${wellCode}`}
            value={well?.notes ?? ''}
            onChange={(e) => onSetNotes(e.target.value)}
            placeholder="Optional notes"
            rows={2}
          />
        </Field>
      ) : null}
    </div>
  )
}

function ValidationConfigEditor({
  spec,
  onChange,
}: {
  spec: PlateMapSpec
  onChange: (validation: PlateMapSpec['validation']) => void
}) {
  const v = spec.validation
  return (
    <details className="space-y-3 rounded-md border p-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Validation config
      </summary>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Required roles
          </Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ASSIGNMENT_ROLES.filter((r) => r !== 'empty').map((r) => (
              <label
                key={r}
                className="flex items-center gap-1.5 text-xs text-foreground"
              >
                <Checkbox
                  checked={v.requiredRoles?.includes(r) ?? false}
                  onCheckedChange={(checked) => {
                    const current = v.requiredRoles ?? []
                    const next =
                      checked === true
                        ? [...current, r]
                        : current.filter((x) => x !== r)
                    onChange({ ...v, requiredRoles: next })
                  }}
                />
                {ROLE_STYLES[r].label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Vol min" htmlFor={`vc-volmin-${spec.rows}`}>
            <Input
              id={`vc-volmin-${spec.rows}`}
              type="number"
              step="any"
              value={v.volumeMin ?? ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                onChange({
                  ...v,
                  volumeMin: Number.isFinite(val) ? val : undefined,
                })
              }}
              className="w-20 font-mono tabular-nums"
            />
          </Field>
          <Field label="Vol max" htmlFor={`vc-volmax-${spec.rows}`}>
            <Input
              id={`vc-volmax-${spec.rows}`}
              type="number"
              step="any"
              value={v.volumeMax ?? ''}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                onChange({
                  ...v,
                  volumeMax: Number.isFinite(val) ? val : undefined,
                })
              }}
              className="w-20 font-mono tabular-nums"
            />
          </Field>
          <Field label="Unit" htmlFor={`vc-volunit-${spec.rows}`}>
            <Input
              id={`vc-volunit-${spec.rows}`}
              type="text"
              value={v.volumeUnit ?? ''}
              onChange={(e) =>
                onChange({ ...v, volumeUnit: e.target.value || undefined })
              }
              placeholder="unit"
              className="w-20 font-mono"
            />
          </Field>
        </div>
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// SCI-03 analysis block editor. Picks a saved analysis definition (ADR 0040)
// from the workspace, renders the live execution through the same preview
// used read-only, and freezes/unfreezes via the transactional RPCs passed
// down from the route so durable events and audit attribution stay canonical.
// ---------------------------------------------------------------------------

function AnalysisBlockEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  onFreezeAnalysis,
  onUnfreezeAnalysis,
}: BlockEditorProps) {
  const initial = block.payload as unknown as AnalysisBlockPayload
  const a = useBlockAutosave<AnalysisBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
  )
  const draft = a.draft
  const frozen = draft.frozen ?? null

  const definitionsQuery = useQuery({
    queryKey: analysisDefinitionQueryKeys.list(),
    queryFn: () => fetchAnalysisDefinitions(),
    staleTime: 10_000,
  })
  const definitions = definitionsQuery.data ?? []
  const selected = definitions.find((d) => d.id === draft.definitionId) ?? null

  function chooseDefinition(id: string) {
    a.setTouched(true)
    const saved = definitions.find((d) => d.id === id)
    if (!saved) return
    const name = typeof saved.name === 'string' ? saved.name : 'Analysis'
    a.setDraft({
      ...draft,
      definitionId: id,
      title: draft.title || name,
    })
  }

  const validation = validateAnalysisBlockPayload(draft)

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-3">
        <ChartField label="Saved analysis">
          <Select
            aria-label="Saved analysis"
            value={draft.definitionId ?? ''}
            onChange={(e) => chooseDefinition(e.target.value)}
            onBlur={() => a.flush()}
            disabled={!!frozen || definitionsQuery.isLoading}
          >
            <option value="">
              {definitionsQuery.isLoading
                ? 'Loading saved analyses…'
                : definitions.length === 0
                  ? 'No saved analyses — create one in /analysis → Analyse'
                  : 'Select an analysis'}
            </option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {`${d.name} · v${d.version}`}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Analyses execute against live dataset rows. Freeze to pin the inputs
            as evidence.
          </p>
        </ChartField>

        <ChartField label="Title">
          <Input
            aria-label="Analysis title"
            value={draft.title ?? ''}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...draft, title: e.target.value })
            }}
            onBlur={() => a.flush()}
          />
        </ChartField>

        <div className="flex flex-wrap items-center gap-2">
          {frozen ? (
            <>
              <Badge variant="warning">
                <Snowflake className="size-3" />
                Frozen snapshot — immutable
              </Badge>
              {onUnfreezeAnalysis ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onUnfreezeAnalysis()}
                >
                  <Pencil /> Unfreeze (live again)
                </Button>
              ) : null}
            </>
          ) : onFreezeAnalysis && draft.definitionId && !readOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={validation.length > 0}
              title={
                validation.length > 0
                  ? 'Choose a saved analysis before freezing'
                  : 'Freeze an immutable snapshot of this analysis'
              }
              onClick={() => void onFreezeAnalysis()}
            >
              <Snowflake /> Freeze snapshot
            </Button>
          ) : null}
        </div>
      </Card>

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizePayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />

      {/* Keep `selected` referenced for the stale-definition hint below. */}
      <span className="sr-only">
        {selected ? `Using ${selected.name}` : 'No saved analysis selected'}
      </span>
    </div>
  )
}
