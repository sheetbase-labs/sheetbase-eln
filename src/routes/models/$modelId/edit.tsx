import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { PageHeader, Muted } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { Badge } from '#/components/v3/ui/badge'
import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  createNextDatasetSchemaVersion,
  deleteDatasetSchemaVersion,
  publishDatasetSchemaVersion,
  replaceDatasetSchemaVersionFields,
} from '#/lib/dataset-schema-definition-rpc'
import type {
  CanonicalDatasetSchemaField,
  DatasetSchemaFieldInput,
} from '#/lib/dataset-schema-definition-rpc'
import {
  useModelDefinition,
  useModelFields,
  useModelVersions,
} from '#/components/v3/models/models-data'

/**
 * UI port (roadmap-4/ui-app3): the model editor (MDL-02). Edits a draft schema
 * version while the published one stays in use; publishing runs the CORE-05
 * RPC, so the capability and rules stay server-side. `?state=denied` drives
 * the acceptance suite.
 */
export const Route = createFileRoute('/models/$modelId/edit')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { field?: string; state?: 'denied' | 'empty' } => ({
    field: typeof search.field === 'string' ? search.field : undefined,
    state:
      search.state === 'denied' || search.state === 'empty'
        ? search.state
        : undefined,
  }),
  component: ModelEditor,
})

// Mirrors chk_dataset_schema_version_fields_type.
const LOGICAL_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
  'reference',
]

interface DraftField extends DatasetSchemaFieldInput {
  /** Stable key for React and comparison; the persisted field id when known. */
  rowKey: string
}

function toDraftField(field: CanonicalDatasetSchemaField): DraftField {
  return {
    rowKey: field.field_id,
    fieldId: field.field_id,
    key: field.key,
    label: field.label,
    description: field.description,
    logicalType: field.logical_type,
    nullable: field.nullable,
    quantity: field.quantity ?? null,
    validation: field.validation ?? {},
    category: field.category ?? null,
    cardinality: field.cardinality === 'many' ? 'many' : 'one',
    lifecycle: field.lifecycle === 'retired' ? 'retired' : 'active',
    displayOrder: field.display_order,
  }
}

function ModelEditor() {
  const { modelId } = Route.useParams()
  const { state } = Route.useSearch()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const definition = useModelDefinition(modelId)
  const versions = useModelVersions(modelId)

  const draft = versions.data?.find((v) => v.lifecycle === 'draft') ?? null
  const published =
    versions.data?.find((v) => v.lifecycle === 'published') ?? null
  const draftFields = useModelFields(draft?.id)
  const publishedFields = useModelFields(published?.id)

  const canEdit = hasCapability(context.workspace?.role, 'schema.edit')
  const denied = state === 'denied' || !canEdit

  const [rows, setRows] = useState<DraftField[]>([])
  const [dirty, setDirty] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!draft) return
    if (loadedRef.current === draft.id) return
    if (draftFields.data) {
      setRows(draftFields.data.map(toDraftField))
      loadedRef.current = draft.id
      setDirty(false)
    }
  }, [draft, draftFields.data])

  const save = useMutation({
    mutationFn: (fields: DraftField[]) =>
      replaceDatasetSchemaVersionFields(notebookDataClient, {
        schemaVersionId: draft!.id,
        fields,
      }),
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  // Debounced autosave of the draft while editing.
  useEffect(() => {
    if (!dirty || denied || !draft) return
    const t = setTimeout(() => save.mutate(rows), 600)
    return () => clearTimeout(t)
  }, [rows, dirty, denied, draft?.id])

  const changes = useMemo(
    () => computeChanges(rows, publishedFields.data ?? []),
    [rows, publishedFields.data],
  )

  const startDraft = useMutation({
    mutationFn: () =>
      createNextDatasetSchemaVersion(notebookDataClient, modelId),
    onSuccess: () => {
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Draft started')
    },
  })

  const discard = useMutation({
    mutationFn: () => deleteDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setDiscardOpen(false)
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Draft discarded')
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const publish = useMutation({
    mutationFn: () =>
      publishDatasetSchemaVersion(notebookDataClient, draft!.id),
    onSuccess: () => {
      setPublishOpen(false)
      loadedRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'models'] })
      toast('Version published', {
        description: 'Datasets keep the version they are on.',
      })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const model = definition.data
  if (!model) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/models" className="text-link">
              Models
            </Link>
          }
          title={definition.isLoading ? 'Loading model…' : 'Model not found'}
        />
      </div>
    )
  }

  function setField(rowKey: string, patch: Partial<DraftField>) {
    setRows((current) =>
      current.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)),
    )
    setDirty(true)
    setError(null)
  }

  function addField() {
    const rowKey = `new-${crypto.randomUUID()}`
    setRows((current) => [
      ...current,
      {
        rowKey,
        key: '',
        label: 'New field',
        logicalType: 'text',
        nullable: true,
        displayOrder: current.length + 1,
      },
    ])
    setDirty(true)
  }

  function removeField(rowKey: string) {
    setRows((current) => current.filter((r) => r.rowKey !== rowKey))
    setDirty(true)
  }

  const grouped = groupBySection(rows)

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumbs={
          <>
            <Link to="/models" className="text-link">
              Models
            </Link>{' '}
            /{' '}
            <Link
              to="/models/$modelId"
              params={{ modelId }}
              className="text-link"
            >
              {model.name}
            </Link>{' '}
            / Draft
          </>
        }
        title={`Edit ${model.name}`}
        meta={
          <>
            {draft ? (
              <Status tone="draft">Draft v{draft.version}</Status>
            ) : (
              <Status tone="none">No draft</Status>
            )}
            {published ? (
              <span className="text-fg-muted">v{published.version} in use</span>
            ) : null}
            <span className="text-fg-muted">
              {save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
          </>
        }
        actions={
          draft ? (
            <>
              <Button
                variant="quiet"
                disabled={denied || save.isPending}
                onClick={() => setDiscardOpen(true)}
              >
                Discard draft
              </Button>
              <Button
                variant="primary"
                disabled={denied || changes.total === 0 || save.isPending}
                onClick={() => setPublishOpen(true)}
              >
                Publish v{draft.version}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={denied || startDraft.isPending}
              onClick={() => startDraft.mutate()}
            >
              Start draft
            </Button>
          )
        }
      />

      {denied ? (
        <div className="px-4 pt-4 md:px-6">
          <Notice tone="info" icon="lock">
            View only. Only model owners and admins can change {model.name}.
          </Notice>
        </div>
      ) : null}
      {error ? (
        <div className="px-4 pt-4 md:px-6">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}

      {!draft ? (
        <div className="px-4 py-5 md:px-6">
          <EmptyState
            icon="schema"
            title="No draft to edit"
            body="Start a draft to change this model’s fields. The published version stays in use until the draft is published."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-4 py-5 md:px-6">
          <Notice tone="info">
            Draft v{draft.version} · v{published?.version ?? '—'} stays in use
            until this is published. Values already recorded never change.
          </Notice>

          <div className="flex flex-wrap items-center gap-3">
            <Muted>
              {rows.length} fields · {changes.total} changes since v
              {published?.version ?? '—'}
            </Muted>
            <Button size="sm" disabled={denied} onClick={addField}>
              Add field
            </Button>
          </div>

          {grouped.map((group) => (
            <section key={group.section} aria-label={group.section}>
              <h2 className="mb-1 text-section">{group.section}</h2>
              <div className="overflow-hidden rounded-md border border-border">
                <Table aria-label={`${group.section} fields`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="first:pl-3">Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead className="pr-3" align="right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.fields.map((field) => {
                      const change = changes.byKey.get(field.key)
                      return (
                        <TableRow key={field.rowKey}>
                          <TableCell className="first:pl-3">
                            <Input
                              aria-label="Field name"
                              disabled={denied}
                              value={field.label}
                              onChange={(e) =>
                                setField(field.rowKey, {
                                  label: e.target.value,
                                })
                              }
                              className="h-[26px] text-label"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label="Field key"
                              disabled={denied}
                              value={field.key}
                              onChange={(e) =>
                                setField(field.rowKey, { key: e.target.value })
                              }
                              className="mono h-[26px] text-label"
                            />
                          </TableCell>
                          <TableCell>
                            <NativeSelect
                              aria-label="Field type"
                              disabled={denied}
                              value={field.logicalType}
                              onChange={(e) =>
                                setField(field.rowKey, {
                                  logicalType: e.target.value,
                                })
                              }
                              className="h-[26px]"
                            >
                              {LOGICAL_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </NativeSelect>
                          </TableCell>
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label="Required"
                              disabled={denied}
                              checked={!field.nullable}
                              onChange={(e) =>
                                setField(field.rowKey, {
                                  nullable: !e.target.checked,
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            {change ? (
                              <Badge
                                variant={change === 'Added' ? 'add' : 'chg'}
                              >
                                {change}
                              </Badge>
                            ) : (
                              <span className="text-label text-fg-muted">
                                —
                              </span>
                            )}
                          </TableCell>
                          <TableCell align="right" className="pr-3">
                            <Button
                              size="sm"
                              variant="quiet"
                              disabled={denied}
                              onClick={() => removeField(field.rowKey)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}

          {changes.removed.length ? (
            <section aria-label="Removed fields">
              <h2 className="mb-1 text-section">
                Removed since v{published?.version}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {changes.removed.map((f) => (
                  <li key={f.key} className="text-body">
                    <Badge variant="del">Removed</Badge>{' '}
                    <span className="font-medium">{f.label}</span>{' '}
                    <span className="mono text-label text-fg-muted">
                      {f.key}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      {discardOpen && draft ? (
        <Dialog
          open
          onOpenChange={(o) => (o ? undefined : setDiscardOpen(false))}
        >
          <DialogContent className="w-[min(480px,calc(100vw-32px))]">
            <DialogHeader
              title="Discard this draft?"
              description={`Draft v${draft.version} and its field changes are deleted. v${published?.version ?? '—'} stays in use.`}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                Cancel
              </DialogClose>
              <Button
                variant="danger"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                {discard.isPending ? 'Discarding…' : 'Discard draft'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {publishOpen && draft ? (
        <Dialog
          open
          onOpenChange={(o) => (o ? undefined : setPublishOpen(false))}
        >
          <DialogContent className="w-[min(520px,calc(100vw-32px))]">
            <DialogHeader
              title={`Publish v${draft.version}`}
              description={`New datasets use v${draft.version}. Datasets already on v${published?.version ?? '—'} keep it.`}
            />
            <DialogBody>
              <Muted>
                {changes.total} changes since v{published?.version}.
              </Muted>
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" />}>
                Cancel
              </DialogClose>
              <Button
                variant="primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function sectionOf(field: DatasetSchemaFieldInput): string {
  const category = field.category
  if (typeof category === 'string') return category
  if (category && typeof category === 'object' && 'label' in category) {
    const label = (category as { label?: unknown }).label
    if (typeof label === 'string') return label
  }
  return 'Fields'
}

function groupBySection(rows: DraftField[]) {
  const map = new Map<string, DraftField[]>()
  for (const row of rows) {
    const section = sectionOf(row)
    map.set(section, [...(map.get(section) ?? []), row])
  }
  return [...map.entries()].map(([section, fields]) => ({ section, fields }))
}

interface ChangeSummary {
  total: number
  byKey: Map<string, 'Added' | 'Changed'>
  removed: CanonicalDatasetSchemaField[]
}

/** Diff the draft rows against the published fields by key. */
export function computeChanges(
  rows: DatasetSchemaFieldInput[],
  published: CanonicalDatasetSchemaField[],
): ChangeSummary {
  const byKey = new Map<string, 'Added' | 'Changed'>()
  const publishedByKey = new Map(published.map((f) => [f.key, f]))
  for (const row of rows) {
    const before = publishedByKey.get(row.key)
    if (!before) {
      byKey.set(row.key, 'Added')
    } else if (
      before.label !== row.label ||
      before.logical_type !== row.logicalType ||
      before.nullable !== (row.nullable ?? true)
    ) {
      byKey.set(row.key, 'Changed')
    }
  }
  const draftKeys = new Set(rows.map((r) => r.key))
  const removed = published.filter((f) => !draftKeys.has(f.key))
  return { total: byKey.size + removed.length, byKey, removed }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('capability')) {
    return 'You don’t have permission to change this model.'
  }
  return message
}
