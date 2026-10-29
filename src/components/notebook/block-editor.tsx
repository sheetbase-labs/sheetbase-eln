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
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { datasetOption } from '#/components/v3/record-picker/entity-options'
import { returnToHere } from '#/lib/return-to'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import { explainBlockValidation } from '#/lib/assist-explain'
import { ExplainPanel } from '#/components/assist/explain-panel'
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
import { datasetPath, recordDestination } from '#/lib/navigation'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Textarea } from '#/components/v3/inventory/list'
import { Select } from '#/components/v3/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  CALLOUT_STYLES,
  CALLOUT_VARIANT_LABELS,
  CALLOUT_VARIANTS,
  calloutVariantOf,
} from './callout-styles'
import type { CalloutVariant } from './callout-styles'
import {
  CONCLUSION_VERDICT_LABELS,
  CONCLUSION_VERDICTS,
  conclusionVerdictOf,
} from '#/lib/conclusion-block'
import type { ConclusionVerdict } from '#/lib/conclusion-block'
import {
  Trash2,
  File as FileIcon,
  Image as ImageIcon,
  Snowflake,
  Pin,
} from 'lucide-react'
import { Icon } from '#/components/icons'
import { RecordPicker } from '#/components/scientific'
import type { RecordPickerResult } from '#/components/scientific'
import {
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { MaterialItem } from '#/lib/protocol-materials'
import { StockWithdrawButton } from '#/components/notebook/stock-withdraw-button'
import { isWithdrawn } from '#/lib/stock-withdraw'
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
import { isPinnedProtocolStep } from '#/lib/protocol-deviations'
import { useUnsyncedBlock } from '#/components/offline/offline-edits'
import { UnsyncedMark } from '#/components/offline/unsynced-changes'
import { ConflictBanner } from './conflict-banner'
import { OpenLink } from './block-preview'
import { RichTextEditor as TiptapRichTextEditor } from './rich-text-editor'
import { validateFileForUpload } from '#/lib/file-attach'
import { formatFileSize } from '#/lib/format-numbers'
import { FILE_MAX_BYTES, isInlinePreviewableImage } from '#/lib/file-policy'
import { CHART_SPEC_VERSION, CHART_TYPES } from '#/lib/chart-spec'
import type { AnalysisBlockPayload } from '#/lib/analysis-block'
import { validateAnalysisBlockPayload } from '#/lib/analysis-block'
import { PipelineOutputBlockEditor } from './pipeline-output-block-editor'
import { DatasetImportBlockEditor } from './dataset-import-block'
import { AnalysisChartPicker } from './analysis-chart-picker'
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
  /** Insert a new block without replacing this block's evidence. */
  onInsertBelow?: (type: string) => void
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
  // EXP-05.2: a block with a local draft carries a marker where it renders.
  const unsynced = useUnsyncedBlock(props.block.id)
  return (
    <>
      {unsynced ? <UnsyncedMark /> : null}
      <BlockEditorBody {...props} />
    </>
  )
}

function BlockEditorBody(props: BlockEditorProps) {
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
    case 'callout':
      return <CalloutEditor {...props} />
    case 'conclusion':
      return <ConclusionEditor {...props} />
    case 'metric':
      return <MetricEditor {...props} />
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
    case 'dataset_import':
      return <DatasetImportBlockEditor {...props} />
    case 'plate_map':
      return <PlateMapBlockEditor {...props} />
    case 'signature_request':
      return <SignatureRequestEditor {...props} />
    case 'corrective_actions':
      return <CorrectiveActionsEditor {...props} />
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
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
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
              <ExplainPanel explanation={explanation} />
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
        caretHint={caretHint}
        placeholder={placeholder}
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
  const initialDraft = React.useMemo<SignatureRequestPayload>(() => {
    const p = props.block.payload as Partial<SignatureRequestPayload>
    return {
      requestedUserId:
        typeof p.requestedUserId === 'string' ? p.requestedUserId : null,
      requestedUserName:
        typeof p.requestedUserName === 'string' ? p.requestedUserName : null,
      meaning: SIGNATURE_REQUEST_MEANINGS.includes(
        p.meaning as SignatureRequestPayload['meaning'],
      )
        ? (p.meaning as SignatureRequestPayload['meaning'])
        : 'reviewed',
      note: typeof p.note === 'string' ? p.note : '',
    }
  }, [props.block.payload])
  const a = useBlockAutosave(
    props.block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
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
                meaning: event.target
                  .value as SignatureRequestPayload['meaning'],
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
  const initialDraft = React.useMemo<CorrectiveActionsPayload>(() => {
    const p = props.block.payload as { items?: CorrectiveActionItem[] }
    return { items: Array.isArray(p.items) ? p.items : [] }
  }, [props.block.payload])
  const a = useBlockAutosave(
    props.block,
    initialDraft,
    props.save,
    props.offline,
    props.onStatusChange,
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
                    status: event.target
                      .value as CorrectiveActionItem['status'],
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
                <Trash2 />
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

interface CalloutDraft {
  text: string
  variant: CalloutVariant
}

function CalloutEditor({
  block,
  save,
  offline,
  onStatusChange,
  className,
  autoFocus,
}: BlockEditorProps) {
  const initialDraft = React.useMemo<CalloutDraft>(() => {
    const payload = block.payload as { text?: unknown; variant?: unknown }
    return {
      text: typeof payload.text === 'string' ? payload.text : '',
      variant: calloutVariantOf(payload.variant),
    }
  }, [block.payload])
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)
  const styles = CALLOUT_STYLES[a.draft.variant] ?? CALLOUT_STYLES.info

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
        serverPreview={summarizeBlockPayload(
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

interface ConclusionDraft {
  text: string
  verdict: ConclusionVerdict
  basis: string
}

function ConclusionEditor({
  block,
  save,
  offline,
  onStatusChange,
  className,
  autoFocus,
}: BlockEditorProps) {
  const initialDraft = React.useMemo<ConclusionDraft>(() => {
    const payload = block.payload as {
      text?: unknown
      verdict?: unknown
      basis?: unknown
    }
    return {
      text: typeof payload.text === 'string' ? payload.text : '',
      verdict: conclusionVerdictOf(payload.verdict),
      basis: typeof payload.basis === 'string' ? payload.basis : '',
    }
  }, [block.payload])
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

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
        serverPreview={summarizeBlockPayload(
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

interface MetricDraft {
  label: string
  /** Exactly what the user typed. Converting while typing would eat a decimal
   * point or a space, because the converted value is written straight back
   * into the controlled field. */
  value: string
  unit: string
  provenance: string
}

/** A numeric reading is written back as a number so number formatting applies;
 * anything else stays text. A blank reading stays blank. */
function metricValueFromInput(raw: string): string | number {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : trimmed
}

/** The canonical payload for a metric draft: an optional field is omitted when
 * blank rather than saved as an empty string. The draft arrives as the payload
 * carrier the autosave hook passes around, so each field is narrowed. */
function metricPayloadFromDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const label = typeof draft.label === 'string' ? draft.label : ''
  const value = typeof draft.value === 'string' ? draft.value : ''
  const unit = typeof draft.unit === 'string' ? draft.unit : ''
  const provenance =
    typeof draft.provenance === 'string' ? draft.provenance : ''
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
  const initialDraft = React.useMemo<MetricDraft>(() => {
    const payload = block.payload as {
      label?: unknown
      value?: unknown
      unit?: unknown
      provenance?: unknown
    }
    return {
      label: typeof payload.label === 'string' ? payload.label : '',
      // The stored reading may be a number or text; the field holds its text.
      value:
        typeof payload.value === 'number' || typeof payload.value === 'string'
          ? String(payload.value)
          : '',
      unit: typeof payload.unit === 'string' ? payload.unit : '',
      provenance:
        typeof payload.provenance === 'string' ? payload.provenance : '',
    }
  }, [block.payload])
  // The draft is the raw input; the payload is built from it at the boundary,
  // so the autosave state machine and the conflict summary both see the
  // canonical shape.
  const saveDraft = React.useCallback(
    async (payload: Record<string, unknown>) =>
      save(metricPayloadFromDraft(payload)),
    [save],
  )
  const a = useBlockAutosave(
    block,
    initialDraft,
    saveDraft,
    offline,
    onStatusChange,
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
          (a.serverValue ?? {}) as Record<string, unknown>,
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
          <li className="text-sm text-fg-muted">
            {t('notebook.blockEditor.noChecklistItems')}
          </li>
        ) : null}
        {a.draft.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm">
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
        {a.draft.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <label className="sr-only" htmlFor={`check-${block.id}-${i}`}>
              {t('notebook.blockEditor.itemIChecked', { i: i + 1 })}
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
              {t('notebook.blockEditor.itemIText', { i: i + 1 })}
            </label>
            <Input
              id={`check-text-${block.id}-${i}`}
              type="text"
              value={item.text}
              autoFocus={autoFocus && i === a.draft.items.length - 1}
              onChange={(e) => update(i, { text: e.target.value })}
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
              onClick={() => remove(i)}
            >
              <Trash2 />
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
        serverPreview={summarizeBlockPayload(
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
        <Badge variant="kind" className="uppercase">
          <Icon name="link" className="size-3" />
          {a.draft.linkType}
        </Badge>
        <span className="font-medium text-fg">
          {a.draft.targetKind}{' '}
          <span className="font-mono">{a.draft.targetIdentifier || '—'}</span>
        </span>
        {a.draft.label ? (
          <span className="text-fg-muted">— {a.draft.label}</span>
        ) : null}
        {openTo ? (
          <OpenLink to={openTo}>{t('common.actions.open')}</OpenLink>
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
        serverPreview={summarizeBlockPayload(
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
          <Pin className="size-3" />
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
          <span className="block text-xs font-medium text-fg-muted">
            {t('notebook.blockEditor.step', {
              number: String(payload.stepNumber ?? ''),
            })}
          </span>
          <span
            className={cn(
              'block text-sm',
              a.draft.completed && 'text-fg-muted line-through',
            )}
          >
            {String(payload.text)}
          </span>
        </span>
      </label>
      <Field
        label={t('notebook.blockEditor.executionNoteLabel')}
        htmlFor={`step-note-${block.id}`}
      >
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
                <Trash2 />
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

function FileBlockEditor({ block, onAttachFile, readOnly }: BlockEditorProps) {
  const attached = Object.keys(block.payload).length > 0

  if (attached) {
    // The preview renders the live file state; the editor just confirms it.
    // No Card/border here so the edit transition doesn't add a box around
    // content that reads as a seamless line in the document flow.
    const name = String(
      block.payload.displayName ?? t('notebook.blockEditor.file'),
    )
    const mediaType = String(block.payload.mediaType ?? '')
    const byteSize = Number(block.payload.byteSize ?? 0)
    const fileRecordId = String(block.payload.fileRecordId ?? '')
    const fileGlyph = fileGlyphFor(mediaType)
    const showImage =
      Boolean(fileRecordId) && isInlinePreviewableImage(mediaType)
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
          <Badge variant="add" className="ml-auto shrink-0">
            {t('notebook.blockEditor.attached')}
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

/** Pick a file glyph from the media type. */
function fileGlyphFor(mediaType: string) {
  if (mediaType.startsWith('image/')) return <ImageIcon className="size-4" />
  if (
    mediaType.includes('spreadsheet') ||
    mediaType.includes('csv') ||
    mediaType.includes('excel')
  )
    return <Icon name="table" className="size-4" />
  if (mediaType.startsWith('text/') || mediaType === 'application/json')
    return <Icon name="protocol" className="size-4" />
  return <FileIcon className="size-4" />
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

          <ChartField label="Dataset">
            <PickerSelect
              noun="dataset"
              aria-label="Dataset"
              value={selectedDatasetId}
              onChange={(id) => {
                chooseDataset(id)
                // Save once the choice has rendered; a picker has no blur.
                setTimeout(() => a.flush(), 0)
              }}
              disabled={!!frozen || datasetsQuery.isLoading}
              placeholder={
                datasetsQuery.isLoading
                  ? 'Loading datasets…'
                  : 'Select a dataset'
              }
              options={availableDatasets.map((d) =>
                datasetOption({ id: d.datasetId, name: d.name }),
              )}
            />
            <p className="text-xs text-fg-muted">Charts plot Dataset data.</p>
          </ChartField>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartField label={t('notebook.blockEditor.chartTypeLabel')}>
              <Select
                aria-label={t('notebook.blockEditor.chartTypeLabel')}
                value={spec?.type ?? 'line'}
                onChange={(e) => setChartType(e.target.value as ChartType)}
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
            <ChartField
              label={t('notebook.blockEditor.seriesFieldOptionalLabel')}
            >
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
                  onBlur={() => a.flush()}
                  disabled={!!frozen || !spec}
                >
                  <option value="">{t('notebook.blockEditor.none')}</option>
                  {fieldOptions}
                </Select>
              )}
            </ChartField>
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
            <ChartField label={t('notebook.blockEditor.xAxisScaleLabel')}>
              <Select
                aria-label={t('notebook.blockEditor.xAxisScaleLabel')}
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
            <ChartField label={t('notebook.blockEditor.yAxisScaleLabel')}>
              <Select
                aria-label={t('notebook.blockEditor.yAxisScaleLabel')}
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
            <ChartField label={t('notebook.blockEditor.binsLabel')}>
              <Input
                aria-label={t(
                  'notebook.blockEditor.histogramBinCountAriaLabel',
                )}
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
            <ChartField label={t('notebook.blockEditor.cellValueLabel')}>
              <Select
                aria-label={t(
                  'notebook.blockEditor.heatmapCellAggregationAriaLabel',
                )}
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
                <option value="count">
                  {t('notebook.blockEditor.rowCount')}
                </option>
                <option value="mean">
                  {t('notebook.blockEditor.meanOfY')}
                </option>
                <option value="median">
                  {t('notebook.blockEditor.medianOfY')}
                </option>
                <option value="min">{t('notebook.blockEditor.minOfY')}</option>
                <option value="max">{t('notebook.blockEditor.maxOfY')}</option>
              </Select>
            </ChartField>
          ) : null}

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

          <div className="flex flex-wrap items-center gap-2">
            {frozen ? (
              <>
                <Badge variant="chg">
                  <Snowflake className="size-3" />
                  {t('notebook.blockEditor.frozenSnapshotImmutable')}
                </Badge>
                {onUnfreezeChart ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void onUnfreezeChart()}
                  >
                    <Icon name="edit" />{' '}
                    {t('notebook.blockEditor.unfreezeEditLiveAgain')}
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
                    ? t('notebook.blockEditor.resolveChartStateBeforeTitle')
                    : t('notebook.blockEditor.freezeTheDatasetAsTitle')
                }
              >
                <Snowflake /> {t('notebook.blockEditor.freezeSnapshot')}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(
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
        serverPreview={summarizeBlockPayload(
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
            <Trash2 /> {t('common.actions.remove')}
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
          <label className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.sample')}
          </label>
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
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={onClearSample}
                className="shrink-0 text-danger-text"
              >
                {t('common.actions.clear')}
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
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.volume')}
          </label>
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
                variant="quiet"
                size="sm"
                onClick={onClearVolume}
                className="text-danger-text"
              >
                {t('common.actions.clear')}
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
              <span className="text-xs text-fg-muted">µL</span>
            </div>
          )}
        </div>
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
      <summary className="cursor-pointer text-xs font-medium text-fg-muted">
        {t('notebook.blockEditor.validationConfig')}
      </summary>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('notebook.blockEditor.requiredRoles')}
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ASSIGNMENT_ROLES.filter((r) => r !== 'empty').map((r) => (
              <label
                key={r}
                className="flex items-center gap-1.5 text-xs text-fg"
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
function analysisContents(definition: unknown): string {
  if (typeof definition !== 'object' || definition === null) return ''
  const body = definition as { kind?: unknown; chart?: unknown }
  if (body.kind === 'chart') return t('notebook.blockEditor.chart')
  return body.chart ? t('notebook.blockEditor.statisticAndChart') : ''
}

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
    const name =
      typeof saved.name === 'string'
        ? saved.name
        : t('notebook.blockEditor.analysis')
    a.setDraft({
      ...draft,
      definitionId: id,
      title: draft.title || name,
    })
  }

  const validation = validateAnalysisBlockPayload(draft)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface space-y-3 p-3">
        <ChartField label="Saved analysis">
          <PickerSelect
            noun="analysis"
            aria-label="Saved analysis"
            value={draft.definitionId ?? ''}
            onChange={(id) => {
              chooseDefinition(id)
              setTimeout(() => a.flush(), 0)
            }}
            disabled={!!frozen || definitionsQuery.isLoading}
            placeholder={
              definitionsQuery.isLoading
                ? 'Loading saved analyses…'
                : definitions.length === 0
                  ? 'No saved analyses'
                  : 'Select an analysis'
            }
            options={definitions.map((d) => ({
              id: d.id,
              label: d.name,
              detail: `Version ${d.version}${analysisContents(d.definition)}`,
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

        <div className="flex flex-wrap items-center gap-2">
          {frozen ? (
            <>
              <Badge variant="chg">
                <Snowflake className="size-3" />
                {t('notebook.blockEditor.frozenSnapshotImmutable')}
              </Badge>
              {onUnfreezeAnalysis ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void onUnfreezeAnalysis()}
                >
                  <Icon name="edit" />{' '}
                  {t('notebook.blockEditor.unfreezeLiveAgain')}
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
                  ? t('notebook.blockEditor.chooseASavedAnalysisTitle')
                  : t('notebook.blockEditor.freezeThisAnalysisAsTitle')
              }
              onClick={() => void onFreezeAnalysis()}
            >
              <Snowflake /> {t('notebook.blockEditor.freezeSnapshot')}
            </Button>
          ) : null}
        </div>
      </div>

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
        explainBlock={{ blockType: block.type, errors: a.structuredErrors }}
        serverPreview={summarizeBlockPayload(
          block.type,
          (a.serverValue ?? {}) as Record<string, unknown>,
        )}
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
