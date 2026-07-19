import * as React from 'react'

import { cn } from '#/lib/utils'
import { validateBlock } from '#/lib/blocks'
import type { BlockValidationResult } from '#/lib/blocks'
import type { NotebookBlock } from '#/lib/notebook-data'
import { Button } from '#/components/ui'

/**
 * Editable block content for the four initial block types (ELN-005):
 * heading, rich_text, checklist, linked_record.
 *
 * Editing model — draft state is local component state, never stored as
 * scientific content. A save fires on blur (commit) or an explicit Save
 * action. Validation runs against `src/lib/blocks` before the save callback
 * fires; invalid drafts surface inline errors and never call onSave. The
 * parent owns the mutation (RPC call, optimistic version, invalidation).
 *
 * `readOnly` disables editing (archived notebooks, etc.).
 */

export interface BlockEditorProps {
  block: NotebookBlock
  /** Commit the (validated) payload. Parent performs the RPC. */
  onSave: (payload: Record<string, unknown>) => void
  /** True while the parent's mutation is in flight. */
  saving?: boolean
  /** Server-side error message to surface (e.g. stale_version). */
  serverError?: string | null
  readOnly?: boolean
  /** Autofocus the primary field on mount (used for newly-inserted blocks). */
  autoFocus?: boolean
  className?: string
}

export function BlockEditor({
  block,
  onSave,
  saving,
  serverError,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  switch (block.type) {
    case 'heading':
      return (
        <HeadingEditor
          block={block}
          onSave={onSave}
          saving={saving}
          serverError={serverError}
          readOnly={readOnly}
          autoFocus={autoFocus}
          className={className}
        />
      )
    case 'rich_text':
      return (
        <RichTextEditor
          block={block}
          onSave={onSave}
          saving={saving}
          serverError={serverError}
          readOnly={readOnly}
          autoFocus={autoFocus}
          className={className}
        />
      )
    case 'checklist':
      return (
        <ChecklistEditor
          block={block}
          onSave={onSave}
          saving={saving}
          serverError={serverError}
          readOnly={readOnly}
          autoFocus={autoFocus}
          className={className}
        />
      )
    case 'linked_record':
      return (
        <LinkedRecordEditor
          block={block}
          onSave={onSave}
          saving={saving}
          serverError={serverError}
          readOnly={readOnly}
          autoFocus={autoFocus}
          className={className}
        />
      )
    default:
      return (
        <UnsupportedEditor
          block={block}
          serverError={serverError}
          className={className}
        />
      )
  }
}

// ---------------------------------------------------------------------------
// Shared validation + draft helpers.
// ---------------------------------------------------------------------------

function useDraft<T>(initial: T) {
  const [draft, setDraft] = React.useState<T>(initial)
  const [touched, setTouched] = React.useState(false)
  // `initial` is constructed inline at each render, so its identity changes
  // every render. Reset the draft only when the serialised value actually
  // changes (e.g. the server returns a new payload), not on every render,
  // otherwise the effect loops forever.
  const serialized = JSON.stringify(initial)
  const lastSerialized = React.useRef(serialized)
  React.useEffect(() => {
    if (lastSerialized.current !== serialized) {
      lastSerialized.current = serialized
      setDraft(initial)
    }
  }, [serialized, initial])
  return { draft, setDraft, touched, setTouched }
}

function ValidationError({
  result,
  serverError,
}: {
  result: BlockValidationResult
  serverError?: string | null
}) {
  const errors = result.errors
  if (errors.length === 0 && !serverError) return null
  return (
    <ul
      role="alert"
      className="mt-2 space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
    >
      {serverError ? <li className="font-medium">{serverError}</li> : null}
      {errors.map((e, i) => (
        <li key={i}>
          {e.field ? <span className="font-mono">{e.field}: </span> : null}
          {e.message}
        </li>
      ))}
    </ul>
  )
}

function SaveBar({
  saving,
  onSave,
  onCancel,
  canSave,
}: {
  saving?: boolean
  onSave: () => void
  onCancel: () => void
  canSave: boolean
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={!canSave || saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Heading.
// ---------------------------------------------------------------------------

function HeadingEditor({
  block,
  onSave,
  saving,
  serverError,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initial = block.payload as { level?: number; text?: string }
  const { draft, setDraft, touched, setTouched } = useDraft({
    level: typeof initial.level === 'number' ? initial.level : 2,
    text: typeof initial.text === 'string' ? initial.text : '',
  })

  const result = validateBlock({
    type: block.type,
    payload: draft,
    payloadSchemaVersion: block.payloadSchemaVersion,
  })
  const showErrors = touched && !result.ok

  if (readOnly) {
    return (
      <div className={className}>
        <p className="font-display text-lg font-semibold text-foreground">
          {draft.text || 'Untitled heading'}
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
          value={draft.level}
          onChange={(e) =>
            setDraft({ ...draft, level: Number(e.target.value) })
          }
          disabled={saving}
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
          value={draft.text}
          autoFocus={autoFocus}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onBlur={() => {
            setTouched(true)
            if (result.ok) onSave(draft)
          }}
          disabled={saving}
          placeholder="Heading text"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          aria-invalid={showErrors}
        />
      </div>
      {showErrors || serverError ? (
        <ValidationError result={result} serverError={serverError} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rich text.
// ---------------------------------------------------------------------------

function RichTextEditor({
  block,
  onSave,
  saving,
  serverError,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initial = block.payload as { body?: string }
  const { draft, setDraft, touched, setTouched } = useDraft({
    body: typeof initial.body === 'string' ? initial.body : '',
  })
  const result = validateBlock({
    type: block.type,
    payload: draft,
    payloadSchemaVersion: block.payloadSchemaVersion,
  })
  const showErrors = touched && !result.ok

  if (readOnly) {
    return (
      <div className={className}>
        <p className="whitespace-pre-wrap text-foreground">
          {draft.body || 'Empty text block'}
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
        value={draft.body}
        autoFocus={autoFocus}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        onBlur={() => {
          setTouched(true)
          if (result.ok) onSave(draft)
        }}
        disabled={saving}
        rows={4}
        placeholder="Write the paragraph…"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6"
        aria-invalid={showErrors}
      />
      {showErrors || serverError ? (
        <ValidationError result={result} serverError={serverError} />
      ) : null}
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

function ChecklistEditor({
  block,
  onSave,
  saving,
  serverError,
  readOnly,
  autoFocus,
  className,
}: BlockEditorProps) {
  const initial = block.payload as { items?: ChecklistItem[] }
  const { draft, setDraft, touched, setTouched } = useDraft<{
    items: ChecklistItem[]
  }>({
    items: Array.isArray(initial.items) ? initial.items : [],
  })

  const result = validateBlock({
    type: block.type,
    payload: draft,
    payloadSchemaVersion: block.payloadSchemaVersion,
  })
  const showErrors = touched && !result.ok

  function update(i: number, patch: Partial<ChecklistItem>) {
    setDraft({
      items: draft.items.map((item, idx) =>
        idx === i ? { ...item, ...patch } : item,
      ),
    })
  }
  function remove(i: number) {
    setDraft({ items: draft.items.filter((_, idx) => idx !== i) })
  }
  function add() {
    setDraft({ items: [...draft.items, { text: '', checked: false }] })
  }
  /**
   * Commit a specific draft immediately (used by checkbox toggles, which
   * do not go through a blur event). Validates first; invalid drafts are
   * not persisted.
   */
  function commit(next: { items: ChecklistItem[] }) {
    const r = validateBlock({
      type: block.type,
      payload: next,
      payloadSchemaVersion: block.payloadSchemaVersion,
    })
    if (r.ok) onSave(next)
  }

  if (readOnly) {
    return (
      <ul className={cn('space-y-1.5', className)}>
        {draft.items.length === 0 ? (
          <li className="text-sm text-muted-foreground">No checklist items</li>
        ) : null}
        {draft.items.map((item, i) => (
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
        {draft.items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`check-${block.id}-${i}`}>
              Item {i + 1} checked
            </label>
            <input
              id={`check-${block.id}-${i}`}
              type="checkbox"
              checked={item.checked}
              onChange={(e) => {
                const next = {
                  items: draft.items.map((it, idx) =>
                    idx === i ? { ...it, checked: e.target.checked } : it,
                  ),
                }
                setDraft(next)
                commit(next)
              }}
              disabled={saving}
              className="mt-1 size-4"
            />
            <label className="sr-only" htmlFor={`check-text-${block.id}-${i}`}>
              Item {i + 1} text
            </label>
            <input
              id={`check-text-${block.id}-${i}`}
              type="text"
              value={item.text}
              autoFocus={autoFocus && i === draft.items.length - 1}
              onChange={(e) => update(i, { text: e.target.value })}
              onBlur={() => {
                setTouched(true)
                if (result.ok) onSave(draft)
              }}
              disabled={saving}
              placeholder={`Item ${i + 1}`}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove item ${i + 1}`}
              onClick={() => remove(i)}
              disabled={saving}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={add}
        disabled={saving}
      >
        + Add item
      </Button>
      {showErrors || serverError ? (
        <ValidationError result={result} serverError={serverError} />
      ) : null}
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

function LinkedRecordEditor({
  block,
  onSave,
  saving,
  serverError,
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
  const { draft, setDraft, touched, setTouched } = useDraft({
    targetKind: initial.targetKind ?? 'experiment',
    targetIdentifier: initial.targetIdentifier ?? '',
    linkType: initial.linkType ?? 'general',
    label: initial.label ?? '',
  })
  const result = validateBlock({
    type: block.type,
    payload: draft,
    payloadSchemaVersion: block.payloadSchemaVersion,
  })
  const showErrors = touched && !result.ok

  if (readOnly) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs',
          className,
        )}
      >
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {draft.linkType}
        </span>
        <span className="font-medium text-foreground">
          {draft.targetKind} {draft.targetIdentifier || '—'}
        </span>
        {draft.label ? (
          <span className="text-muted-foreground">— {draft.label}</span>
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
            value={draft.targetKind}
            onChange={(e) => setDraft({ ...draft, targetKind: e.target.value })}
            disabled={saving}
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
            value={draft.targetIdentifier}
            autoFocus={autoFocus}
            onChange={(e) =>
              setDraft({ ...draft, targetIdentifier: e.target.value })
            }
            disabled={saving}
            placeholder="EXP-2025-0001"
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
          />
        </Field>
        <Field label="Link type" htmlFor={`lr-link-${block.id}`}>
          <select
            id={`lr-link-${block.id}`}
            value={draft.linkType}
            onChange={(e) => setDraft({ ...draft, linkType: e.target.value })}
            disabled={saving}
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
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            disabled={saving}
            placeholder="Optional"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </Field>
      </div>
      <SaveBar
        saving={saving}
        canSave={result.ok}
        onSave={() => {
          setTouched(true)
          if (result.ok) onSave(draft)
        }}
        onCancel={() => {
          setTouched(false)
          setDraft({
            targetKind: initial.targetKind ?? 'experiment',
            targetIdentifier: initial.targetIdentifier ?? '',
            linkType: initial.linkType ?? 'general',
            label: initial.label ?? '',
          })
        }}
      />
      {showErrors || serverError ? (
        <ValidationError result={result} serverError={serverError} />
      ) : null}
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
  serverError,
  className,
}: {
  block: NotebookBlock
  serverError?: string | null
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
      {serverError ? (
        <p role="alert" className="text-xs text-destructive">
          {serverError}
        </p>
      ) : null}
    </div>
  )
}
