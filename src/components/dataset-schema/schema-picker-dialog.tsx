/**
 * SCI-010 Phase 3: Schema picker dialog shown when a user inserts a sheet
 * block. Offers three paths (ADR 0034):
 *  1. Select a published workspace schema → instantiate from it.
 *  2. Create a schema on the fly → opens an inline editor; creates a draft,
 *     then optionally publishes + instantiates.
 *  3. Continue ad-hoc → existing behaviour, no binding.
 *
 * The dialog does not own the insert mutation; it calls `onSelect` with the
 * chosen path and the parent performs the RPC.
 *
 * The inline builder uses a dense, table-like field definition interface so
 * it scales to 20+ fields: compact rows, bounded scroll, keyboard-driven
 * rapid entry (Enter adds a row), and a sticky header. It reads like a
 * spreadsheet column-definition sheet, not a stack of SaaS cards.
 */
import * as React from 'react'
import {
  Calendar,
  Clock,
  Database,
  FilePlus,
  Hash,
  Info,
  Layers,
  Link2,
  PencilLine,
  Plus,
  Tag,
  ToggleLeft,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  Input,
  Label,
  Select,
  Separator,
} from '#/components/ui'
import type { ScientificLogicalType } from '#/lib/scientific-sheet-data'
import {
  createDatasetSchema,
  datasetSchemaDataClient,
  fetchPublishedDatasetSchemas,
  publishDatasetSchema,
} from '#/lib/dataset-schema-data'
import type { DatasetSchemaWire } from '#/lib/dataset-schema-data'
import { cn } from '#/lib/utils'

export type SchemaPickerResult =
  | { mode: 'ad-hoc' }
  | { mode: 'published'; schemaId: string }
  | { mode: 'created'; schemaId: string }

/**
 * Types offered in the inline builder. `reference` is excluded because it
 * needs a target schema selection the quick-create flow does not support —
 * scientists add references from the dedicated schema editor.
 */
const BUILDER_TYPES: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

interface TypeMeta {
  label: string
  icon: LucideIcon
  description: string
}

const TYPE_META: Record<ScientificLogicalType, TypeMeta> = {
  text: { label: 'Text', icon: TypeIcon, description: 'Free-form strings' },
  integer: { label: 'Integer', icon: Hash, description: 'Whole numbers' },
  decimal: { label: 'Decimal', icon: Hash, description: 'Numeric measurements' },
  boolean: { label: 'Boolean', icon: ToggleLeft, description: 'True or false' },
  date: { label: 'Date', icon: Calendar, description: 'Calendar dates' },
  timestamp: { label: 'Timestamp', icon: Clock, description: 'Date and time' },
  category: { label: 'Category', icon: Tag, description: 'Fixed option set' },
  reference: {
    label: 'Reference',
    icon: Link2,
    description: 'Link to another schema',
  },
}

const FIELD_PLACEHOLDERS = [
  'replicate',
  'titer',
  'pass_fail',
  'sample_id',
  'concentration',
  'operator',
  'temperature',
  'yield',
]

function placeholderFor(index: number): string {
  return FIELD_PLACEHOLDERS[index % FIELD_PLACEHOLDERS.length]
}

/** Derive a slug from a label: lowercase snake_case, trimmed. */
function deriveSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

interface DraftField {
  slug: string
  label: string
  logical_type: ScientificLogicalType
  /** True once the user manually edits the slug; stops auto-derivation. */
  slugEdited: boolean
  /** Maps to backend `nullable` (required = NOT nullable). Defaults false. */
  required: boolean
}

export interface SchemaPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (result: SchemaPickerResult) => Promise<void>
}

export function SchemaPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: SchemaPickerDialogProps) {
  const [mode, setMode] = React.useState<'choose' | 'published' | 'create'>(
    'choose',
  )
  const [publishedSchemas, setPublishedSchemas] = React.useState<
    DatasetSchemaWire[]
  >([])
  const [selectedSchemaId, setSelectedSchemaId] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Create-on-the-fly form state
  const [schemaName, setSchemaName] = React.useState('')
  const [schemaSlug, setSchemaSlug] = React.useState('')
  const [schemaSlugEdited, setSchemaSlugEdited] = React.useState(false)
  const [fields, setFields] = React.useState<DraftField[]>([])
  const [publishImmediately, setPublishImmediately] = React.useState(false)

  // Reset state when dialog opens.
  React.useEffect(() => {
    if (open) {
      setMode('choose')
      setSelectedSchemaId('')
      setError(null)
      setSchemaName('')
      setSchemaSlug('')
      setSchemaSlugEdited(false)
      setFields([])
      setPublishImmediately(false)
    }
  }, [open])

  // Fetch published schemas when entering "published" mode.
  React.useEffect(() => {
    if (mode === 'published' && publishedSchemas.length === 0) {
      void fetchPublishedDatasetSchemas(datasetSchemaDataClient)
        .then(setPublishedSchemas)
        .catch(() => setError('Could not load published schemas.'))
    }
  }, [mode, publishedSchemas.length])

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        slug: '',
        label: '',
        logical_type: 'text',
        slugEdited: false,
        required: false,
      },
    ])
  }

  function updateFieldLabel(index: number, label: string) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f
        // Auto-derive slug from label until the user edits the slug manually.
        if (!f.slugEdited) {
          return { ...f, label, slug: deriveSlug(label) }
        }
        return { ...f, label }
      }),
    )
  }

  function updateFieldSlug(index: number, slug: string) {
    setFields((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, slug, slugEdited: true } : f,
      ),
    )
  }

  function updateFieldType(index: number, type: ScientificLogicalType) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, logical_type: type } : f)),
    )
  }

  function updateFieldRequired(index: number, required: boolean) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, required } : f)),
    )
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleConfirm() {
    setError(null)
    setLoading(true)
    try {
      if (mode === 'published') {
        if (!selectedSchemaId) {
          setError('Select a schema.')
          setLoading(false)
          return
        }
        await onSelect({ mode: 'published', schemaId: selectedSchemaId })
        onOpenChange(false)
      } else if (mode === 'create') {
        // Validate minimal input.
        if (!schemaName.trim()) {
          setError('Schema name is required.')
          setLoading(false)
          return
        }
        const slug =
          schemaSlug.trim() || deriveSlug(schemaName)
        if (!slug.match(/^[a-z][a-z0-9_]{0,59}$/)) {
          setError(
            'Slug must start with a letter and contain only lowercase letters, numbers, and underscores.',
          )
          setLoading(false)
          return
        }
        const cleanFields = fields.filter(
          (f) => f.slug.trim() && f.label.trim(),
        )
        if (cleanFields.length === 0) {
          setError('Add at least one field with a label.')
          setLoading(false)
          return
        }
        for (const f of cleanFields) {
          if (!f.slug.match(/^[a-z][a-z0-9_]{0,59}$/)) {
            setError(`Field slug "${f.slug}" is not valid.`)
            setLoading(false)
            return
          }
        }
        const created = await createDatasetSchema(datasetSchemaDataClient, {
          slug,
          name: schemaName.trim(),
          fields: cleanFields.map((f) => ({
            slug: f.slug,
            label: f.label,
            logical_type: f.logical_type,
            // required = NOT nullable; backend defaults nullable=true.
            nullable: !f.required,
          })),
        })
        let schemaId = created.schema.id
        if (publishImmediately) {
          const pub = await publishDatasetSchema(
            datasetSchemaDataClient,
            schemaId,
          )
          schemaId = pub.schemaId
        }
        await onSelect({ mode: 'created', schemaId })
        onOpenChange(false)
      } else {
        // ad-hoc
        await onSelect({ mode: 'ad-hoc' })
        onOpenChange(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create sheet.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          mode === 'create' ? 'max-w-2xl' : 'max-w-lg',
        )}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits the dialog — the same path as the
          // "Create sheet" button. Skipped in choose mode (cards navigate)
          // and while a request is in flight.
          if (
            e.key === 'Enter' &&
            (e.metaKey || e.ctrlKey) &&
            mode !== 'choose' &&
            !loading
          ) {
            e.preventDefault()
            void handleConfirm()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Create sheet</DialogTitle>
          <DialogDescription>
            Choose a reusable dataset schema or continue with an ad-hoc sheet.
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' && (
          <div className="flex flex-col gap-2 py-2">
            <ChooseOption
              icon={Database}
              title="Select published schema"
              description="Instantiate a sheet from a workspace dataset schema."
              onClick={() => setMode('published')}
            />
            <ChooseOption
              icon={FilePlus}
              title="Create schema on the fly"
              description="Define a new schema and start a sheet from it."
              onClick={() => setMode('create')}
            />
            <ChooseOption
              icon={PencilLine}
              title="Continue ad-hoc"
              description="No schema binding — columns are local to this sheet."
              onClick={() => void handleConfirm()}
            />
          </div>
        )}

        {mode === 'published' && (
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="schema-select">Published schema</Label>
            <Select
              id="schema-select"
              value={selectedSchemaId}
              onChange={(e) => setSelectedSchemaId(e.target.value)}
            >
              <option value="">Select a schema…</option>
              {publishedSchemas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (rev {s.revision})
                </option>
              ))}
            </Select>
            {publishedSchemas.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No published schemas in this workspace yet.
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode('choose')}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                {!loading && selectedSchemaId && (
                  <kbd className="hidden font-mono text-[10px] text-muted-foreground/70 sm:inline">
                    ⌘↵
                  </kbd>
                )}
                <Button
                  size="sm"
                  onClick={() => void handleConfirm()}
                  disabled={loading || !selectedSchemaId}
                >
                  {loading ? 'Creating…' : 'Create sheet'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <CreateSchemaForm
            schemaName={schemaName}
            schemaSlug={schemaSlug}
            schemaSlugEdited={schemaSlugEdited}
            onSchemaNameChange={(name) => {
              setSchemaName(name)
              if (!schemaSlugEdited) setSchemaSlug(deriveSlug(name))
            }}
            onSchemaSlugChange={(slug) => {
              setSchemaSlug(slug)
              setSchemaSlugEdited(true)
            }}
            fields={fields}
            onAddField={addField}
            onUpdateFieldLabel={updateFieldLabel}
            onUpdateFieldSlug={updateFieldSlug}
            onUpdateFieldType={updateFieldType}
            onUpdateFieldRequired={updateFieldRequired}
            onRemoveField={removeField}
            publishImmediately={publishImmediately}
            onPublishChange={setPublishImmediately}
            loading={loading}
            onBack={() => setMode('choose')}
            onConfirm={() => void handleConfirm()}
          />
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* Create schema form                                                          */
/* -------------------------------------------------------------------------- */

interface CreateSchemaFormProps {
  schemaName: string
  schemaSlug: string
  schemaSlugEdited: boolean
  onSchemaNameChange: (name: string) => void
  onSchemaSlugChange: (slug: string) => void
  fields: DraftField[]
  onAddField: () => void
  onUpdateFieldLabel: (index: number, label: string) => void
  onUpdateFieldSlug: (index: number, slug: string) => void
  onUpdateFieldType: (index: number, type: ScientificLogicalType) => void
  onUpdateFieldRequired: (index: number, required: boolean) => void
  onRemoveField: (index: number) => void
  publishImmediately: boolean
  onPublishChange: (value: boolean) => void
  loading: boolean
  onBack: () => void
  onConfirm: () => void
}

function CreateSchemaForm({
  schemaName,
  schemaSlug,
  schemaSlugEdited,
  onSchemaNameChange,
  onSchemaSlugChange,
  fields,
  onAddField,
  onUpdateFieldLabel,
  onUpdateFieldSlug,
  onUpdateFieldType,
  onUpdateFieldRequired,
  onRemoveField,
  publishImmediately,
  onPublishChange,
  loading,
  onBack,
  onConfirm,
}: CreateSchemaFormProps) {
  // Focus management for keyboard-driven rapid entry.
  const labelRefs = React.useRef<(HTMLInputElement | null)[]>([])
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (focusIndex != null) {
      const el = labelRefs.current[focusIndex]
      if (el) {
        el.focus()
        // Place caret at end so typing continues naturally.
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
      setFocusIndex(null)
    }
  }, [focusIndex, fields])

  function handleLabelKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === fields.length - 1) {
        onAddField()
        setFocusIndex(fields.length)
      } else {
        labelRefs.current[index + 1]?.focus()
      }
    }
  }

  return (
    <div className="flex max-h-[72vh] flex-col gap-4 py-1">
      {/* Guidance — one concise line, not a chrome-heavy callout. */}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Define the columns this sheet captures. Experiments using the schema
          validate against them, so measurements stay consistent across runs.
        </span>
      </p>

      {/* Schema identity */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schema-name">Schema name</Label>
          <Input
            id="schema-name"
            value={schemaName}
            onChange={(e) => onSchemaNameChange(e.target.value)}
            placeholder="Stability study result"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schema-slug">
            Slug
            {!schemaSlugEdited && schemaSlug ? (
              <span className="ml-1.5 font-normal text-muted-foreground/70">
                auto
              </span>
            ) : null}
          </Label>
          <Input
            id="schema-slug"
            value={schemaSlug}
            onChange={(e) => onSchemaSlugChange(e.target.value)}
            placeholder="auto-derived from name"
            className="font-mono text-sm"
          />
        </div>
      </div>

      <Separator />

      {/* Field builder — dense table */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fields
          </Label>
          {fields.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {fields.length} {fields.length === 1 ? 'field' : 'fields'}
            </span>
          )}
        </div>

        {fields.length === 0 ? (
          <Empty className="min-h-32 border-dashed">
            <EmptyIcon>
              <Layers className="size-5" />
            </EmptyIcon>
            <EmptyTitle>No fields yet</EmptyTitle>
            <EmptyDescription>
              Add the columns this sheet will capture — for example replicate,
              titer or pass_fail.
            </EmptyDescription>
            <EmptyActions>
              <Button variant="outline" size="sm" onClick={onAddField}>
                <Plus className="size-4" />
                Add field
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {/* Header */}
            <div className="grid grid-cols-[24px_minmax(0,1fr)_minmax(96px,0.8fr)_108px_44px_28px] items-center gap-x-2 border-b border-border bg-muted/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="text-center" aria-hidden>
                #
              </span>
              <span>Field</span>
              <span>Key</span>
              <span>Type</span>
              <span className="text-center" title="Required">
                Req
              </span>
              <span aria-hidden />
            </div>

            {/* Rows — bounded scroll for 20+ fields */}
            <div className="max-h-[280px] overflow-y-auto">
              {fields.map((field, i) => (
                <FieldRow
                  key={i}
                  index={i}
                  field={field}
                  labelRef={(el) => {
                    labelRefs.current[i] = el
                  }}
                  onLabelChange={(label) => onUpdateFieldLabel(i, label)}
                  onSlugChange={(slug) => onUpdateFieldSlug(i, slug)}
                  onTypeChange={(type) => onUpdateFieldType(i, type)}
                  onRequiredChange={(req) => onUpdateFieldRequired(i, req)}
                  onRemove={() => onRemoveField(i)}
                  onKeyDown={(e) => handleLabelKeyDown(i, e)}
                />
              ))}
            </div>
          </div>
        )}

        {fields.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddField}
            className="w-fit text-muted-foreground"
          >
            <Plus className="size-4" />
            Add field
            <kbd className="ml-1 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground/70">
              ↵
            </kbd>
          </Button>
        )}
      </div>

      <Separator />

      {/* Publish option */}
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={publishImmediately}
          onCheckedChange={(v) => onPublishChange(v === true)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Publish immediately</span>
          <span className="block text-xs text-muted-foreground">
            Otherwise the schema is saved as a draft you can refine first.
          </span>
        </span>
      </label>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          {!loading && (
            <kbd className="hidden font-mono text-[10px] text-muted-foreground/70 sm:inline">
              ⌘↵
            </kbd>
          )}
          <Button size="sm" onClick={onConfirm} disabled={loading}>
            {loading ? 'Creating…' : 'Create sheet'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Field row — one compact line in the dense table                            */
/* -------------------------------------------------------------------------- */

interface FieldRowProps {
  index: number
  field: DraftField
  labelRef: (el: HTMLInputElement | null) => void
  onLabelChange: (label: string) => void
  onSlugChange: (slug: string) => void
  onTypeChange: (type: ScientificLogicalType) => void
  onRequiredChange: (required: boolean) => void
  onRemove: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

function FieldRow({
  index,
  field,
  labelRef,
  onLabelChange,
  onSlugChange,
  onTypeChange,
  onRequiredChange,
  onRemove,
  onKeyDown,
}: FieldRowProps) {
  return (
    <div className="group grid grid-cols-[24px_minmax(0,1fr)_minmax(96px,0.8fr)_108px_44px_28px] items-center gap-x-2 border-b border-border/60 px-2 py-1 last:border-b-0 hover:bg-muted/30">
      {/* Index */}
      <span className="text-center text-xs tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>

      {/* Field name — primary cell, reads like a spreadsheet cell */}
      <Input
        ref={labelRef}
        value={field.label}
        onChange={(e) => onLabelChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholderFor(index)}
        aria-label={`Field ${index + 1} name`}
        className="h-8 border-none bg-transparent px-1.5 text-sm shadow-none focus-visible:rounded focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
      />

      {/* Key / slug — mono, secondary */}
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] text-muted-foreground/50">
          #
        </span>
        <Input
          value={field.slug}
          onChange={(e) => onSlugChange(e.target.value)}
          placeholder="auto"
          aria-label={`Field ${index + 1} key`}
          className="h-8 border-none bg-transparent px-0 font-mono text-xs text-muted-foreground shadow-none focus-visible:rounded focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
        />
      </div>

      {/* Type — compact pill */}
      <FieldTypePicker value={field.logical_type} onChange={onTypeChange} />

      {/* Required */}
      <div className="flex justify-center">
        <Checkbox
          checked={field.required}
          onCheckedChange={(v) => onRequiredChange(v === true)}
          aria-label={`Field ${index + 1} required`}
        />
      </div>

      {/* Remove — appears on row hover */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`Remove field ${index + 1}`}
        className="size-7 text-muted-foreground/0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-hover:text-muted-foreground"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Field type picker — compact badge pill + dropdown                          */
/* -------------------------------------------------------------------------- */

interface FieldTypePickerProps {
  value: ScientificLogicalType
  onChange: (type: ScientificLogicalType) => void
}

function FieldTypePicker({ value, onChange }: FieldTypePickerProps) {
  const meta = TYPE_META[value]
  const Icon = meta.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-full items-center justify-between gap-1 rounded-md border border-border bg-muted/30 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40',
          )}
          aria-label={`Field type: ${meta.label}`}
        >
          <span className="flex items-center gap-1.5 overflow-hidden">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{meta.label}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Field type
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {BUILDER_TYPES.map((type) => {
          const m = TYPE_META[type]
          const ItemIcon = m.icon
          const active = type === value
          return (
            <DropdownMenuItem
              key={type}
              onSelect={() => onChange(type)}
              className={cn(
                'flex items-start gap-2.5 py-2',
                active && 'bg-accent/50',
              )}
            >
              <ItemIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                <span className="text-sm font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  {m.description}
                </span>
              </span>
              {active && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  current
                </Badge>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* -------------------------------------------------------------------------- */
/* Choose option card                                                          */
/* -------------------------------------------------------------------------- */

function ChooseOption({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="min-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}
