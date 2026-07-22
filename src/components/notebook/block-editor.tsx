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
import {
  RichTextContent,
  isRichTextPayload,
  richTextToPlainText,
  validateBlock,
} from '#/lib/blocks'
import type { RichTextPayload } from '#/lib/blocks'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import { Button } from '#/components/ui'
import { RecordPicker } from '#/components/scientific'
import type { RecordPickerResult } from '#/components/scientific'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  scientificRecordQueryKeys,
  searchRecords,
} from '#/lib/scientific-records'
import type { MaterialItem } from '#/lib/protocol-materials'
import { useAutosave } from './use-autosave'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import { SaveStatus } from './save-status'
import { ConflictBanner } from './conflict-banner'
import { RichTextEditor as TiptapRichTextEditor } from './rich-text-editor'
import {
  AttachFileError,
  formatBytes,
  validateFileForUpload,
} from '#/lib/file-attach'
import { FILE_MAX_BYTES } from '#/lib/file-policy'
import { CHART_SPEC_VERSION, CHART_TYPES } from '#/lib/chart-spec'
import type {
  ChartBlockPayload,
  ChartSpec,
  ChartType,
  AxisScale,
} from '#/lib/chart-spec'
import {
  materialiseFrozenChart,
  materialiseLiveChart,
  useLiveChartDataset,
} from '#/lib/chart-data'
import {
  fetchScientificTable,
  scientificDataClient,
  scientificQueryKeys,
} from '#/lib/scientific-sheet-data'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'
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
  /** Transactionally pin a selected protocol and copy its procedure steps. */
  pinProtocol?: (protocolRecordId: string) => Promise<void>
  /** SCI-003: attach an uploaded file to an empty file block. */
  onAttachFile?: (file: File) => Promise<void>
  /** SCI-004: freeze a chart block into an immutable snapshot. */
  onFreezeChart?: () => Promise<void>
  /** SCI-004: remove the frozen snapshot so the chart can be edited again. */
  onUnfreezeChart?: () => Promise<void>
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

  React.useEffect(() => {
    onStatusChange?.(autosave.status)
  }, [autosave.status, onStatusChange])

  return { ...autosave, setTouched }
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
    default:
      return JSON.stringify(payload, null, 2)
  }
}

function ValidationErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <ul
      className="mt-2 space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
      role="alert"
    >
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
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
  serverPreview,
  onUseServer,
  onKeepLocal,
  retrying,
}: {
  status: AutosaveStatus
  error: string | null
  validationErrors: string[]
  serverPreview: string
  onUseServer: () => void
  onKeepLocal: () => void
  retrying: boolean
}) {
  if (status === 'clean') return null
  return (
    <div className="mt-2 space-y-1">
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
        <ValidationErrors errors={validationErrors} />
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
}: BlockEditorProps) {
  const initialDraft = block.payload as unknown as RichTextPayload
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    return <RichTextContent className={className} payload={a.draft} />
  }

  return (
    <div className={cn('space-y-2', className)}>
      <TiptapRichTextEditor
        payload={a.draft}
        autoFocus={autoFocus}
        onChange={(payload) => {
          a.setTouched(true)
          a.setDraft(payload)
        }}
        onBlur={a.flush}
      />
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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
  const initial = block.payload as { items?: ChecklistItem[] }
  const initialDraft: ChecklistDraft = {
    items: Array.isArray(initial.items) ? initial.items : [],
  }
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
          <li key={i} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]',
                item.checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background',
              )}
            >
              {item.checked ? '✓' : ''}
            </span>
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
    <div className={cn('space-y-2', className)}>
      <ul className="space-y-1.5">
        {a.draft.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`check-${block.id}-${i}`}>
              Item {i + 1} checked
            </label>
            <input
              id={`check-${block.id}-${i}`}
              type="checkbox"
              checked={item.checked}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({
                  items: a.draft.items.map((it, idx) =>
                    idx === i ? { ...it, checked: e.target.checked } : it,
                  ),
                })
              }}
              className="mt-1 size-4"
            />
            <label className="sr-only" htmlFor={`check-text-${block.id}-${i}`}>
              Item {i + 1} text
            </label>
            <input
              id={`check-text-${block.id}-${i}`}
              type="text"
              value={item.text}
              autoFocus={autoFocus && i === a.draft.items.length - 1}
              onChange={(e) => update(i, { text: e.target.value })}
              onBlur={() => a.flush()}
              placeholder={`Item ${i + 1}`}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => remove(i)}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="sm" onClick={add}>
        + Add item
      </Button>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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

const TARGET_KINDS = ['experiment', 'protocol_template', 'report'] as const

interface LinkedRecordDraft {
  targetKind: string
  targetIdentifier: string
  linkType: string
  label: string
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
  const initial = block.payload as {
    targetKind?: string
    targetIdentifier?: string
    linkType?: string
    label?: string
  }
  const initialDraft: LinkedRecordDraft = {
    targetKind: initial.targetKind ?? 'experiment',
    targetIdentifier: initial.targetIdentifier ?? '',
    linkType: initial.linkType ?? 'general',
    label: initial.label ?? '',
  }
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs',
          className,
        )}
      >
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {a.draft.linkType}
        </span>
        <span className="font-medium text-foreground">
          {a.draft.targetKind} {a.draft.targetIdentifier || '—'}
        </span>
        {a.draft.label ? (
          <span className="text-muted-foreground">— {a.draft.label}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Target kind" htmlFor={`lr-kind-${block.id}`}>
          <select
            id={`lr-kind-${block.id}`}
            value={a.draft.targetKind}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, targetKind: e.target.value })
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Identifier" htmlFor={`lr-id-${block.id}`}>
          <input
            id={`lr-id-${block.id}`}
            type="text"
            value={a.draft.targetIdentifier}
            autoFocus={autoFocus}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, targetIdentifier: e.target.value })
            }}
            onBlur={() => a.flush()}
            placeholder="EXP-2025-0001"
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
          />
        </Field>
        <Field label="Link type" htmlFor={`lr-link-${block.id}`}>
          <select
            id={`lr-link-${block.id}`}
            value={a.draft.linkType}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, linkType: e.target.value })
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {LINK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" htmlFor={`lr-label-${block.id}`}>
          <input
            id={`lr-label-${block.id}`}
            type="text"
            value={a.draft.label}
            onChange={(e) => {
              a.setTouched(true)
              a.setDraft({ ...a.draft, label: e.target.value })
            }}
            onBlur={() => a.flush()}
            placeholder="Optional"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </Field>
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
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
    return (
      <div className="space-y-1">
        <p className="font-medium">{String(block.payload.protocolTitle)}</p>
        <p className="text-xs text-muted-foreground">
          {String(block.payload.protocolIdentifier)} · Version{' '}
          {String(block.payload.version)} ·{' '}
          {String(block.payload.approvalStatus)}
        </p>
        <p className="text-xs text-muted-foreground">
          Pinned {new Date(String(block.payload.pinnedAt)).toLocaleString()}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-md border">
      <p className="px-3 pt-3 text-sm font-medium">Select a protocol version</p>
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
        <p role="alert" className="px-3 pb-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ProcedureStepEditor(props: BlockEditorProps) {
  const { block } = props
  const payload = block.payload
  if (typeof payload.completed !== 'boolean') {
    return <UnsupportedEditor block={block} className={props.className} />
  }
  const initial = {
    ...payload,
    completed: payload.completed,
    note: typeof payload.note === 'string' ? payload.note : '',
  }
  const a = useBlockAutosave(
    block,
    initial,
    props.save,
    props.offline,
    props.onStatusChange,
  )
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={a.draft.completed}
          disabled={props.readOnly}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, completed: event.target.checked })
          }}
          onBlur={() => a.flush()}
          className="mt-1 size-4 rounded border-input"
        />
        <span>
          <span className="block text-xs font-medium text-muted-foreground">
            Step {String(payload.stepNumber ?? '')}
          </span>
          <span className="block text-sm">{String(payload.text)}</span>
        </span>
      </label>
      <Field label="Execution note" htmlFor={`step-note-${block.id}`}>
        <textarea
          id={`step-note-${block.id}`}
          value={String(a.draft.note)}
          disabled={props.readOnly}
          onChange={(event) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, note: event.target.value })
          }}
          onBlur={() => a.flush()}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </Field>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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
  const initialItems = Array.isArray(block.payload.items)
    ? (block.payload.items as MaterialItem[])
    : []
  const a = useBlockAutosave(
    block,
    { items: initialItems },
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
        <div className="space-y-3">
          {a.draft.items.map((item, index) => (
            <div
              key={item.id}
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_7rem_7rem_auto]"
            >
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.identifier}
                </p>
              </div>
              <input
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
                className="h-9 rounded-md border border-input px-2 text-sm"
              />
              <input
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
                className="h-9 rounded-md border border-input px-2 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateItems(
                    a.draft.items.filter((x) => x.id !== item.id),
                    true,
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex gap-2">
          {(['sample', 'reagent'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={kind === value ? 'secondary' : 'ghost'}
              onClick={() => {
                setKind(value)
                setSelected(null)
              }}
            >
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
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label="Material quantity"
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Quantity"
              className="h-9 rounded-md border border-input px-2 text-sm"
            />
            <input
              aria-label="Canonical unit code"
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              placeholder="Unit code (uL)"
              className="h-9 rounded-md border border-input px-2 text-sm"
            />
            <input
              aria-label="Unit symbol"
              value={materialUnitSymbol}
              onChange={(e) => setMaterialUnitSymbol(e.target.value)}
              placeholder="Symbol (µL)"
              className="h-9 rounded-md border border-input px-2 text-sm"
            />
            <Button
              type="button"
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
              Add material
            </Button>
          </div>
        ) : null}
      </div>
      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
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
    const name = String(block.payload.displayName ?? 'File')
    const mediaType = String(block.payload.mediaType ?? '')
    const byteSize = Number(block.payload.byteSize ?? 0)
    return (
      <div className="space-y-1">
        <p className="font-medium">{name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {mediaType || 'unknown'} · {formatBytes(byteSize)}
        </p>
        <p className="text-xs text-muted-foreground">
          File attached. Download and lifecycle are available in the preview and
          inspector.
        </p>
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
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Attach a file</p>
      <p className="text-xs text-muted-foreground">
        Allowed: CSV, text, JSON, PDF, common images and Office formats. Limit{' '}
        {formatBytes(FILE_MAX_BYTES)}. The filename is display metadata only.
      </p>
      <input
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
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
      />
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
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

  // Available datasets: scientific tables in the workspace the user can read.
  const tablesQuery = useQuery({
    queryKey: ['chart-available-tables'] as const,
    queryFn: () =>
      scientificDataClient.list<Pick<ScientificTableWire, 'id' | 'name'>>(
        'scientific_tables',
        '?select=id,name&lifecycle=eq.active&order=name.asc',
      ),
    staleTime: 30_000,
  })

  // Columns for the selected dataset (so field mappings are honest).
  const selectedTableId = spec?.datasets[0]?.tableId ?? ''
  const columnsQuery = useQuery({
    queryKey: scientificQueryKeys.table(selectedTableId),
    queryFn: () => fetchScientificTable(scientificDataClient, selectedTableId),
    enabled: Boolean(selectedTableId),
    staleTime: 10_000,
  })
  const columns = columnsQuery.data?.columns ?? []

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

  // Start a spec when the user picks a dataset for an empty draft.
  function chooseDataset(tableId: string) {
    a.setTouched(true)
    const col = columnsQuery.data?.columns ?? []
    const xCol = col.length > 0 ? col[0] : null
    const yCol = col.length > 1 ? col[1] : col.length > 0 ? col[0] : null
    const next: ChartSpec = {
      specVersion: CHART_SPEC_VERSION,
      type: spec?.type ?? 'line',
      datasets: [{ tableId }],
      fields: {
        x: xCol ? { columnId: xCol.id, fieldName: xCol.field_name } : null,
        y: yCol
          ? { columnId: yCol.id, fieldName: yCol.field_name }
          : { columnId: '', fieldName: '' },
        series: null,
        color: null,
        size: null,
      },
      filters: [],
      transformations: [],
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
    <option key={c.id} value={`${c.id}|${c.field_name}`}>
      {c.label}
    </option>
  ))

  // Live preview materialisation.
  const { datasetQuery, calcQuery } = useLiveChartDataset(spec)
  const previewMaterialised = frozen
    ? materialiseFrozenChart(frozen)
    : spec
      ? materialiseLiveChart(
          spec,
          datasetQuery.data ?? null,
          calcQuery.data ?? null,
        )
      : {
          state: { kind: 'missing_dataset' as const },
          columns: [],
          rows: [],
          series: [],
          xLabel: 'x',
          yLabel: 'y',
          xUnit: undefined,
          yUnit: undefined,
        }
  const previewLoading =
    !frozen && (datasetQuery.isLoading || calcQuery.isLoading)

  return (
    <div className="space-y-4">
      <ChartRenderer
        title={draft.title || 'Untitled chart'}
        provenance={draft.provenance}
        spec={spec}
        materialised={previewMaterialised}
        frozen={frozen}
        loading={previewLoading}
      />

      {readOnly ? null : (
        <div className="space-y-4 rounded-md border p-3">
          <ChartField label="Title">
            <input
              aria-label="Chart title"
              value={draft.title ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, title: e.target.value })
              }}
              onBlur={() => a.flush()}
              className="h-9 w-full rounded-md border border-input px-2 text-sm"
            />
          </ChartField>

          <ChartField label="Dataset">
            <select
              aria-label="Dataset"
              value={selectedTableId}
              onChange={(e) => chooseDataset(e.target.value)}
              onBlur={() => a.flush()}
              disabled={!!frozen || tablesQuery.isLoading}
              className="h-9 w-full rounded-md border border-input px-2 text-sm"
            >
              <option value="">
                {tablesQuery.isLoading
                  ? 'Loading datasets…'
                  : 'Select a dataset'}
              </option>
              {tablesQuery.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </ChartField>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartField label="Chart type">
              <select
                aria-label="Chart type"
                value={spec?.type ?? 'line'}
                onChange={(e) =>
                  updateSpec({ type: e.target.value as ChartType })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </ChartField>
            <ChartField label="Series field (optional)">
              <select
                aria-label="Series field"
                value={bindingValue(spec?.fields.series)}
                onChange={(e) =>
                  updateFields({ series: parseBinding(e.target.value) })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                <option value="">(none)</option>
                {fieldOptions}
              </select>
            </ChartField>
            <ChartField label="X field">
              <select
                aria-label="X field"
                value={bindingValue(spec?.fields.x)}
                onChange={(e) =>
                  updateFields({ x: parseBinding(e.target.value) })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                <option value="">(none)</option>
                {fieldOptions}
              </select>
            </ChartField>
            <ChartField label="Y field">
              <select
                aria-label="Y field"
                value={bindingValue(spec?.fields.y)}
                onChange={(e) =>
                  updateFields({
                    y: parseBinding(e.target.value) as {
                      columnId: string
                      fieldName: string
                    },
                  })
                }
                onBlur={() => a.flush()}
                disabled={!!frozen || !spec}
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                <option value="">(none)</option>
                {fieldOptions}
              </select>
            </ChartField>
            <ChartField label="X axis scale">
              <select
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
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                {AXIS_SCALES_EDITOR.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </ChartField>
            <ChartField label="Y axis scale">
              <select
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
                className="h-9 w-full rounded-md border border-input px-2 text-sm"
              >
                {AXIS_SCALES_EDITOR.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </ChartField>
          </div>

          <ChartField label="Provenance note (optional)">
            <input
              aria-label="Provenance note"
              value={draft.provenance ?? ''}
              onChange={(e) => {
                a.setTouched(true)
                a.setDraft({ ...draft, provenance: e.target.value })
              }}
              onBlur={() => a.flush()}
              className="h-9 w-full rounded-md border border-input px-2 text-sm"
            />
          </ChartField>

          <div className="flex flex-wrap gap-2">
            {frozen ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-3 py-1.5 text-xs">
                  Frozen snapshot — immutable
                </span>
                {onUnfreezeChart ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onUnfreezeChart()}
                  >
                    Unfreeze (edit live again)
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
                Freeze snapshot
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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

function bindingValue(
  binding: { columnId: string; fieldName: string } | null | undefined,
): string {
  return binding ? `${binding.columnId}|${binding.fieldName}` : ''
}

function parseBinding(
  v: string,
): { columnId: string; fieldName: string } | null {
  if (!v) return null
  const [columnId, fieldName] = v.split('|')
  if (!columnId || !fieldName) return null
  return { columnId, fieldName }
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
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Title</span>
        <input
          type="text"
          value={draft.title ?? ''}
          onChange={(e) => updateDraft({ title: e.target.value })}
          placeholder="e.g. qPCR titration plate"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </label>

      {/* Format info */}
      {spec ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
            96-well (8×12)
          </span>
          <span>{spec.wells.length} wells assigned</span>
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
          <div className="space-y-3 rounded-md border p-3">
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
          </div>
        </div>
      ) : null}

      <AutosaveFooter
        status={a.status}
        error={a.error}
        validationErrors={a.validationErrors}
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
          <button
            type="button"
            onClick={onRemoveWell}
            className="text-xs text-destructive hover:underline"
          >
            Remove
          </button>
        ) : null}
      </div>

      {/* Role selector */}
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Role</span>
        <select
          value={role}
          onChange={(e) => onAssignRole(e.target.value as AssignmentRole)}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          {ASSIGNMENT_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_STYLES[r].label}
            </option>
          ))}
        </select>
      </label>

      {/* Sample link (for sample and control roles) */}
      {role !== 'empty' && role !== 'blank' ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Sample
          </span>
          {well?.sampleRef ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {well.sampleRef.identifier}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {well.sampleRef.title}
                  {well.sampleRef.archived ? ' · archived' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClearSample}
                className="shrink-0 text-xs text-destructive hover:underline"
              >
                Clear
              </button>
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
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Replicate
          </span>
          <input
            type="number"
            min={1}
            value={well?.replicate ?? ''}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              onSetReplicate(Number.isFinite(v) && v > 0 ? v : 1)
            }}
            placeholder="e.g. 1"
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
      ) : null}

      {/* Volume */}
      {role !== 'empty' ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Volume
          </span>
          {well?.volume ? (
            <div className="flex items-center gap-2">
              <input
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
                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <input
                type="text"
                value={well.volume.unit}
                onChange={(e) =>
                  onSetVolume(well.volume!.value, e.target.value)
                }
                className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={onClearVolume}
                className="text-xs text-destructive hover:underline"
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="any"
                placeholder="value"
                onChange={(e) =>
                  onSetVolume(parseFloat(e.target.value) || 0, 'µL')
                }
                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted-foreground">µL</span>
            </div>
          )}
        </div>
      ) : null}

      {/* Notes */}
      {role !== 'empty' ? (
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Notes
          </span>
          <textarea
            value={well?.notes ?? ''}
            onChange={(e) => onSetNotes(e.target.value)}
            placeholder="Optional notes"
            rows={2}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
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
    <details className="space-y-2 rounded-md border p-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Validation config
      </summary>
      <div className="space-y-2">
        <div>
          <span className="text-xs text-muted-foreground">Required roles</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {ASSIGNMENT_ROLES.filter((r) => r !== 'empty').map((r) => (
              <label key={r} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={v.requiredRoles?.includes(r) ?? false}
                  onChange={(e) => {
                    const current = v.requiredRoles ?? []
                    const next = e.target.checked
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
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            Vol min
            <input
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
              className="ml-1 w-16 rounded-md border border-input bg-background px-1 py-0.5 text-xs"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Vol max
            <input
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
              className="ml-1 w-16 rounded-md border border-input bg-background px-1 py-0.5 text-xs"
            />
          </label>
          <input
            type="text"
            value={v.volumeUnit ?? ''}
            onChange={(e) =>
              onChange({ ...v, volumeUnit: e.target.value || undefined })
            }
            placeholder="unit"
            className="w-16 rounded-md border border-input bg-background px-1 py-0.5 text-xs"
          />
        </div>
      </div>
    </details>
  )
}
