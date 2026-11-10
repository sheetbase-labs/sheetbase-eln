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
import { rich, t } from '#/copy'
import { useStepNumber } from '#/lib/step-numbers'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { datasetOption } from '#/components/record-picker/entity-options'
import { returnToHere } from '#/lib/return-to'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { cn } from '#/lib/utils'
import { explainBlockValidation } from '#/lib/assist-explain'
import { AiExplainPanel } from '#/components/assist/ai-explain-panel'
import { RichTextContent, isRichTextPayload, validateBlock } from '#/lib/blocks'
import type { BlockValidationError, RichTextPayload } from '#/lib/blocks'
import { summarizeBlockPayload } from '#/lib/blocks/registry'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import type {
  NotebookBlock,
  NotebookRecord,
  RecordWire,
} from '#/lib/notebook-data'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import { linkedRecordDestination } from './linked-record-destination'
import { OfficeEditButton } from './office-editor'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Checkbox } from '#/components/ui/checkbox'
import { FileDrop } from '#/components/ui/file-drop'
import { Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Textarea } from '#/components/inventory/list'
import { Select } from '#/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  CALLOUT_STYLES,
  CALLOUT_VARIANT_LABELS,
  CALLOUT_VARIANTS,
} from './callout-styles'
import {
  CONCLUSION_VERDICT_LABELS,
  CONCLUSION_VERDICTS,
  conclusionVerdictOf,
} from '#/lib/conclusion-block'
import { Icon } from '#/components/icons'
import { RecordPicker } from '#/components/scientific'
import type { RecordPickerResult } from '#/components/scientific'
import {
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { MaterialItem } from '#/lib/protocol-materials'
import { materialItems } from './material-payload'
import { StockWithdrawButton } from '#/components/notebook/stock-withdraw-button'
import { isWithdrawn } from '#/lib/stock-withdraw'
import { PluginBlockView } from '#/components/extensions/plugin-block'
import { useAutosave } from './use-autosave'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import {
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_STATUS_LABEL,
  SIGNATURE_REQUEST_MEANINGS,
} from '#/lib/notebook-action-blocks'
import type {
  CorrectiveActionItem,
  CorrectiveActionsPayload,
  SignatureRequestPayload,
} from '#/lib/notebook-action-blocks'
import { SIGNATURE_MEANING_LABEL } from '#/lib/signatures'
import { SaveStatus } from './save-status'
import { StepDeviation } from './step-deviation'
import { StepTimerControl } from './step-timer'
import { OfficeFileBlock } from './office-preview/office-file-block'
import { isSequenceFileName } from '#/lib/sequence'
import { stepDurationSeconds } from '#/lib/step-timers'
import { isPinnedProtocolStep } from '#/lib/protocol-deviations'
import {
  useOfflineEdits,
  useUnsyncedBlock,
} from '#/components/offline/offline-edits'
import { canEditBlockOffline } from '#/components/offline/offline-edit-model'
import { UnsyncedMark } from '#/components/offline/unsynced-changes'
import { ConflictBanner } from './conflict-banner'
import { OpenLink } from './block-preview'
import { RichTextEditor as TiptapRichTextEditor } from './rich-text-editor'
import { AnnotatedImage } from './annotated-image'
import { ImageAnnotator } from './image-annotator'
import { readAnnotations, withAnnotations } from '#/lib/image-annotations'
import { validateFileForUpload } from '#/lib/file-attach'
import { formatFileSize } from '#/lib/format-numbers'
import { FILE_MAX_BYTES, isInlinePreviewableImage } from '#/lib/file-policy'
import {
  AXIS_SCALES,
  CHART_SPEC_VERSION,
  CHART_TYPES,
  HEATMAP_AGGREGATES,
} from '#/lib/chart-spec'
import type { AnalysisBlockPayload } from '#/lib/analysis-block'
import { validateAnalysisBlockPayload } from '#/lib/analysis-block'
import { PipelineOutputBlockEditor } from './pipeline-output-block-editor'
import { CodeCellBlockEditor } from './code-cell-block'
import { DatasetImportBlockEditor } from './dataset-import-block'
import { ReactionEditor, StructureEditor } from './chemistry-block'
import { AnalysisChartPicker } from './analysis-chart-picker'
import {
  analysisDefinition,
  analysisPayload,
  chartPayload,
  platePayload,
} from './scientific-payload'
import {
  analysisDefinitionQueryKeys,
  fetchAnalysisDefinitions,
} from '#/lib/analysis-definitions-data'
import type {
  ChartBlockPayload,
  ChartColumn,
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
import { MakeSheetFromFile } from '#/components/notebook/make-sheet-from-file'
import type { MakeSheetRequest } from '#/components/notebook/make-sheet-from-file'
import { canMakeSheet } from '#/lib/office-sheet'
import { readOnlyEntries } from './read-only-entries'
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
  /** Insert a new block without replacing this block's evidence. */
  onInsertBelow?: (type: string, payload?: NotebookBlock['payload']) => void
  /**
   * Persist a validated payload. Returns a structured result so the
   * editor's autosave state machine can branch on conflict / validation /
   * transient. The route reads the latest expected version from the query
   * cache at call time; the editor does not pass a version.
   */
  save: (
    payload: NotebookBlock['payload'],
  ) => Promise<SaveResult<NotebookBlock['payload']>>
  /** When true, holds saves (live-event stream offline). */
  offline?: boolean
  /** Called whenever the block's autosave status changes. */
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
  autoFocus?: boolean
  /** Where the caret lands on focus. See `RichTextEditorProps.caretHint`. */
  caretHint?: 'start' | 'end'
  /** Empty-row invitation. `undefined` inside a prose run. See RichTextEditor. */
  placeholder?: string
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
  /** Put a worksheet of an attached Excel file in the notebook as a sheet. */
  onMakeSheet?: (request: MakeSheetRequest) => Promise<void>
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

const pluginState = z.json()

function PluginBlockEditor(props: BlockEditorProps) {
  const payload = props.block.payload
  const { save } = props
  // Saves go one after another: two quick clicks must not both claim the same
  // version of the block.
  const queue = React.useRef<Promise<unknown> | null>(null)

  const keep = React.useCallback(
    (state: z.output<typeof pluginState>) => {
      queue.current = (queue.current ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => save({ ...payload, state }))
    },
    [save, payload],
  )

  return (
    <PluginBlockView
      payload={payload}
      recordId={props.block.recordId}
      blockId={props.block.id}
      onState={
        props.readOnly ? undefined : (state) => keep(pluginState.parse(state))
      }
      insertBelow={
        props.readOnly || !props.onInsertBelow
          ? undefined
          : (type, insertedPayload) =>
              props.onInsertBelow?.(type, insertedPayload)
      }
    />
  )
}

export function BlockEditor(props: BlockEditorProps) {
  // EXP-05.2: a block with a local draft carries a marker where it renders.
  const unsynced = useUnsyncedBlock(props.block.id)

  return (
    <>
      {unsynced ? <UnsyncedMark /> : null}
      <BlockEditorBody {...props} />
    </>
  )
}

const BLOCK_EDITORS = new Map<string, React.ComponentType<BlockEditorProps>>([
  ['rich_text', RichTextEditor],
  ['checklist', ChecklistEditor],
  ['callout', CalloutEditor],
  ['conclusion', ConclusionEditor],
  ['metric', MetricEditor],
  ['linked_record', LinkedRecordEditor],
  ['protocol_reference', ProtocolReferenceEditor],
  ['procedure_step', ProcedureStepEditor],
  ['materials', MaterialsEditor],
  ['file', FileBlockEditor],
  ['chart', ChartBlockEditor],
  ['plugin', PluginBlockEditor],
  ['analysis', AnalysisBlockEditor],
  ['pipeline_output', PipelineOutputBlockEditor],
  ['code_cell', CodeCellBlockEditor],
  ['dataset_import', DatasetImportBlockEditor],
  ['plate_map', PlateMapBlockEditor],
  ['structure', StructureEditor],
  ['reaction', ReactionEditor],
  ['signature_request', SignatureRequestEditor],
  ['corrective_actions', CorrectiveActionsEditor],
])

function BlockEditorBody(props: BlockEditorProps) {
  if (
    props.block.type === 'rich_text' &&
    !isRichTextPayload(props.block.payload)
  ) {
    return <UnsupportedEditor block={props.block} className={props.className} />
  }

  const Editor = BLOCK_EDITORS.get(props.block.type) ?? UnsupportedEditor

  return <Editor {...props} />
}

// ---------------------------------------------------------------------------
// Shared autosave draft hook. Wraps `useAutosave` with the block's typed
// payload shape and the block validator, so each editor only deals with its
// own draft fields.
// ---------------------------------------------------------------------------

function useBlockAutosave<T extends object>(
  block: NotebookBlock,
  initialDraft: T,
  save: BlockEditorProps['save'],
  offline: boolean | undefined,
  onStatusChange: BlockEditorProps['onStatusChange'],
  decoder: z.ZodType<T>,
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
      const r = await save(z.record(z.string(), z.unknown()).parse(value))

      return {
        ...r,
        serverValue:
          r.serverValue === undefined
            ? undefined
            : decoder.parse(r.serverValue),
      }
    },
    [save, decoder],
  )

  const [touched, setTouched] = React.useState(false)
  // Blocks edited in place keep saving while offline: the page's save keeps
  // the payload on the device and sends it on reconnect, so it survives a
  // reload. Blocks that need the server still hold.
  const { canQueue } = useOfflineEdits()

  const holdOffline =
    (offline ?? false) && !(canQueue && canEditBlockOffline(block.type))

  const autosave = useAutosave<T>({
    initialValue: initialDraft,
    validate,
    save: saveAdapter,
    offline: holdOffline,
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
    <Notice tone="bad" className="mt-2 space-y-1 p-2">
      <ul className="space-y-1">
        {readOnlyEntries(errors, (message) => message).map(({ key, value }) => (
          <li key={key}>{value}</li>
        ))}
      </ul>
      {explanation ? (
        <div className="pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-expanded={showExplain}
            onClick={() => setShowExplain((value) => !value)}
          >
            {showExplain
              ? t('notebook.blockEditor.hideExplanation')
              : t('notebook.blockEditor.explain')}
          </Button>
          {showExplain ? (
            <div className="pt-1 text-fg">
              <AiExplainPanel explanation={explanation} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Notice>
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
    <div className="absolute right-0 bottom-0 z-10 max-w-full space-y-1 rounded-md bg-surface/90 p-1.5 text-xs shadow-sm backdrop-blur-sm">
      <SaveStatus status={status} message={error} />
      {status === 'conflict' ? (
        <ConflictBanner
          message={error ?? t('notebook.blockEditor.theBlockChangedElsewhere')}
          serverPreview={serverPreview}
          onUseServer={onUseServer}
          onKeepLocal={onKeepLocal}
          retrying={retrying}
        />
      ) : null}
      {status === 'failed' && validationErrors.length > 0 ? (
        <ValidationErrors errors={validationErrors} explain={explainBlock} />
      ) : null}
      {/* J-NBK-16: a save that failed after its automatic retries, with
          nothing wrong in the content, is a connection or server problem and
          trying again can succeed. `onKeepLocal` is the hook's retry(). */}
      {status === 'failed' && validationErrors.length === 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={retrying}
          onClick={onKeepLocal}
        >
          {retrying ? t('common.states.saving') : t('common.actions.tryAgain')}
        </Button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rich text.
// ---------------------------------------------------------------------------

const richTextPayload = z.custom<RichTextPayload>(isRichTextPayload)

function RichTextEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  caretHint,
  placeholder,
  className,
  headingAnchorPrefix,
  hiddenRichTextNodeIndexes,
  onSlashCommand,
  onEnterAtEnd,
  onBackspaceAtStart,
  onArrowUpFromStart,
  onArrowDownFromEnd,
}: BlockEditorProps) {
  const initialDraft = richTextPayload.parse(block.payload)

  const a = useBlockAutosave(
    block,
    initialDraft,
    save,
    offline,
    onStatusChange,
    richTextPayload,
  )

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
        caretHint={caretHint}
        placeholder={placeholder}
        anchorPrefix={headingAnchorPrefix ?? `section-${block.id}`}
        hiddenNodeIndexes={hiddenRichTextNodeIndexes}
        liveBlockId={block.id}
        savedDoc={initialDraft.doc}
        conflict={a.status === 'conflict'}
        conflictServerDoc={a.serverValue?.doc}
        onResolveConflict={a.retry}
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
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
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

const checklistDraft: z.ZodType<ChecklistDraft> = z.object({
  items: z
    .array(z.looseObject({ text: z.string(), checked: z.boolean() }))
    .default([]),
})

const signatureMeaning = z.enum(SIGNATURE_REQUEST_MEANINGS)

const signatureDraft: z.ZodType<SignatureRequestPayload> = z.object({
  requestedUserId: z.string().nullable().catch(null),
  requestedUserName: z.string().nullable().catch(null),
  meaning: signatureMeaning.catch('reviewed'),
  note: z.string().catch(''),
})

const correctiveStatus = z.enum(CORRECTIVE_ACTION_STATUSES)

const correctiveDraft: z.ZodType<CorrectiveActionsPayload> = z.object({
  items: z
    .array(
      z.looseObject({
        id: z.string(),
        action: z.string(),
        ownerUserId: z.string().nullable(),
        ownerName: z.string().nullable(),
        due: z.string().nullable(),
        status: correctiveStatus,
      }),
    )
    .default([]),
})

// ---------------------------------------------------------------------------
// R5-NOTE-02: the two sign-and-attach blocks.
//
// Both declare intent and are ordinary autosaved payloads. The request stores
// a captured label (not a foreign key) so a later membership change shows as
// "no longer a member" instead of dropping the request; the CAPA list carries
// an owner label per action. Neither editor raises a live signature request —
// that stays the REV-03 submission/review flow.
// ---------------------------------------------------------------------------

function SignatureRequestEditor(props: BlockEditorProps) {
  const initialDraft = React.useMemo(
    () => signatureDraft.parse(props.block.payload),
    [props.block.payload],
  )

  const a = useBlockAutosave(
    props.block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
    signatureDraft,
  )

  if (props.readOnly) {
    return (
      <p className={cn('m-0 text-sm text-fg-muted', props.className)}>
        {a.draft.requestedUserName?.trim()
          ? `${a.draft.requestedUserName} — ${SIGNATURE_MEANING_LABEL[a.draft.meaning]}`
          : t('notebook.blockEditor.noSignerChosen')}
      </p>
    )
  }

  return (
    <div className={cn('max-w-[560px] space-y-2', props.className)}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-label">
          <span className="text-fg-muted">
            {t('notebook.blockEditor.whoSigns')}
          </span>
          <Input
            type="text"
            value={a.draft.requestedUserName ?? ''}
            autoFocus={props.autoFocus}
            placeholder={t('notebook.blockEditor.placeholder')}
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, requestedUserName: event.target.value })
            }}
            onBlur={() => a.flush()}
          />
        </label>
        <label className="flex flex-col gap-1 text-label">
          <span className="text-fg-muted">
            {t('notebook.blockEditor.meaning')}
          </span>
          <Select
            aria-label={t('notebook.blockEditor.ariaLabel')}
            value={a.draft.meaning}
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({
                ...a.draft,
                meaning: signatureMeaning.parse(event.target.value),
              })
            }}
          >
            {SIGNATURE_REQUEST_MEANINGS.map((value) => (
              <option key={value} value={value}>
                {SIGNATURE_MEANING_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-label">
        <span className="text-fg-muted">
          {t('notebook.blockEditor.noteOptional')}
        </span>
        <Textarea
          rows={2}
          value={a.draft.note}
          placeholder={t('notebook.blockEditor.whatTheSignerIsPlaceholder')}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, note: event.target.value })
          }}
          onBlur={() => a.flush()}
        />
      </label>
      <p className="m-0 text-label text-fg-muted">
        {t('notebook.blockEditor.theRequestIsRaised')}
      </p>
    </div>
  )
}

function CorrectiveActionsEditor(props: BlockEditorProps) {
  const initialDraft = React.useMemo(
    () => correctiveDraft.parse(props.block.payload),
    [props.block.payload],
  )

  const a = useBlockAutosave(
    props.block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
    correctiveDraft,
  )

  function update(index: number, patch: Partial<CorrectiveActionItem>) {
    a.setTouched(true)
    a.setDraft({
      items: a.draft.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    })
  }

  function remove(index: number) {
    a.setTouched(true)
    a.setDraft({ items: a.draft.items.filter((_, i) => i !== index) })
  }

  function add() {
    a.setTouched(true)
    a.setDraft({
      items: [
        ...a.draft.items,
        {
          id: `CAPA-${a.draft.items.length + 1}`,
          action: '',
          ownerUserId: null,
          ownerName: null,
          due: null,
          status: 'open',
        },
      ],
    })
  }

  if (props.readOnly) {
    return (
      <p className={cn('m-0 text-sm text-fg-muted', props.className)}>
        {a.draft.items.length === 0
          ? t('notebook.blockEditor.noCorrectiveActions')
          : t('notebook.blockEditor.correctiveActionCount', {
              count: a.draft.items.length,
            })}
      </p>
    )
  }

  return (
    <div className={cn('space-y-2', props.className)}>
      {a.draft.items.length === 0 ? (
        <p className="m-0 text-sm text-fg-muted">
          {t('notebook.blockEditor.noCorrectiveActionsYet')}
        </p>
      ) : null}
      <ul className="space-y-2">
        {a.draft.items.map((item, i) => (
          <li
            key={item.id}
            className="grid grid-cols-[64px_1fr_120px_120px_auto] items-center gap-2 max-md:grid-cols-1"
          >
            <span className="mono text-label text-fg-muted">{item.id}</span>
            <Input
              aria-label={t('notebook.blockEditor.actionIAriaLabel', {
                i: i + 1,
              })}
              type="text"
              value={item.action}
              autoFocus={props.autoFocus && i === a.draft.items.length - 1}
              placeholder={t('notebook.blockEditor.theCorrectionPlaceholder')}
              onChange={(event) => update(i, { action: event.target.value })}
              onBlur={() => a.flush()}
            />
            <Input
              aria-label={t('notebook.blockEditor.ownerIAriaLabel', {
                i: i + 1,
              })}
              type="text"
              value={item.ownerName ?? ''}
              placeholder={t('notebook.blockEditor.ownerPlaceholder')}
              onChange={(event) =>
                update(i, {
                  ownerName: event.target.value || null,
                  ownerUserId: null,
                })
              }
              onBlur={() => a.flush()}
            />
            <Input
              aria-label={t('notebook.blockEditor.dueDateIAriaLabel', {
                i: i + 1,
              })}
              type="date"
              value={item.due ?? ''}
              onChange={(event) =>
                update(i, { due: event.target.value || null })
              }
              onBlur={() => a.flush()}
            />
            <div className="flex items-center gap-1">
              <Select
                aria-label={t('notebook.blockEditor.statusIAriaLabel', {
                  i: i + 1,
                })}
                value={item.status}
                onChange={(event) =>
                  update(i, {
                    status: correctiveStatus.parse(event.target.value),
                  })
                }
              >
                {CORRECTIVE_ACTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CORRECTIVE_ACTION_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="quiet"
                size="icon"
                aria-label={t('notebook.blockEditor.removeActionIAriaLabel', {
                  i: i + 1,
                })}
                onClick={() => remove(i)}
              >
                <Icon name="trash" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" variant="quiet" size="sm" onClick={add}>
        {t('notebook.blockEditor.addAction')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A4: callout and metric. Both were stored, validated and rendered but had no
// editor, so selecting one showed an unsupported-block placeholder: the content
// was preserved and visible, but could not be changed. The static `table` block
// is still in that state deliberately — whether it earns its keep now that the
// Sheet is the tabular surface is a separate product decision.
//
// Both editors are drawn as the block they edit: a callout keeps its tone's
// surface and icon while being written, and a metric keeps its eyebrow and
// display number. Fields here are borderless for that reason — a bordered
// input would put a form inside the document instead of editing the document.
// ---------------------------------------------------------------------------

const calloutDraft = z.object({
  text: z.string().catch(''),
  variant: z.enum(CALLOUT_VARIANTS).catch('info'),
})

function CalloutEditor({
  block,
  save,
  offline,
  onStatusChange,
  className,
  autoFocus,
}: BlockEditorProps) {
  const initialDraft = React.useMemo(
    () => calloutDraft.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    save,
    offline,
    onStatusChange,
    calloutDraft,
  )

  const styles = CALLOUT_STYLES[a.draft.variant]

  return (
    <div className={className}>
      <div
        className={cn(
          'flex items-start gap-3 rounded-md px-3.5 py-2 text-sm leading-6',
          styles.container,
        )}
      >
        <Icon
          name={styles.icon}
          size={16}
          className={cn('mt-0.5 shrink-0', styles.iconClass)}
          aria-hidden="true"
        />
        <label className="sr-only" htmlFor={`callout-text-${block.id}`}>
          {t('notebook.blockEditor.calloutText')}
        </label>
        <textarea
          id={`callout-text-${block.id}`}
          value={a.draft.text}
          autoFocus={autoFocus}
          rows={1}
          placeholder={t('notebook.blockEditor.whatTheReaderMustPlaceholder')}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, text: event.target.value })
          }}
          onBlur={() => a.flush()}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 text-fg outline-none field-sizing-content placeholder:text-fg-faint focus:ring-0"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="quiet"
                size="sm"
                aria-label={t('notebook.blockEditor.calloutToneAriaLabel')}
                className="shrink-0 text-fg-muted"
              />
            }
          >
            {CALLOUT_VARIANT_LABELS[a.draft.variant]}
            <Icon name="chevronDown" size={10} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {CALLOUT_VARIANTS.map((variant) => (
              <DropdownMenuItem
                key={variant}
                icon={variant === a.draft.variant ? 'check' : undefined}
                className={
                  variant === a.draft.variant ? undefined : 'pl-[30px]'
                }
                onClick={() => {
                  a.setTouched(true)
                  a.setDraft({ ...a.draft, variant })
                }}
              >
                {CALLOUT_VARIANT_LABELS[variant]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

const conclusionDraft = z.object({
  text: z.string().catch(''),
  verdict: z.enum(CONCLUSION_VERDICTS).catch('inconclusive'),
  basis: z.string().catch(''),
})

function ConclusionEditor({
  block,
  save,
  offline,
  onStatusChange,
  className,
  autoFocus,
}: BlockEditorProps) {
  const initialDraft = React.useMemo(
    () => conclusionDraft.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    save,
    offline,
    onStatusChange,
    conclusionDraft,
  )

  return (
    <div className={className}>
      <div className="space-y-2 rounded-md border border-border px-3.5 py-2.5 text-sm leading-6">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.conclusion')}
          </span>
          <Select
            aria-label={t('notebook.blockEditor.verdictAriaLabel')}
            value={a.draft.verdict}
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({
                ...a.draft,
                verdict: conclusionVerdictOf(event.target.value),
              })
            }}
            className="w-auto"
          >
            {CONCLUSION_VERDICTS.map((verdict) => (
              <option key={verdict} value={verdict}>
                {CONCLUSION_VERDICT_LABELS[verdict]}
              </option>
            ))}
          </Select>
        </div>
        <label className="sr-only" htmlFor={`conclusion-text-${block.id}`}>
          {t('notebook.blockEditor.conclusionText')}
        </label>
        <textarea
          id={`conclusion-text-${block.id}`}
          value={a.draft.text}
          autoFocus={autoFocus}
          rows={2}
          placeholder={t(
            'notebook.blockEditor.whatTheExperimentFoundPlaceholder',
          )}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, text: event.target.value })
          }}
          onBlur={() => a.flush()}
          className="block w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-fg outline-none field-sizing-content placeholder:text-fg-faint focus:ring-0"
        />
        <label className="sr-only" htmlFor={`conclusion-basis-${block.id}`}>
          {t('notebook.blockEditor.basedOn')}
        </label>
        <input
          id={`conclusion-basis-${block.id}`}
          value={a.draft.basis}
          placeholder={t('notebook.blockEditor.basedOnTheResultPlaceholder')}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, basis: event.target.value })
          }}
          onBlur={() => a.flush()}
          className="block w-full border-0 bg-transparent p-0 text-xs text-fg-muted outline-none placeholder:text-fg-faint focus:ring-0"
        />
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

const metricDraft = z.object({
  label: z.string().catch(''),
  /** Exactly what the user typed. Converting while typing would eat a decimal
   * point or a space, because the converted value is written straight back
   * into the controlled field. */
  value: z.union([z.string(), z.number()]).catch('').transform(String),
  unit: z.string().catch(''),
  provenance: z.string().catch(''),
})

type MetricDraft = z.output<typeof metricDraft>

/** A numeric reading is written back as a number so number formatting applies;
 * anything else stays text. A blank reading stays blank. */
function metricValueFromInput(raw: string): string | number {
  const trimmed = raw.trim()

  if (trimmed === '') return ''
  const numeric = Number(trimmed)

  return Number.isFinite(numeric) ? numeric : trimmed
}

/** The canonical payload for a metric draft: an optional field is omitted when
 * blank rather than saved as an empty string. */
function metricPayloadFromDraft(draft: MetricDraft) {
  const { label, value, unit, provenance } = draft

  return {
    label,
    value: metricValueFromInput(value),
    unit: unit.trim() === '' ? undefined : unit,
    provenance: provenance.trim() === '' ? undefined : provenance,
  }
}

function MetricEditor({
  block,
  save,
  offline,
  onStatusChange,
  className,
  autoFocus,
}: BlockEditorProps) {
  const initialDraft = React.useMemo(
    () => metricDraft.parse(block.payload),
    [block.payload],
  )

  // The draft is the raw input; the payload is built from it at the boundary,
  // and canonical conflict values are decoded back into editable input text.
  const saveDraft = React.useCallback(
    async (payload: NotebookBlock['payload']) => {
      const result = await save(
        metricPayloadFromDraft(metricDraft.parse(payload)),
      )

      return result.serverValue === undefined
        ? result
        : { ...result, serverValue: metricDraft.parse(result.serverValue) }
    },
    [save],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    saveDraft,
    offline,
    onStatusChange,
    metricDraft,
  )

  return (
    <div className={cn('space-y-2', className)}>
      <dl className="flex flex-col gap-0.5">
        <dt>
          <label className="sr-only" htmlFor={`metric-label-${block.id}`}>
            {t('notebook.blockEditor.metricLabel')}
          </label>
          <input
            id={`metric-label-${block.id}`}
            value={a.draft.label}
            autoFocus={autoFocus}
            placeholder={t('notebook.blockEditor.metricPlaceholder')}
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, label: event.target.value })
            }}
            onBlur={() => a.flush()}
            className="w-full border-0 bg-transparent p-0 text-xs font-medium uppercase tracking-wide text-fg-muted outline-none placeholder:text-fg-faint focus:ring-0"
          />
        </dt>
        <dd className="flex items-baseline gap-1.5 font-display text-2xl font-semibold leading-tight tabular-nums text-fg">
          <label className="sr-only" htmlFor={`metric-value-${block.id}`}>
            {t('notebook.blockEditor.metricValue')}
          </label>
          <input
            id={`metric-value-${block.id}`}
            value={a.draft.value}
            inputMode="decimal"
            placeholder="0"
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, value: event.target.value })
            }}
            onBlur={() => a.flush()}
            className="w-[7ch] border-0 bg-transparent p-0 font-display text-2xl font-semibold tabular-nums text-fg outline-none placeholder:text-fg-faint focus:ring-0"
          />
          <label className="sr-only" htmlFor={`metric-unit-${block.id}`}>
            {t('notebook.blockEditor.metricUnit')}
          </label>
          <input
            id={`metric-unit-${block.id}`}
            value={a.draft.unit}
            placeholder="unit"
            onChange={(event) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, unit: event.target.value })
            }}
            onBlur={() => a.flush()}
            className="w-[6ch] border-0 bg-transparent p-0 text-sm font-normal text-fg-muted outline-none placeholder:text-fg-faint focus:ring-0"
          />
        </dd>
      </dl>
      <div>
        <label className="sr-only" htmlFor={`metric-provenance-${block.id}`}>
          {t('notebook.blockEditor.whereTheNumberComes')}
        </label>
        <input
          id={`metric-provenance-${block.id}`}
          value={a.draft.provenance}
          placeholder={t(
            'notebook.blockEditor.whereThisNumberComesPlaceholder',
          )}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, provenance: event.target.value })
          }}
          onBlur={() => a.flush()}
          className="w-full border-0 bg-transparent p-0 text-xs text-fg-muted outline-none placeholder:text-fg-faint focus:ring-0"
        />
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(
          block.type,
          a.serverValue ? metricPayloadFromDraft(a.serverValue) : {},
        )}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
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
  const initialDraft = React.useMemo(
    () => checklistDraft.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    save,
    offline,
    onStatusChange,
    checklistDraft,
  )

  // Presentation identity never enters the scientific text/checked payload.
  // Local edits carry keys forward; a different canonical snapshot resets them.
  const editorId = React.useId()

  const [editor, setEditor] = React.useState(() => ({
    items: a.draft.items,
    rows: a.draft.items.map((item, index) => ({
      key: `${editorId}-${index}`,
      item,
    })),
  }))

  if (editor.items !== a.draft.items) {
    const unchanged =
      editor.items.length === a.draft.items.length &&
      editor.items.every(
        (item, index) =>
          item.text === a.draft.items[index].text &&
          item.checked === a.draft.items[index].checked,
      )

    setEditor({
      items: a.draft.items,
      rows: a.draft.items.map((item, index) => ({
        key: unchanged ? editor.rows[index].key : crypto.randomUUID(),
        item,
      })),
    })
  }

  function changeItems(rows: typeof editor.rows) {
    const items = rows.map((row) => row.item)
    setEditor({ items, rows })
    a.setTouched(true)
    a.setDraft({ items })
  }

  function update(key: string, patch: Partial<ChecklistItem>) {
    changeItems(
      editor.rows.map((row) =>
        row.key === key ? { ...row, item: { ...row.item, ...patch } } : row,
      ),
    )
  }

  function remove(key: string) {
    changeItems(editor.rows.filter((row) => row.key !== key))
  }

  function add() {
    changeItems([
      ...editor.rows,
      { key: crypto.randomUUID(), item: { text: '', checked: false } },
    ])
  }

  if (readOnly) {
    return (
      <ul className={cn('space-y-1.5', className)}>
        {a.draft.items.length === 0 ? (
          <li className="text-sm text-fg-muted">
            {t('notebook.blockEditor.noChecklistItems')}
          </li>
        ) : null}
        {editor.rows.map(({ key, item }) => (
          <li key={key} className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={item.checked} disabled aria-hidden="true" />
            <span className={cn(item.checked && 'text-fg-muted line-through')}>
              {item.text || t('notebook.blockEditor.untitledItem')}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <ul className="space-y-1.5">
        {editor.rows.map(({ key, item }, i) => (
          <li key={key} className="flex items-center gap-2.5">
            <label className="sr-only" htmlFor={`check-${block.id}-${key}`}>
              {t('notebook.blockEditor.itemIChecked', { i: i + 1 })}
            </label>
            <Checkbox
              id={`check-${block.id}-${key}`}
              checked={item.checked}
              onCheckedChange={(checked) => {
                update(key, { checked: checked === true })
              }}
              className="mt-0.5 size-[18px]"
            />
            <label
              className="sr-only"
              htmlFor={`check-text-${block.id}-${key}`}
            >
              {t('notebook.blockEditor.itemIText', { i: i + 1 })}
            </label>
            <Input
              id={`check-text-${block.id}-${key}`}
              type="text"
              value={item.text}
              autoFocus={autoFocus && i === a.draft.items.length - 1}
              onChange={(e) => update(key, { text: e.target.value })}
              onBlur={() => a.flush()}
              placeholder={t('notebook.blockEditor.itemIPlaceholder', {
                i: i + 1,
              })}
              className={cn(
                'h-7 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0',
                item.checked && 'text-fg-muted line-through',
              )}
            />
            <Button
              type="button"
              variant="quiet"
              size="icon"
              aria-label={t('notebook.blockEditor.removeItemIAriaLabel', {
                i: i + 1,
              })}
              onClick={() => remove(key)}
            >
              <Icon name="trash" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        onClick={add}
        className="text-fg-muted"
      >
        <Icon name="plus" /> {t('notebook.blockEditor.addItem')}
      </Button>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, { ...a.serverValue })}
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
  'material',
  'analysis',
  'file',
  // EXP-02.3: the overview relates an experiment to what it follows and to its
  // upstream work; both are record links.
  'follows',
  'upstream',
] as const

const TARGET_KINDS = [
  'experiment',
  'dataset',
  'sample',
  'material',
  'protocol_template',
  'report',
] as const

const TARGET_KIND_LABELS: Record<(typeof TARGET_KINDS)[number], string> = {
  experiment: t('notebook.blockEditor.experiment'),
  dataset: t('notebook.blockEditor.dataset'),
  sample: t('notebook.blockEditor.sample'),
  material: t('notebook.blockEditor.material'),
  protocol_template: t('notebook.blockEditor.protocolTemplate'),
  report: t('notebook.blockEditor.report'),
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
  /** Immutable Dataset version cited by this link, not the current Dataset. */
  datasetVersionId?: string
  /** A part of the experiment, when the link is to one: "EXP-0142 › Part 3". */
  partNumber?: number
  linkType: string
  label: string
}

const linkedRecordDraft: z.ZodType<LinkedRecordDraft> = z.object({
  targetKind: z.string().catch('experiment'),
  targetIdentifier: z.string().catch(''),
  targetId: z.string().optional().catch(undefined),
  datasetVersionId: z.string().optional().catch(undefined),
  partNumber: z.number().optional().catch(undefined),
  linkType: z.string().catch('general'),
  label: z.string().catch(''),
})

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
    /** The part of the experiment, when one was picked. */
    part?: { number: number; title: string }
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
          .filter(
            (row) =>
              !q ||
              row.name.toLowerCase().includes(q) ||
              (row.display_id ?? '').toLowerCase().includes(q),
          )
          .slice(0, 8)
          .map((row) => ({
            id: row.id,
            // The display id (DS-0298) is what the rest of the app names a
            // dataset by; the name stays as the label and the fallback.
            identifier: row.display_id || row.name,
            title: row.name,
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
        filters.push(`(identifier=ilike.${enc},title=ilike.${enc})`)
      }

      const rows = await notebookDataClient.list<RecordWire>(
        'records',
        `?${filters.join('&')}&order=identifier.asc&limit=8`,
      )

      return rows.map(
        (
          row,
        ): Pick<RecordWire, 'id' | 'identifier' | 'title'> & {
          linkType?: string
        } => ({
          id: row.id,
          identifier: row.identifier,
          title: row.title,
        }),
      )
    },
  })

  // An experiment with parts can be linked at one of them.
  const experimentIds =
    kind === 'experiment' ? (results.data ?? []).map((row) => row.id) : []

  const partRows = useQuery({
    queryKey: ['notebook-linked-parts', experimentIds],
    enabled: experimentIds.length > 0,
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        record_id: string
        position: number
        title: string
      }>(
        'experiment_parts',
        `?record_id=in.(${experimentIds.join(',')})&order=position.asc,id.asc&select=id,record_id,position,title`,
      ),
  })

  const partsOf = (recordId: string) =>
    (partRows.data ?? []).filter((part) => part.record_id === recordId)

  return (
    <div className="space-y-1">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t('notebook.blockEditor.searchRecordsOrDatasetsAriaLabel')}
        placeholder={t('notebook.blockEditor.searchByNameOrPlaceholder')}
      />
      {results.isError ? (
        <p className="text-xs text-danger-text" role="alert">
          {kind === 'dataset'
            ? t('notebook.blockEditor.couldNotSearchDatasets')
            : t('notebook.blockEditor.couldNotSearchRecords')}
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
              <span className="truncate text-fg-muted">{row.title}</span>
            </button>
            {partsOf(row.id).map((part, index) => (
              <button
                key={part.id}
                type="button"
                className="ml-4 flex w-[calc(100%-1rem)] items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                onMouseDown={(event) => {
                  event.preventDefault()
                  onPick({
                    id: row.id,
                    identifier: row.identifier,
                    label: row.title,
                    linkType: row.linkType,
                    part: { number: index + 1, title: part.title },
                  })
                }}
              >
                <span className="font-mono text-xs text-fg-muted">
                  {row.identifier} ›
                </span>
                <span className="truncate">
                  {t('notebook.parts.partTitle', {
                    number: String(index + 1),
                    title: part.title,
                  })}
                </span>
              </button>
            ))}
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
  const initialDraft = React.useMemo(
    () => linkedRecordDraft.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    save,
    offline,
    onStatusChange,
    linkedRecordDraft,
  )

  if (readOnly) {
    const openTo = linkedRecordDestination(a.draft)

    return (
      <div
        className={cn('flex flex-wrap items-center gap-2 text-sm', className)}
      >
        <Badge variant="kind" className="uppercase">
          <Icon name="link" className="size-3" />
          {a.draft.linkType}
        </Badge>
        <span className="font-medium text-fg">
          {a.draft.targetKind}{' '}
          <span className="font-mono">{a.draft.targetIdentifier || '—'}</span>
          {a.draft.partNumber
            ? ` › ${t('notebook.parts.partNumber', { number: String(a.draft.partNumber) })}`
            : ''}
        </span>
        {a.draft.label ? (
          <span className="text-fg-muted">— {a.draft.label}</span>
        ) : null}
        {openTo ? (
          <OpenLink to={openTo}>
            {a.draft.datasetVersionId
              ? t('notebook.blockPreview.openCitedSnapshot')
              : t('common.actions.open')}
          </OpenLink>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          label={t('notebook.blockEditor.label')}
          htmlFor={`lr-kind-${block.id}`}
        >
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
                datasetVersionId: undefined,
                partNumber: undefined,
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
        <Field
          label={t('notebook.blockEditor.identifierLabel')}
          htmlFor={`lr-id-${block.id}`}
        >
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
                datasetVersionId: undefined,
                partNumber: undefined,
              })
            }}
            onBlur={() => a.flush()}
            placeholder={t('notebook.blockEditor.exp20250001Placeholder')}
            className="font-mono"
          />
        </Field>
        <Field
          label={t('notebook.blockEditor.linkTypeLabel')}
          htmlFor={`lr-link-${block.id}`}
        >
          <Select
            id={`lr-link-${block.id}`}
            value={a.draft.linkType}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, linkType: e.target.value })
            }}
          >
            {LINK_TYPES.map((linkType) => (
              <option key={linkType} value={linkType}>
                {linkType}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('notebook.blockEditor.labelLabel')}
          htmlFor={`lr-label-${block.id}`}
        >
          <Input
            id={`lr-label-${block.id}`}
            type="text"
            value={a.draft.label}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, label: e.target.value })
            }}
            onBlur={() => a.flush()}
            placeholder={t('common.states.optional')}
          />
        </Field>
      </div>
      <LinkedRecordSearch
        kind={a.draft.targetKind}
        onPick={(picked) => {
          a.setTouched(true)
          const { partNumber: _previousPart, ...rest } = a.draft

          const next: LinkedRecordDraft = {
            ...rest,
            targetIdentifier: picked.identifier,
            targetId: picked.id,
            datasetVersionId: undefined,
            label: picked.label || a.draft.label,
            linkType: picked.linkType ?? a.draft.linkType,
          }

          if (picked.part) next.partNumber = picked.part.number
          a.setDraft(next)
          a.flush()
        }}
      />
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, { ...a.serverValue })}
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
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
      >
        {label}
      </label>
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
      status === 'Approved' ? 'add' : status === 'Rejected' ? 'del' : 'chg'

    return (
      <div className="space-y-2 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {String(block.payload.protocolTitle)}
            </p>
            <p className="font-mono text-xs text-fg-muted">
              {t('notebook.blockEditor.identifierVersion', {
                identifier: String(block.payload.protocolIdentifier),
                version: String(block.payload.version),
              })}
            </p>
          </div>
          <Badge variant={statusVariant}>{status}</Badge>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Icon name="pin" className="size-3" />
          {t('notebook.blockEditor.pinnedNotebookdatetime', {
            notebookDateTime: formatNotebookDateTime(
              String(block.payload.pinnedAt),
              {
                zone: true,
              },
            ),
          })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 py-1">
      <p className="text-sm font-medium">
        {t('notebook.blockEditor.selectAProtocolVersion')}
      </p>
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
                  : t('notebook.blockEditor.couldNotPinProtocol'),
              ),
            )
            .finally(() => setPending(false))
        }}
      />
      {error ? (
        <Notice tone="bad" className="p-2">
          {error}
        </Notice>
      ) : null}
    </div>
  )
}

const templateStep = z.looseObject({
  text: z.string().catch(''),
  durationSeconds: z.number().optional(),
})

const executionStep = templateStep.extend({
  completed: z.boolean().catch(false),
  note: z.string().catch(''),
  stepNumber: z.number().optional().catch(undefined),
})

const materialsDraft = z.object({ items: materialItems })

function ProcedureStepEditor(props: BlockEditorProps) {
  return z.boolean().safeParse(props.block.payload.completed).success ? (
    <ExecutionStepEditor {...props} />
  ) : (
    <TemplateStepEditor {...props} />
  )
}

/** A step in a protocol: its wording, and how long it takes if it is timed. */
function TemplateStepEditor(props: BlockEditorProps) {
  const { block } = props

  const payload = React.useMemo(
    () => templateStep.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    payload,
    props.save,
    props.offline,
    props.onStatusChange,
    templateStep,
  )

  const seconds = stepDurationSeconds(a.draft)

  const [minutes, setMinutes] = React.useState(
    seconds === null ? '' : String(Math.round((seconds / 60) * 100) / 100),
  )

  return (
    <div className="space-y-3">
      <Field
        label={t('notebook.stepTimers.editor.textLabel')}
        htmlFor={`step-text-${block.id}`}
      >
        <Textarea
          id={`step-text-${block.id}`}
          value={a.draft.text}
          disabled={props.readOnly}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, text: event.target.value })
          }}
          onBlur={() => a.flush()}
          rows={2}
        />
      </Field>
      <Field
        label={t('notebook.stepTimers.editor.durationLabel')}
        htmlFor={`step-duration-${block.id}`}
      >
        <Input
          id={`step-duration-${block.id}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="w-32"
          value={minutes}
          disabled={props.readOnly}
          onChange={(event) => {
            setMinutes(event.target.value)
            const value = Number(event.target.value)
            const { durationSeconds: _removed, ...rest } = a.draft
            a.setTouched(true)
            a.setDraft(
              event.target.value.trim() !== '' &&
                Number.isFinite(value) &&
                value > 0
                ? { ...rest, durationSeconds: Math.round(value * 60) }
                : rest,
            )
          }}
          onBlur={() => a.flush()}
        />
        <p className="text-xs text-fg-muted">
          {t('notebook.stepTimers.editor.durationHelp')}
        </p>
      </Field>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

function ExecutionStepEditor(props: BlockEditorProps) {
  const { block } = props
  const payload = block.payload

  const initial = React.useMemo(() => executionStep.parse(payload), [payload])

  const a = useBlockAutosave(
    block,
    initial,
    props.save,
    props.offline,
    props.onStatusChange,
    executionStep,
  )

  const durationSeconds = stepDurationSeconds(payload)

  const stepNumber = useStepNumber(block.id, initial.stepNumber ?? null)

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
          <span className="block text-xs font-medium text-fg-muted">
            {t('notebook.blockEditor.step', {
              number: String(stepNumber ?? ''),
            })}
          </span>
          <span
            className={cn(
              'block text-sm',
              a.draft.completed && 'text-fg-muted',
            )}
          >
            {initial.text}
          </span>
        </span>
      </label>
      {durationSeconds !== null ? (
        <StepTimerControl
          blockId={block.id}
          durationSeconds={durationSeconds}
          className="pl-7"
        />
      ) : null}
      <Field
        label={t('notebook.blockEditor.executionNoteLabel')}
        htmlFor={`step-note-${block.id}`}
      >
        <Textarea
          id={`step-note-${block.id}`}
          value={a.draft.note}
          disabled={props.readOnly}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, note: event.target.value })
          }}
          onBlur={() => a.flush()}
          rows={2}
        />
      </Field>
      {isPinnedProtocolStep(payload) ? (
        <StepDeviation
          block={block}
          save={props.save}
          readOnly={props.readOnly}
        />
      ) : null}
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
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
      items: materialItems.parse(block.payload.items),
    }),
    [block.payload],
  )

  const a = useBlockAutosave(
    block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
    materialsDraft,
  )

  const [kind, setKind] = React.useState<'sample' | 'material'>('sample')
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
        <p className="text-sm text-fg-muted">
          {t('notebook.blockEditor.noMaterialsLinkedYet')}
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
                  <Badge variant="kind" className="shrink-0">
                    {item.kind === 'sample' ? (
                      <Icon name="flask" className="size-3" />
                    ) : (
                      <Icon name="tube" className="size-3" />
                    )}
                    {item.kind}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-fg-muted">
                  {item.identifier}
                </p>
                {props.readOnly && !isWithdrawn(item) ? null : (
                  <StockWithdrawButton
                    item={item}
                    experimentId={block.recordId}
                    note={item.note}
                    onWithdrawn={(note) => {
                      const items = [...a.draft.items]
                      items[index] = { ...item, note }
                      updateItems(items, true)
                    }}
                  />
                )}
              </div>
              <Input
                aria-label={t(
                  'notebook.blockEditor.quantityForTitleAriaLabel',
                  { title: item.title },
                )}
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
                aria-label={t('notebook.blockEditor.unitForTitleAriaLabel', {
                  title: item.title,
                })}
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
                variant="quiet"
                size="icon"
                aria-label={t('notebook.blockEditor.removeTitleAriaLabel', {
                  title: item.title,
                })}
                onClick={() =>
                  updateItems(
                    a.draft.items.filter((x) => x.id !== item.id),
                    true,
                  )
                }
              >
                <Icon name="trash" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface space-y-3 p-3">
        <div className="flex gap-2">
          {(['sample', 'material'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={kind === value ? 'primary' : 'secondary'}
              onClick={() => {
                setKind(value)
                setSelected(null)
              }}
            >
              {value === 'sample' ? (
                <Icon name="flask" />
              ) : (
                <Icon name="tube" />
              )}
              {value === 'sample'
                ? t('notebook.blockEditor.samples')
                : t('notebook.blockEditor.materials')}
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
              aria-label={t('notebook.blockEditor.materialQuantityAriaLabel')}
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={t('notebook.blockEditor.quantityPlaceholder')}
              className="font-mono tabular-nums"
            />
            <Input
              aria-label={t('notebook.blockEditor.canonicalUnitCodeAriaLabel')}
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              placeholder={t('notebook.blockEditor.unitCodeUlPlaceholder')}
              className="font-mono"
            />
            <Input
              aria-label={t('notebook.blockEditor.unitSymbolAriaLabel')}
              value={materialUnitSymbol}
              onChange={(e) => setMaterialUnitSymbol(e.target.value)}
              placeholder={t('notebook.blockEditor.symbolLPlaceholder')}
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
              <Icon name="plus" /> {t('notebook.blockEditor.addMaterial')}
            </Button>
          </div>
        ) : null}
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, a.serverValue ?? {})}
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
        <p className="font-medium text-fg">
          {t('notebook.blockEditor.typeNotEditableHere', { type: block.type })}
        </p>
        <p className="mt-1 text-fg-muted">
          {t('notebook.blockEditor.thisKindOfBlock')}
        </p>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-muted/40 p-2 font-mono text-xs">
          {JSON.stringify(block.payload, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCI-003 file block editor. The pick surface is the shared `FileDrop` field
// (ADR-0055): a real drop target with a keyboard route to the same dialog, and
// one row per pick carrying the attach call's progress and its retry. The type
// and size policy is `validateFileForUpload`, which the field refuses a pick on
// before anything leaves the browser, and the server re-validates again.
// `onAttachFile` authorizes + streams the bytes through the bounded
// `/api/files` routes and persists the file reference in the block payload.
// Once attached, the block renders the file (read-only here; the preview shows
// live status). Replacing a file is a later concern.
// ---------------------------------------------------------------------------

function FileBlockEditor(props: BlockEditorProps) {
  const { block, onAttachFile, readOnly } = props

  if (Object.keys(block.payload).length > 0)
    return <FileAttachmentEditor {...props} />

  return (
    <FileDrop
      label={t('notebook.blockEditor.attachAFileLabel')}
      inputLabel={t('notebook.blockEditor.attachAFileLabel')}
      hint={
        <>
          {t('notebook.blockEditor.csvTextJsonPdf', {
            fileSize: formatFileSize(FILE_MAX_BYTES),
          })}
        </>
      }
      validate={validateFileForUpload}
      disabled={!onAttachFile || readOnly}
      disabledReason={
        onAttachFile
          ? t('notebook.blockEditor.blockReadOnly')
          : t('notebook.blockEditor.fileUploadIsNot')
      }
      onFile={(file) => {
        if (file && onAttachFile) return onAttachFile(file)

        return undefined
      }}
    />
  )
}

function FileAttachmentEditor({
  block,
  onMakeSheet,
  readOnly,
  save,
}: BlockEditorProps) {
  const [annotateOpen, setAnnotateOpen] = React.useState(false)
  const [marks, setMarks] = React.useState(() => readAnnotations(block.payload))
  React.useEffect(() => {
    setMarks(readAnnotations(block.payload))
  }, [block.payload])

  // The preview renders the live file state; the editor just confirms it.
  // No Card/border here so the edit transition doesn't add a box around
  // content that reads as a seamless line in the document flow.
  const name = z
    .string()
    .catch(t('notebook.blockEditor.file'))
    .parse(block.payload.displayName)

  const mediaType = z.string().catch('').parse(block.payload.mediaType)
  const byteSize = z.number().catch(0).parse(block.payload.byteSize)
  const fileRecordId = z.string().catch('').parse(block.payload.fileRecordId)
  const fileGlyph = fileGlyphFor(mediaType)

  const showImage = Boolean(fileRecordId) && isInlinePreviewableImage(mediaType)

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted">
          {fileGlyph}
        </div>
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="font-mono text-xs text-fg-muted tabular-nums">
            {mediaType || 'unknown'} · {formatFileSize(byteSize)}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <OfficeEditButton
            fileRecordId={fileRecordId}
            fileName={name}
            recordId={block.recordId}
          />
          <Badge variant="add">{t('notebook.blockEditor.attached')}</Badge>
        </div>
      </div>
      {showImage ? (
        <div className="space-y-2">
          <AnnotatedImage
            src={`/api/files/${fileRecordId}/download`}
            alt={name}
            annotations={marks}
            className="mt-2"
            imageClassName="max-h-80"
          />
          {!readOnly ? (
            <div>
              <Button
                size="sm"
                icon="edit"
                onClick={() => setAnnotateOpen(true)}
              >
                {marks.length > 0
                  ? t('notebook.imageAnnotations.editAnnotations')
                  : t('notebook.imageAnnotations.annotate')}
              </Button>
            </div>
          ) : null}
          <ImageAnnotator
            open={annotateOpen}
            onOpenChange={setAnnotateOpen}
            src={`/api/files/${fileRecordId}/download`}
            name={name}
            initial={marks}
            onSave={async (next) => {
              const result = await save(withAnnotations(block.payload, next))

              if (!result.ok) throw new Error(result.message ?? 'save failed')
              setMarks(next)
            }}
          />
        </div>
      ) : null}
      {!showImage && !isSequenceFileName(name) ? (
        <OfficeFileBlock
          payload={block.payload}
          save={save}
          readOnly={readOnly}
          actions={
            onMakeSheet &&
            !readOnly &&
            fileRecordId &&
            canMakeSheet(mediaType) ? (
              <MakeSheetFromFile
                fileRecordId={fileRecordId}
                fileVersion={z
                  .number()
                  .nullable()
                  .catch(null)
                  .parse(block.payload.fileVersion)}
                fileName={name}
                mediaType={mediaType}
                onMake={onMakeSheet}
              />
            ) : null
          }
        />
      ) : null}
    </div>
  )
}

/** Pick a file glyph from the media type. */
function fileGlyphFor(mediaType: string) {
  if (mediaType.startsWith('image/'))
    return <Icon name="image" className="size-4" />

  if (
    mediaType.includes('spreadsheet') ||
    mediaType.includes('csv') ||
    mediaType.includes('excel')
  )
    return <Icon name="table" className="size-4" />

  if (mediaType.startsWith('text/') || mediaType === 'application/json')
    return <Icon name="protocol" className="size-4" />

  return <Icon name="file" className="size-4" />
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

function useChartDraft({
  block,
  save,
  offline,
  onStatusChange,
}: Pick<BlockEditorProps, 'block' | 'save' | 'offline' | 'onStatusChange'>) {
  const initial = React.useMemo(
    () => chartPayload.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave<ChartBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
    chartPayload,
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
    updateSpec(chartTypePatch(spec, next))
  }

  // Start a spec when the user picks a dataset for an empty draft.
  function chooseDataset(datasetId: string) {
    a.setTouched(true)

    // The query still describes the previous selection in this event. The
    // canonical picker summaries already carry the chosen dataset's fields.
    const col =
      availableDatasets.find((dataset) => dataset.datasetId === datasetId)
        ?.columns ?? []

    a.setDraft({
      ...draft,
      spec: chartSpecForDataset(datasetId, spec?.type ?? 'line', col),
    })
  }

  const preview = useChartPreview(draft)

  return {
    a,
    draft,
    spec,
    frozen,
    datasetsQuery,
    availableDatasets,
    selectedDatasetId,
    columns,
    updateSpec,
    updateDisplay,
    updateFields,
    setChartType,
    chooseDataset,
    preview,
  }
}

/** Canonical dataset reads and autosave stay with the draft, not field presentation. */
function ChartBlockEditor(props: BlockEditorProps) {
  const { block, readOnly, onFreezeChart, onUnfreezeChart } = props

  const {
    a,
    draft,
    spec,
    frozen,
    datasetsQuery,
    availableDatasets,
    selectedDatasetId,
    columns,
    updateSpec,
    updateDisplay,
    updateFields,
    setChartType,
    chooseDataset,
    preview,
  } = useChartDraft(props)

  const fieldOptions = columns.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ))

  const { previewMaterialised, previewLoading, frozenFacets } = preview

  return (
    <div className="space-y-4">
      <ChartRenderer
        title={draft.title || t('notebook.blockEditor.title')}
        provenance={draft.provenance}
        spec={spec}
        materialised={previewMaterialised}
        frozen={frozen}
        loading={previewLoading}
        facets={frozenFacets?.panels}
        facetTotal={frozenFacets?.total}
      />

      {readOnly ? null : (
        <div className="rounded-lg border border-border bg-surface space-y-4 p-3">
          <ChartField label={t('notebook.blockEditor.titleLabel')}>
            <Input
              aria-label={t('notebook.blockEditor.chartTitleAriaLabel')}
              value={draft.title ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, title: e.target.value })
              }}
              onBlur={() => a.flush()}
            />
          </ChartField>

          <ChartField label={t('notebook.blockEditor.datasetLabel')}>
            <PickerSelect
              noun="dataset"
              aria-label={t('notebook.blockEditor.datasetLabel')}
              value={selectedDatasetId}
              onChange={(id) => {
                chooseDataset(id)
                // Save once the choice has rendered; a picker has no blur.
                setTimeout(() => a.flush(), 0)
              }}
              disabled={!!frozen || datasetsQuery.isLoading}
              placeholder={
                datasetsQuery.isLoading
                  ? t('notebook.blockEditor.loadingDatasets')
                  : t('notebook.blockEditor.selectADataset')
              }
              options={availableDatasets.map((d) =>
                datasetOption({ id: d.datasetId, name: d.name }),
              )}
            />
            <p className="text-xs text-fg-muted">
              {t('notebook.blockEditor.chartsPlotDatasetData2')}
            </p>
          </ChartField>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartField label={t('notebook.blockEditor.chartTypeLabel')}>
              <Select
                aria-label={t('notebook.blockEditor.chartTypeLabel')}
                value={spec?.type ?? 'line'}
                onChange={(e) =>
                  setChartType(z.enum(CHART_TYPES).parse(e.target.value))
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                {CHART_TYPES.map((chartType) => (
                  <option key={chartType} value={chartType}>
                    {chartType.charAt(0).toUpperCase() + chartType.slice(1)}
                  </option>
                ))}
              </Select>
            </ChartField>
            <ChartSeriesField
              spec={spec}
              frozen={!!frozen}
              fieldOptions={fieldOptions}
              updateFields={updateFields}
              onBlur={() => a.flush()}
            />
            <ChartField label={t('notebook.blockEditor.xFieldLabel')}>
              {spec?.type === 'histogram' || spec?.type === 'box' ? (
                <p className="text-xs text-fg-muted">
                  {t('notebook.blockEditor.notUsedForType', {
                    type: spec.type,
                  })}
                </p>
              ) : (
                <Select
                  aria-label={t('notebook.blockEditor.xFieldLabel')}
                  value={bindingValue(spec?.fields.x)}
                  onChange={(e) =>
                    updateFields({ x: parseBinding(e.target.value) })
                  }
                  onBlur={() => a.flush()}
                  disabled={!!frozen || !spec}
                >
                  <option value="">{t('notebook.blockEditor.none')}</option>
                  {fieldOptions}
                </Select>
              )}
            </ChartField>
            <ChartField label={t('notebook.blockEditor.yFieldLabel')}>
              <Select
                aria-label={t('notebook.blockEditor.yFieldLabel')}
                value={bindingValue(spec?.fields.y)}
                onChange={(e) =>
                  updateFields({
                    y: parseBinding(e.target.value) ?? { fieldId: '' },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
              >
                <option value="">{t('notebook.blockEditor.none')}</option>
                {fieldOptions}
              </Select>
            </ChartField>
            <ChartAxisScales
              spec={spec}
              frozen={!!frozen}
              updateDisplay={updateDisplay}
              onBlur={() => a.flush()}
            />
          </div>

          <ChartTypeParameters
            spec={spec}
            frozen={!!frozen}
            updateSpec={updateSpec}
            onBlur={() => a.flush()}
          />

          <ChartField
            label={t('notebook.blockEditor.provenanceNoteOptionalLabel')}
          >
            <Input
              aria-label={t('notebook.blockEditor.provenanceNoteAriaLabel')}
              value={draft.provenance ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, provenance: e.target.value })
              }}
              onBlur={() => a.flush()}
            />
          </ChartField>

          <EvidenceFreezeActions
            frozen={!!frozen}
            hasSpec={!!spec}
            ready={previewMaterialised.state.kind === 'ok'}
            onFreeze={onFreezeChart}
            onUnfreeze={onUnfreezeChart}
            unfreezeLabel={t('notebook.blockEditor.unfreezeEditLiveAgain')}
            readyTitle={t('notebook.blockEditor.freezeTheDatasetAsTitle')}
            blockedTitle={t(
              'notebook.blockEditor.resolveChartStateBeforeTitle',
            )}
          />
        </div>
      )}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, { ...a.serverValue })}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />
    </div>
  )
}

/** Heatmaps have no series binding, while other chart kinds share field choices. */
function ChartSeriesField({
  spec,
  frozen,
  fieldOptions,
  updateFields,
  onBlur,
}: {
  spec: ChartSpec | null
  frozen: boolean
  fieldOptions: React.ReactNode
  updateFields: (patch: Partial<ChartSpec['fields']>) => void
  onBlur: () => void
}) {
  return (
    <ChartField label={t('notebook.blockEditor.seriesFieldOptionalLabel')}>
      {spec?.type === 'heatmap' ? (
        <p className="text-xs text-fg-muted">
          {t('notebook.blockEditor.notUsedForHeatmap')}
        </p>
      ) : (
        <Select
          aria-label={t('notebook.blockEditor.seriesFieldAriaLabel')}
          value={bindingValue(spec?.fields.series)}
          onChange={(e) =>
            updateFields({ series: parseBinding(e.target.value) })
          }
          onBlur={onBlur}
          disabled={frozen || !spec}
        >
          <option value="">{t('notebook.blockEditor.none')}</option>
          {fieldOptions}
        </Select>
      )}
    </ChartField>
  )
}

/** Evidence lifecycle actions remain delegated to the route's transactional RPCs. */
function EvidenceFreezeActions({
  frozen,
  hasSpec,
  ready,
  onFreeze,
  onUnfreeze,
  unfreezeLabel,
  readyTitle,
  blockedTitle,
}: {
  onFreeze: BlockEditorProps['onFreezeChart']
  onUnfreeze: BlockEditorProps['onUnfreezeChart']
  frozen: boolean
  hasSpec: boolean
  ready: boolean
  unfreezeLabel: string
  readyTitle: string
  blockedTitle: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {frozen ? (
        <>
          <Badge variant="chg">
            <Icon name="snowflake" className="size-3" />
            {t('notebook.blockEditor.frozenSnapshotImmutable')}
          </Badge>
          {onUnfreeze ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void onUnfreeze()}
            >
              <Icon name="edit" /> {unfreezeLabel}
            </Button>
          ) : null}
        </>
      ) : onFreeze && hasSpec ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onFreeze()}
          disabled={!ready}
          title={ready ? readyTitle : blockedTitle}
        >
          <Icon name="snowflake" /> {t('notebook.blockEditor.freezeSnapshot')}
        </Button>
      ) : null}
    </div>
  )
}

function ChartAxisScales({
  spec,
  frozen,
  updateDisplay,
  onBlur,
}: {
  spec: ChartSpec | null
  frozen: boolean
  updateDisplay: (patch: Partial<ChartSpec['display']>) => void
  onBlur: () => void
}) {
  return (['x', 'y'] as const).map((axis) => {
    const label =
      axis === 'x'
        ? t('notebook.blockEditor.xAxisScaleLabel')
        : t('notebook.blockEditor.yAxisScaleLabel')

    return (
      <ChartField key={axis} label={label}>
        <Select
          aria-label={label}
          value={spec?.display.axes[axis].scale ?? 'linear'}
          onChange={(e) => {
            if (!spec) return
            updateDisplay({
              axes: {
                ...spec.display.axes,
                [axis]: {
                  ...spec.display.axes[axis],
                  scale: z.enum(AXIS_SCALES).parse(e.target.value),
                },
              },
            })
          }}
          onBlur={onBlur}
          disabled={frozen || !spec}
        >
          {AXIS_SCALES_EDITOR.map((scale) => (
            <option key={scale} value={scale}>
              {scale}
            </option>
          ))}
        </Select>
      </ChartField>
    )
  })
}

/** Controls that exist only for a particular chart type. */
function ChartTypeParameters({
  spec,
  frozen,
  updateSpec,
  onBlur,
}: {
  spec: ChartSpec | null
  frozen: boolean
  updateSpec: (patch: Partial<ChartSpec>) => void
  onBlur: () => void
}) {
  if (spec?.type === 'histogram') {
    return (
      <ChartField label={t('notebook.blockEditor.binsLabel')}>
        <Input
          aria-label={t('notebook.blockEditor.histogramBinCountAriaLabel')}
          type="number"
          min={1}
          max={200}
          value={spec.typeParams.histogram?.bins ?? 10}
          onChange={(e) =>
            updateSpec({
              typeParams: {
                histogram: { bins: Math.max(1, Number(e.target.value) || 10) },
              },
            })
          }
          onBlur={onBlur}
          disabled={frozen}
        />
      </ChartField>
    )
  }

  if (spec?.type !== 'heatmap') return null

  return (
    <ChartField label={t('notebook.blockEditor.cellValueLabel')}>
      <Select
        aria-label={t('notebook.blockEditor.heatmapCellAggregationAriaLabel')}
        value={spec.typeParams.heatmap?.aggregate ?? 'count'}
        onChange={(e) => {
          const aggregate = z.enum(HEATMAP_AGGREGATES).parse(e.target.value)
          updateSpec({
            typeParams: {
              heatmap:
                aggregate === 'count'
                  ? { aggregate, valueField: null }
                  : {
                      aggregate,
                      valueField:
                        spec.typeParams.heatmap?.valueField ?? spec.fields.y,
                    },
            },
          })
        }}
        onBlur={onBlur}
        disabled={frozen}
      >
        <option value="count">{t('notebook.blockEditor.rowCount')}</option>
        <option value="mean">{t('notebook.blockEditor.meanOfY')}</option>
        <option value="median">{t('notebook.blockEditor.medianOfY')}</option>
        <option value="min">{t('notebook.blockEditor.minOfY')}</option>
        <option value="max">{t('notebook.blockEditor.maxOfY')}</option>
      </Select>
    </ChartField>
  )
}

function chartTypePatch(spec: ChartSpec, next: ChartType): Partial<ChartSpec> {
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

  return { type: next, fields, overlays, typeParams, display }
}

function chartSpecForDataset(
  datasetId: string,
  type: ChartType,
  columns: ChartColumn[],
): ChartSpec {
  const xCol = columns.at(0)
  const yCol = columns.at(1) ?? xCol

  return {
    specVersion: CHART_SPEC_VERSION,
    type,
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
          unit: unitMetadata.parse(xCol?.unit).symbol,
        },
        y: {
          label: yCol?.label ?? 'y',
          scale: 'linear',
          unit: unitMetadata.parse(yCol?.unit).symbol,
        },
      },
      series: [],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
}

/** Preserve the pinned/live evidence boundary independently of authoring controls. */
function useChartPreview(draft: ChartBlockPayload) {
  const spec = draft.spec ?? null
  const frozen = draft.frozen ?? null
  const { datasetQuery } = useLiveChartDataset(spec)
  const pinnedRows = useFrozenPinnedRows(frozen)

  return {
    ...chartPreviewForEvidence(
      draft,
      datasetQuery.data ?? null,
      pinnedRows.data,
    ),
    previewLoading: frozen
      ? Boolean(frozenPinsDatasetVersion(frozen) && pinnedRows.isLoading)
      : datasetQuery.isLoading,
  }
}

/** Materialization is pure; only the hook above owns the live/pinned reads. */
function chartPreviewForEvidence(
  draft: ChartBlockPayload,
  liveDataset: Parameters<typeof materialiseLiveChart>[1],
  pinnedRows: ReturnType<typeof useFrozenPinnedRows>['data'],
) {
  const spec = draft.spec ?? null
  const frozen = draft.frozen ?? null

  const reconstructed =
    frozen && spec && frozenPinsDatasetVersion(frozen) && pinnedRows
      ? reconstructFrozenVisualisation({
          spec,
          frozen,
          rows: pinnedRows.rows,
        })
      : null

  const previewMaterialised = frozen
    ? (reconstructed?.chart ?? materialiseFrozenChart(frozen))
    : spec
      ? materialiseLiveChart(spec, liveDataset)
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

  const frozenFacets =
    reconstructed?.facets ?? (frozen ? materialiseFrozenFacets(frozen) : null)

  return { previewMaterialised, frozenFacets }
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
      <span className="font-medium text-fg-muted">{label}</span>
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

const unitMetadata = z.object({ symbol: z.string().optional() }).catch({})

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
  const initial = React.useMemo(
    () => platePayload.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave<PlateMapBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
    platePayload,
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
        w.replicate &&
          t('notebook.blockEditor.replicateShort', { replicate: w.replicate }),
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
        <p className="font-medium text-fg">
          {draft.title ?? t('notebook.blockEditor.plateMap')}
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
          <p className="text-sm text-fg-muted">
            {t('notebook.blockEditor.noPlateMapConfigured')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Title */}
      <Field
        label={t('notebook.blockEditor.titleLabel')}
        htmlFor={`pm-title-${block.id}`}
      >
        <Input
          id={`pm-title-${block.id}`}
          type="text"
          value={draft.title ?? ''}
          onChange={(e) => updateDraft({ title: e.target.value })}
          placeholder={t('notebook.blockEditor.eGQpcrTitrationPlaceholder')}
        />
      </Field>

      {/* Format info */}
      {spec ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge variant="chg">{t('notebook.blockEditor.96Well812')}</Badge>
          <span className="tabular-nums">
            {t('notebook.blockEditor.countWellsAssigned', {
              count: spec.wells.length,
            })}
          </span>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => ensureSpec()}>
          {t('notebook.blockEditor.initialize96WellPlate')}
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
              ariaLabel={t('notebook.blockEditor.plateMapEditorClickAriaLabel')}
            />
          </div>

          {/* Inspector */}
          <div className="rounded-lg border border-border bg-surface space-y-3 p-3">
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
              <p className="text-xs text-fg-muted">
                {t('notebook.blockEditor.clickAWellIn')}
              </p>
            )}

            {/* Validation config */}
            <ValidationConfigEditor
              spec={spec}
              onChange={(validation) => updateSpec({ validation })}
            />
          </div>
        </div>
      ) : null}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, { ...a.serverValue })}
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
        <h4 className="text-sm font-medium">
          {t('notebook.blockEditor.wellWellcode', { wellCode })}
        </h4>
        {well ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={onRemoveWell}
            className="text-danger-text"
          >
            <Icon name="trash" /> {t('common.actions.remove')}
          </Button>
        ) : null}
      </div>

      {/* Role selector */}
      <Field
        label={t('notebook.blockEditor.roleLabel')}
        htmlFor={`well-role-${wellCode}`}
      >
        <Select
          id={`well-role-${wellCode}`}
          value={role}
          onChange={(e) =>
            onAssignRole(z.enum(ASSIGNMENT_ROLES).parse(e.target.value))
          }
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
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.sample')}
          </p>
          {well?.sampleRef ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-surface-muted/20 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {well.sampleRef.identifier}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {well.sampleRef.title}
                  {well.sampleRef.archived
                    ? t('notebook.blockEditor.archived')
                    : ''}
                </p>
              </div>
              <IconButton
                type="button"
                icon="x"
                label={t('common.actions.clear')}
                onClick={onClearSample}
                className="shrink-0 text-danger-text"
              />
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
              searchLabel={t('notebook.blockEditor.searchSamples')}
              className="max-h-48"
            />
          )}
        </div>
      ) : null}

      {/* Replicate */}
      {role !== 'empty' ? (
        <Field
          label={t('notebook.blockEditor.replicateLabel')}
          htmlFor={`well-rep-${wellCode}`}
        >
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
        <WellVolumeEditor
          wellCode={wellCode}
          volume={well?.volume}
          onSetVolume={onSetVolume}
          onClearVolume={onClearVolume}
        />
      ) : null}

      {/* Notes */}
      {role !== 'empty' ? (
        <Field
          label={t('notebook.blockEditor.notesLabel')}
          htmlFor={`well-notes-${wellCode}`}
        >
          <Textarea
            id={`well-notes-${wellCode}`}
            value={well?.notes ?? ''}
            onChange={(e) => onSetNotes(e.target.value)}
            placeholder={t('notebook.blockEditor.optionalNotesPlaceholder')}
            rows={2}
          />
        </Field>
      ) : null}
    </div>
  )
}

function WellVolumeEditor({
  wellCode,
  volume,
  onSetVolume,
  onClearVolume,
}: {
  wellCode: string
  volume: WellAssignment['volume']
  onSetVolume: (value: number, unit: string) => void
  onClearVolume: () => void
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`well-volume-${wellCode}`}
        className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
      >
        {t('notebook.blockEditor.volume')}
      </label>
      {volume ? (
        <div className="flex items-center gap-2">
          <Input
            id={`well-volume-${wellCode}`}
            type="number"
            min={0}
            step="any"
            value={volume.value}
            onChange={(e) =>
              onSetVolume(parseFloat(e.target.value) || 0, volume.unit)
            }
            className="w-20 font-mono tabular-nums"
          />
          <Input
            type="text"
            value={volume.unit}
            aria-label={t('notebook.blockEditor.unitLabel')}
            onChange={(e) => onSetVolume(volume.value, e.target.value)}
            className="w-16 font-mono"
          />
          <IconButton
            type="button"
            icon="x"
            label={t('common.actions.clear')}
            onClick={onClearVolume}
            className="text-danger-text"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={`well-volume-${wellCode}`}
            type="number"
            min={0}
            step="any"
            placeholder="value"
            onChange={(e) => onSetVolume(parseFloat(e.target.value) || 0, 'µL')}
            className="w-20 font-mono tabular-nums"
          />
          <span className="text-xs text-fg-muted">µL</span>
        </div>
      )}
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
  const requiredRoles = new Set(v.requiredRoles)

  return (
    <details className="space-y-3 rounded-md border p-3">
      <summary className="cursor-pointer text-xs font-medium text-fg-muted">
        {t('notebook.blockEditor.validationConfig')}
      </summary>
      <div className="space-y-3">
        <div
          role="group"
          aria-label={t('notebook.blockEditor.requiredRoles')}
          className="space-y-1.5"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.requiredRoles')}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ASSIGNMENT_ROLES.filter((r) => r !== 'empty').map((r) => (
              <label
                key={r}
                className="flex items-center gap-1.5 text-xs text-fg"
              >
                <Checkbox
                  checked={requiredRoles.has(r)}
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
          <Field
            label={t('notebook.blockEditor.volMinLabel')}
            htmlFor={`vc-volmin-${spec.rows}`}
          >
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
          <Field
            label={t('notebook.blockEditor.volMaxLabel')}
            htmlFor={`vc-volmax-${spec.rows}`}
          >
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
          <Field
            label={t('notebook.blockEditor.unitLabel')}
            htmlFor={`vc-volunit-${spec.rows}`}
          >
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

/** What a saved analysis holds, for its entry in the picker. */
function analysisContents(
  definition: z.output<typeof analysisDefinition> | null,
): string {
  if (!definition) return ''

  if (definition.kind === 'chart') return t('notebook.blockEditor.chart')

  return definition.chart ? t('notebook.blockEditor.statisticAndChart') : ''
}

function useAnalysisDraft({
  block,
  save,
  offline,
  onStatusChange,
}: Pick<BlockEditorProps, 'block' | 'save' | 'offline' | 'onStatusChange'>) {
  const initial = React.useMemo(
    () => analysisPayload.parse(block.payload),
    [block.payload],
  )

  const a = useBlockAutosave<AnalysisBlockPayload>(
    block,
    initial,
    save,
    offline,
    onStatusChange,
    analysisPayload,
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

    const name = saved.name

    a.setDraft({
      ...draft,
      definitionId: id,
      title: draft.title || name,
    })
  }

  const validation = validateAnalysisBlockPayload(draft)

  return {
    a,
    draft,
    frozen,
    definitionsQuery,
    definitions,
    selected,
    chooseDefinition,
    validation,
  }
}

function AnalysisBlockEditor(props: BlockEditorProps) {
  const { block, readOnly, onFreezeAnalysis, onUnfreezeAnalysis } = props

  const {
    a,
    draft,
    frozen,
    definitionsQuery,
    definitions,
    selected,
    chooseDefinition,
    validation,
  } = useAnalysisDraft(props)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface space-y-3 p-3">
        <ChartField label={t('notebook.blockEditor.savedAnalysisLabel')}>
          <PickerSelect
            noun="analysis"
            aria-label={t('notebook.blockEditor.savedAnalysisLabel')}
            value={draft.definitionId ?? ''}
            onChange={(id) => {
              chooseDefinition(id)
              setTimeout(() => a.flush(), 0)
            }}
            disabled={!!frozen || definitionsQuery.isLoading}
            placeholder={
              definitionsQuery.isLoading
                ? t('notebook.blockEditor.loadingSavedAnalyses')
                : definitions.length === 0
                  ? t('notebook.blockEditor.noSavedAnalysesPlaceholder')
                  : t('notebook.blockEditor.selectAnAnalysis')
            }
            options={definitions.map((d) => ({
              id: d.id,
              label: d.name,
              detail: t('notebook.blockEditor.detail', {
                version: d.version,
                analysisContents: analysisContents(
                  analysisDefinition.safeParse(d.definition).data ?? null,
                ),
              }),
            }))}
          />
          {!definitionsQuery.isLoading && definitions.length === 0 ? (
            <p className="text-xs text-fg-muted">
              {rich('notebook.blockEditor.createOneInThe', {
                link: (text) => (
                  <OpenLink
                    to={`/analysis/new?mode=analyse&returnTo=${encodeURIComponent(returnToHere() ?? '/')}`}
                  >
                    {text}
                  </OpenLink>
                ),
              })}
            </p>
          ) : null}
          <p className="text-xs text-fg-muted">
            {t('notebook.blockEditor.analysesExecuteAgainstLive')}
          </p>
        </ChartField>

        <ChartField label={t('notebook.blockEditor.chartLabel')}>
          <AnalysisChartPicker
            statistic={selected}
            disabled={!!frozen || readOnly}
            onComposed={(definition) => {
              a.setTouched(true)
              a.setDraft({
                ...draft,
                definitionId: definition.id,
                title: draft.title || definition.name,
              })
            }}
          />
          <p className="text-xs text-fg-muted">
            {t('notebook.blockEditor.oneBlockHoldsA')}
          </p>
        </ChartField>

        <ChartField label={t('notebook.blockEditor.titleLabel')}>
          <Input
            aria-label={t('notebook.blockEditor.analysisTitleAriaLabel')}
            value={draft.title ?? ''}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...draft, title: e.target.value })
            }}
            onBlur={() => a.flush()}
          />
        </ChartField>

        <EvidenceFreezeActions
          frozen={!!frozen}
          hasSpec={!!draft.definitionId && !readOnly}
          ready={validation.length === 0}
          onFreeze={onFreezeAnalysis}
          onUnfreeze={onUnfreezeAnalysis}
          unfreezeLabel={t('notebook.blockEditor.unfreezeLiveAgain')}
          readyTitle={t('notebook.blockEditor.freezeThisAnalysisAsTitle')}
          blockedTitle={t('notebook.blockEditor.chooseASavedAnalysisTitle')}
        />
      </div>

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(block.type, { ...a.serverValue })}
        onUseServer={() => a.discardDraft()}
        onKeepLocal={() => a.retry()}
        retrying={a.status === 'saving'}
      />

      {/* Keep `selected` referenced for the stale-definition hint below. */}
      <span className="sr-only">
        {selected
          ? t('notebook.blockEditor.usingName', { name: selected.name })
          : t('notebook.blockEditor.noSavedAnalysisSelected')}
      </span>
    </div>
  )
}
