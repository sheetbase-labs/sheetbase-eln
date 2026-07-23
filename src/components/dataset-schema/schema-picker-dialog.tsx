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
 */
import * as React from 'react'
import { Database, FilePlus, PencilLine } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
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

const LOGICAL_TYPES: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

interface DraftField {
  slug: string
  label: string
  logical_type: ScientificLogicalType
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
  const [fields, setFields] = React.useState<DraftField[]>([
    { slug: '', label: '', logical_type: 'text' },
  ])
  const [publishImmediately, setPublishImmediately] = React.useState(false)

  // Reset state when dialog opens.
  React.useEffect(() => {
    if (open) {
      setMode('choose')
      setSelectedSchemaId('')
      setError(null)
      setSchemaName('')
      setSchemaSlug('')
      setFields([{ slug: '', label: '', logical_type: 'text' }])
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
      { slug: '', label: '', logical_type: 'text' },
    ])
  }

  function updateField(index: number, key: keyof DraftField, value: string) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)),
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
          schemaSlug.trim() ||
          schemaName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
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
          setError('At least one field with a slug and label is required.')
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
      <DialogContent className="max-w-lg">
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
            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode('choose')}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirm()}
                disabled={loading || !selectedSchemaId}
              >
                {loading ? 'Creating…' : 'Create sheet'}
              </Button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="flex flex-col gap-3 py-2 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="schema-name">Schema name</Label>
                <Input
                  id="schema-name"
                  value={schemaName}
                  onChange={(e) => setSchemaName(e.target.value)}
                  placeholder="Stability Study Result"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="schema-slug">Slug (optional)</Label>
                <Input
                  id="schema-slug"
                  value={schemaSlug}
                  onChange={(e) => setSchemaSlug(e.target.value)}
                  placeholder="auto-derived from name"
                />
              </div>
            </div>

            <Label>Fields</Label>
            {fields.map((field, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    value={field.slug}
                    onChange={(e) => updateField(i, 'slug', e.target.value)}
                    placeholder="slug"
                    aria-label={`Field ${i + 1} slug`}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    value={field.label}
                    onChange={(e) => updateField(i, 'label', e.target.value)}
                    placeholder="Label"
                    aria-label={`Field ${i + 1} label`}
                  />
                </div>
                <div className="w-32">
                  <Select
                    value={field.logical_type}
                    onChange={(e) =>
                      updateField(i, 'logical_type', e.target.value)
                    }
                    aria-label={`Field ${i + 1} type`}
                  >
                    {LOGICAL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
                {fields.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeField(i)}
                    aria-label={`Remove field ${i + 1}`}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addField}>
              + Add field
            </Button>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publishImmediately}
                onChange={(e) => setPublishImmediately(e.target.checked)}
              />
              Publish immediately (otherwise created as a draft)
            </label>

            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMode('choose')}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirm()}
                disabled={loading}
              >
                {loading ? 'Creating…' : 'Create sheet'}
              </Button>
            </div>
          </div>
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
