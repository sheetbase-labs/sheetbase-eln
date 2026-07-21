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
import type { NotebookBlock } from '#/lib/notebook-data'
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
  const [unitSymbol, setUnitSymbol] = React.useState('')
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
              value={unitSymbol}
              onChange={(e) => setUnitSymbol(e.target.value)}
              placeholder="Symbol (µL)"
              className="h-9 rounded-md border border-input px-2 text-sm"
            />
            <Button
              type="button"
              disabled={
                !(Number(quantity) > 0 && unitCode.trim() && unitSymbol.trim())
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
                        symbol: unitSymbol.trim(),
                      },
                      observedAt: new Date().toISOString(),
                    },
                  ],
                  true,
                )
                setSelected(null)
                setQuantity('')
                setUnitCode('')
                setUnitSymbol('')
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
