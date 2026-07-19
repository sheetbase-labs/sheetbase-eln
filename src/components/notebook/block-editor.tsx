/**
 * Editable block content for the four initial block types (ELN-005):
 * heading, rich_text, checklist, linked_record.
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

import { cn } from '#/lib/utils'
import { validateBlock } from '#/lib/blocks'
import type { NotebookBlock } from '#/lib/notebook-data'
import { Button } from '#/components/ui'
import { useAutosave } from './use-autosave'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import { SaveStatus } from './save-status'
import { ConflictBanner } from './conflict-banner'

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
}

export function BlockEditor(props: BlockEditorProps) {
  switch (props.block.type) {
    case 'heading':
      return <HeadingEditor {...props} />
    case 'rich_text':
      return <RichTextEditor {...props} />
    case 'checklist':
      return <ChecklistEditor {...props} />
    case 'linked_record':
      return <LinkedRecordEditor {...props} />
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
    case 'heading':
      return `H${payload.level ?? 2} — ${payload.text ?? '(empty)'}`
    case 'rich_text':
      return String(payload.body ?? '(empty)')
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
// Heading.
// ---------------------------------------------------------------------------

interface HeadingDraft {
  level: number
  text: string
}

function HeadingEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initial = block.payload as { level?: number; text?: string }
  const initialDraft: HeadingDraft = {
    level: typeof initial.level === 'number' ? initial.level : 2,
    text: typeof initial.text === 'string' ? initial.text : '',
  }
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    return (
      <div className={className}>
        <p className="font-display text-lg font-semibold text-foreground">
          {a.draft.text || 'Untitled heading'}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-start gap-2">
        <label className="sr-only" htmlFor={`heading-level-${block.id}`}>
          Level
        </label>
        <select
          id={`heading-level-${block.id}`}
          value={a.draft.level}
          onChange={(e) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, level: Number(e.target.value) })
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {[1, 2, 3, 4, 5, 6].map((lvl) => (
            <option key={lvl} value={lvl}>
              H{lvl}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`heading-text-${block.id}`}>
          Heading text
        </label>
        <input
          id={`heading-text-${block.id}`}
          type="text"
          value={a.draft.text}
          autoFocus={autoFocus}
          onChange={(e) => {
            a.setTouched(true)
            a.setDraft({ ...a.draft, text: e.target.value })
          }}
          onBlur={() => a.flush()}
          placeholder="Heading text"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
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

// ---------------------------------------------------------------------------
// Rich text.
// ---------------------------------------------------------------------------

interface RichTextDraft {
  body: string
}

function RichTextEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initial = block.payload as { body?: string }
  const initialDraft: RichTextDraft = {
    body: typeof initial.body === 'string' ? initial.body : '',
  }
  const a = useBlockAutosave(block, initialDraft, save, offline, onStatusChange)

  if (readOnly) {
    return (
      <div className={className}>
        <p className="whitespace-pre-wrap text-foreground">
          {a.draft.body || 'Empty text block'}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <label className="sr-only" htmlFor={`richtext-${block.id}`}>
        Text content
      </label>
      <textarea
        id={`richtext-${block.id}`}
        value={a.draft.body}
        autoFocus={autoFocus}
        onChange={(e) => {
          a.setTouched(true)
          a.setDraft({ ...a.draft, body: e.target.value })
        }}
        onBlur={() => a.flush()}
        rows={4}
        placeholder="Write the paragraph…"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6"
      />
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
