import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import type { NodeProps, Node, Edge, Connection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Database,
  EllipsisVertical,
  Eye,
  Hash,
  Layers,
  Link2,
  Tag,
  ToggleLeft,
  Trash2,
  Type as TypeIcon,
  Calendar,
  PanelLeft,
  PanelRight,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusVocabulary } from '#/components/scientific/status-badge'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import {
  addDatasetSchemaField,
  createDatasetSchema,
  createSchemaRelationship,
  datasetSchemaQueryKeys,
  deleteSchemaRelationship,
  fetchDatasetSchemaFields,
  fetchDatasetSchemaRelationships,
  fetchDatasetSchemas,
  fetchPublishedDatasetSchemas,
  publishDatasetSchema,
  retireDatasetSchemaField,
} from '#/lib/dataset-schema-data'
import type {
  CreateSchemaRelationshipInput,
  DatasetSchemaFieldInput,
  DatasetSchemaFieldWire,
  DatasetSchemaRelationshipWire,
  DatasetSchemaWire,
  RelationshipCardinality,
  RelationshipType,
} from '#/lib/dataset-schema-data'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { FieldLogicalType } from '#/lib/field-definition'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/schemas')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: SchemaManagementRoute,
})

const dataClient = createDataClient()

const logicalTypes = FIELD_LOGICAL_TYPES
type ScientificLogicalType = FieldLogicalType

const typeIcon: Record<ScientificLogicalType, LucideIcon> = {
  text: TypeIcon,
  integer: Hash,
  decimal: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  timestamp: Calendar,
  category: Tag,
  reference: Link2,
}

/** Type shortcuts shown in the bottom field-toolbar. */
const typeShortcuts: {
  label: string
  type: ScientificLogicalType
  icon: LucideIcon
}[] = [
  { label: 'Text', type: 'text', icon: TypeIcon },
  { label: 'Number', type: 'integer', icon: Hash },
  { label: 'Date', type: 'date', icon: Calendar },
  { label: 'Boolean', type: 'boolean', icon: ToggleLeft },
  { label: 'Category', type: 'category', icon: Tag },
  { label: 'Reference', type: 'reference', icon: Link2 },
]

/** Schema lifecycle vocabulary: Draft amber, Published green. */
const schemaStatusVocabulary: StatusVocabulary = {
  draft: { label: 'Draft', tone: 'warning', icon: Layers },
  published: { label: 'Published', tone: 'success', icon: Database },
  retired: { label: 'Retired', tone: 'neutral', icon: Trash2 },
}

const emptyField = (
  type: ScientificLogicalType = 'text',
): DatasetSchemaFieldInput => ({
  slug: '',
  label: '',
  logical_type: type,
  nullable: true,
  default_value: null,
  unit: {},
  validation: {},
  description: '',
  target_schema_id: null,
})

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed.'
}

type EditorMode = 'view' | 'create'

function SchemaManagementRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<EditorMode>('view')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [registryOpen, setRegistryOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  // SCI-011: 'graph' shows all schemas as nodes with relationship edges;
  // 'zoom' shows the single-schema field-table editor (existing behaviour).
  const [viewMode, setViewMode] = useState<'graph' | 'zoom'>('graph')

  // Create-mode draft state.
  const [draftName, setDraftName] = useState('')
  const [draftSlug, setDraftSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [draftDescription, setDraftDescription] = useState('')
  const [draftFields, setDraftFields] = useState<DatasetSchemaFieldInput[]>([
    emptyField(),
  ])
  const [draftSelected, setDraftSelected] = useState(0)

  // View-mode state.
  const [pendingField, setPendingField] =
    useState<DatasetSchemaFieldInput | null>(null)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)

  const schemasQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.list,
    queryFn: () => fetchDatasetSchemas(dataClient),
  })
  const schemas: DatasetSchemaWire[] = schemasQuery.data || []
  const activeId = mode === 'view' ? selectedId : null
  const selected = schemas.find((s) => s.id === activeId) || null

  const fieldsQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.fields(activeId || 'none'),
    queryFn: () => fetchDatasetSchemaFields(dataClient, activeId || 'none'),
    enabled: Boolean(activeId),
  })
  const fields: DatasetSchemaFieldWire[] = fieldsQuery.data || []

  // SCI-011: relationships (graph edges) and published schemas (reference
  // target dropdown + graph nodes). RLS scopes both to the current workspace.
  const workspaceId = context.workspace?.id ?? ''
  const relationshipsQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.relationships(workspaceId),
    queryFn: () => fetchDatasetSchemaRelationships(dataClient),
    enabled: Boolean(workspaceId),
  })
  const relationships: DatasetSchemaRelationshipWire[] =
    relationshipsQuery.data || []
  const publishedSchemasQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.published,
    queryFn: () => fetchPublishedDatasetSchemas(dataClient),
  })
  const publishedSchemas: DatasetSchemaWire[] = publishedSchemasQuery.data || []

  // SCI-011: map a reference field id to its relationship target schema id,
  // so the inspector can show the target schema for saved reference fields
  // (field wire rows carry no target metadata — it lives on the relationship).
  const referenceTargetByFieldId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of relationships) {
      if (r.source_field_id && r.relationship_type === 'references')
        map[r.source_field_id] = r.target_schema_id
    }
    return map
  }, [relationships])

  const refreshList = () => {
    queryClient.invalidateQueries({ queryKey: datasetSchemaQueryKeys.list })
    queryClient.invalidateQueries({
      queryKey: datasetSchemaQueryKeys.published,
    })
  }
  const refreshFields = (schemaId: string) =>
    queryClient.invalidateQueries({
      queryKey: datasetSchemaQueryKeys.fields(schemaId),
    })
  const refreshRelationships = () =>
    queryClient.invalidateQueries({
      queryKey: datasetSchemaQueryKeys.relationships(workspaceId),
    })

  const createMutation = useMutation({
    mutationFn: () =>
      createDatasetSchema(dataClient, {
        slug: draftSlug,
        name: draftName,
        description: draftDescription || undefined,
        fields: draftFields.filter((f) => f.slug.trim() && f.label.trim()),
      }),
    onSuccess: async (result) => {
      // SCI-011: auto-create `references` relationships for reference fields
      // that have a target schema selected. Match the created field by slug.
      const refFields = draftFields.filter(
        (f) =>
          f.logical_type === 'reference' &&
          f.target_schema_id &&
          f.slug.trim() &&
          f.label.trim(),
      )
      for (const f of refFields) {
        const created = result.fields.find((cf) => cf.slug === f.slug)
        if (!created) continue
        try {
          await createSchemaRelationship(dataClient, {
            source_schema_id: result.schema.id,
            target_schema_id: f.target_schema_id!,
            relationship_type: 'references',
            source_field_id: created.id,
          })
        } catch {
          // A relationship may already exist; surface nothing here.
        }
      }
      setMode('view')
      setSelectedId(result.schema.id)
      setViewMode('zoom')
      resetDraft()
      void refreshList()
      void refreshRelationships()
    },
  })
  const addMutation = useMutation({
    mutationFn: () =>
      addDatasetSchemaField(dataClient, selected!.id, pendingField!),
    onSuccess: async (created) => {
      // SCI-011: auto-create a `references` relationship for a reference field.
      if (
        pendingField?.logical_type === 'reference' &&
        pendingField.target_schema_id
      ) {
        try {
          await createSchemaRelationship(dataClient, {
            source_schema_id: selected!.id,
            target_schema_id: pendingField.target_schema_id,
            relationship_type: 'references',
            source_field_id: created.id,
          })
          void refreshRelationships()
        } catch {
          // Relationship may already exist; ignore.
        }
      }
      setPendingField(null)
      if (selected) {
        void refreshFields(selected.id)
        void refreshList()
      }
    },
  })
  const publishMutation = useMutation({
    mutationFn: (schemaId: string) =>
      publishDatasetSchema(dataClient, schemaId),
    onSuccess: () => {
      void refreshList()
      void refreshRelationships()
    },
  })
  const retireMutation = useMutation({
    mutationFn: (fieldId: string) =>
      retireDatasetSchemaField(dataClient, fieldId),
    onSuccess: () => selected && void refreshFields(selected.id),
  })
  const createRelationshipMutation = useMutation({
    mutationFn: (input: CreateSchemaRelationshipInput) =>
      createSchemaRelationship(dataClient, input),
    onSuccess: () => void refreshRelationships(),
  })
  const deleteRelationshipMutation = useMutation({
    mutationFn: (relationshipId: string) =>
      deleteSchemaRelationship(dataClient, relationshipId),
    onSuccess: () => void refreshRelationships(),
  })

  const isOwner = false
  const canAddToSelected = false

  function resetDraft() {
    setDraftName('')
    setDraftSlug('')
    setSlugTouched(false)
    setDraftDescription('')
    setDraftFields([emptyField()])
    setDraftSelected(0)
  }

  // Auto-generate slug from name unless the user has manually edited it.
  useEffect(() => {
    if (!slugTouched && mode === 'create') {
      const generated = draftName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_\s-]/g, '')
        .replace(/[\s-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^[^a-z]/, '') // must start with a lowercase letter
      setDraftSlug(generated)
    }
  }, [draftName, slugTouched, mode])

  function selectSchema(id: string) {
    setMode('view')
    setSelectedId(id)
    setPendingField(null)
    setSelectedFieldId(null)
    setViewMode('zoom')
  }

  function showGraph() {
    setViewMode('graph')
  }

  // Escape returns from zoom to the graph (ADR 0035).
  useEffect(() => {
    if (viewMode !== 'zoom') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setViewMode('graph')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMode])

  const grouped = useMemo(
    () =>
      schemas.reduce<Record<string, DatasetSchemaWire[]>>((groups, schema) => {
        ;(groups[schema.slug] ??= []).push(schema)
        return groups
      }, {}),
    [schemas],
  )

  const activeSavedField = fields.find((f) => f.id === selectedFieldId) || null
  const panelMode: 'none' | 'draft' | 'pending' | 'saved' =
    mode === 'create'
      ? draftFields[draftSelected]
        ? 'draft'
        : 'none'
      : pendingField
        ? 'pending'
        : activeSavedField
          ? 'saved'
          : 'none'

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  const headerTitle = selected
    ? selected.name
    : mode === 'create'
      ? 'New Schema'
      : ''

  useShell({
    context: shellContext,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Legacy schemas' },
      ...(headerTitle ? [{ label: headerTitle }] : []),
    ],
    fullBleed: true,
  })

  return (
    <>
      <div className="border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
        Compatibility view of historical SCI-010 schemas. New Dataset Schemas
        are created in Configure. This page does not create or publish SCI-010
        schemas.
      </div>
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
        {/* Schema registry — collapsible */}
        {registryOpen ? (
          <div className="flex h-full min-h-0 w-60 shrink-0 flex-col border-r">
            <div className="flex items-center justify-between border-b px-3 py-2.5">
              <h2 className="text-sm font-semibold">Legacy schemas</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRegistryOpen(false)}
                  className="px-1.5"
                  aria-label="Collapse registry"
                >
                  <PanelLeft className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {schemasQuery.isLoading && (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  Loading…
                </p>
              )}
              {schemasQuery.error && (
                <p role="alert" className="px-2 py-4 text-sm text-destructive">
                  {errorMessage(schemasQuery.error)}
                </p>
              )}
              {!schemasQuery.isLoading && schemas.length === 0 && (
                <div className="px-2 py-4">
                  <p className="text-sm text-muted-foreground">
                    No SCI-010 schemas in this workspace. Create governed
                    Dataset Schemas from Configure.
                  </p>
                </div>
              )}
              <div className="space-y-4">
                {Object.entries(grouped).map(([groupSlug, revisions]) => (
                  <section
                    key={groupSlug}
                    aria-label={`${groupSlug} revisions`}
                  >
                    <p className="px-1.5 pb-1 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {groupSlug}
                    </p>
                    <div className="space-y-0.5">
                      {revisions.map((schema) => (
                        <button
                          key={schema.id}
                          type="button"
                          aria-label={`Select ${schema.name} revision ${schema.revision}`}
                          onClick={() => selectSchema(schema.id)}
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted',
                            activeId === schema.id && 'bg-muted',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">
                              {schema.name}
                            </span>
                            <StatusBadge
                              status={schema.status}
                              vocabulary={schemaStatusVocabulary}
                            />
                          </span>
                          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">
                              rev {schema.revision}
                            </span>
                            <span>{formatRelativeTime(schema.updated_at)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-10 shrink-0 justify-center border-r py-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setRegistryOpen(true)}
              aria-label="Show schema registry"
            >
              <PanelLeft className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* Main area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {mode === 'create' ? (
            <CreateSchemaEditor
              name={draftName}
              slug={draftSlug}
              description={draftDescription}
              fields={draftFields}
              selectedIndex={draftSelected}
              isOwner={isOwner}
              publishedSchemas={publishedSchemas}
              createPending={createMutation.isPending}
              createError={createMutation.error}
              onChangeName={setDraftName}
              onChangeSlug={(v) => {
                setSlugTouched(true)
                setDraftSlug(v)
              }}
              onChangeDescription={setDraftDescription}
              onChangeField={(next, index) =>
                setDraftFields((items) =>
                  items.map((old, i) => (i === index ? next : old)),
                )
              }
              onSelectField={setDraftSelected}
              onAddField={(type) => {
                const next = [...draftFields, emptyField(type)]
                setDraftFields(next)
                setDraftSelected(next.length - 1)
              }}
              onRemoveField={(index) => {
                const next = draftFields.filter((_, i) => i !== index)
                const result = next.length ? next : [emptyField()]
                setDraftFields(result)
                setDraftSelected(
                  Math.max(0, Math.min(index, result.length - 1)),
                )
              }}
              onCancel={() => {
                setMode('view')
                setViewMode('graph')
                setRegistryOpen(true)
                resetDraft()
              }}
              onSave={() => createMutation.mutate()}
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen((v) => !v)}
            />
          ) : viewMode === 'graph' ? (
            <SchemaGraphCanvas
              schemas={schemas}
              relationships={relationships}
              relationshipsLoading={relationshipsQuery.isLoading}
              relationshipsError={relationshipsQuery.error}
              selectedId={selectedId}
              isOwner={isOwner}
              createPending={createRelationshipMutation.isPending}
              createError={createRelationshipMutation.error}
              deletePending={deleteRelationshipMutation.isPending}
              onSelectSchema={selectSchema}
              onCreateRelationship={(input) =>
                createRelationshipMutation.mutate(input)
              }
              onDeleteRelationship={(id) =>
                deleteRelationshipMutation.mutate(id)
              }
            />
          ) : selected ? (
            <SchemaEditor
              schema={selected}
              fields={fields}
              fieldsLoading={fieldsQuery.isLoading}
              fieldsError={fieldsQuery.error}
              selectedFieldId={selectedFieldId}
              pendingField={pendingField}
              panelMode={panelMode}
              isOwner={isOwner}
              canAdd={canAddToSelected}
              publishedSchemas={publishedSchemas}
              referenceTargetByFieldId={referenceTargetByFieldId}
              addPending={addMutation.isPending}
              addError={addMutation.error}
              publishPending={publishMutation.isPending}
              publishError={publishMutation.error}
              retirePending={retireMutation.isPending}
              retireError={retireMutation.error}
              onSelectField={(id) => {
                setPendingField(null)
                setSelectedFieldId(id)
              }}
              onStartAddField={(type) => {
                setSelectedFieldId(null)
                setPendingField(emptyField(type))
              }}
              onPendingChange={setPendingField}
              onCancelPending={() => setPendingField(null)}
              onAddField={() => addMutation.mutate()}
              onPublish={() => publishMutation.mutate(selected.id)}
              onRetireField={(id) => retireMutation.mutate(id)}
              onShowGraph={showGraph}
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen((v) => !v)}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <Database className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">No schema selected</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        This is a compatibility catalogue of historical SCI-010 Dataset Schemas.
        New governed schemas live under Configure.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Create-mode editor                                                         */
/* -------------------------------------------------------------------------- */

interface CreateSchemaEditorProps {
  name: string
  slug: string
  description: string
  fields: DatasetSchemaFieldInput[]
  selectedIndex: number
  isOwner: boolean
  publishedSchemas: DatasetSchemaWire[]
  createPending: boolean
  createError: unknown
  onChangeName: (value: string) => void
  onChangeSlug: (value: string) => void
  onChangeDescription: (value: string) => void
  onChangeField: (field: DatasetSchemaFieldInput, index: number) => void
  onSelectField: (index: number) => void
  onAddField: (type: ScientificLogicalType) => void
  onRemoveField: (index: number) => void
  onCancel: () => void
  onSave: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
}

function CreateSchemaEditor({
  name,
  slug,
  description,
  fields,
  selectedIndex,
  isOwner,
  publishedSchemas,
  createPending,
  createError,
  onChangeName,
  onChangeSlug,
  onChangeDescription,
  onChangeField,
  onSelectField,
  onAddField,
  onRemoveField,
  onCancel,
  onSave,
  inspectorOpen,
  onToggleInspector,
}: CreateSchemaEditorProps) {
  const selectedField = fields[selectedIndex] ?? null
  const hasSlug = slug.trim() !== ''
  const hasName = name.trim() !== ''
  const hasCompleteField = fields.some(
    (f) => f.slug.trim() !== '' && f.label.trim() !== '',
  )
  const slugValid = !hasSlug || /^[a-z][a-z0-9_]{0,59}$/.test(slug)
  const canSave = hasSlug && hasName && hasCompleteField && !createPending

  const missingHints: string[] = []
  if (!hasName) missingHints.push('Enter a schema name')
  if (!hasSlug) missingHints.push('Enter a schema slug')
  else if (!slugValid)
    missingHints.push(
      'Slug must start with a lowercase letter and contain only lowercase letters, numbers, and underscores',
    )
  if (!hasCompleteField)
    missingHints.push(
      'Add at least one field with both a slug and a label — the label is the human-readable name shown in the table',
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SchemaHeader
          title={name || 'New Schema'}
          status="draft"
          editingName
          editingSlug
          name={name}
          slug={slug}
          description={description}
          isOwner={isOwner}
          primaryLabel="Save schema"
          primaryPending={createPending}
          primaryDisabled={!canSave}
          onPrimary={onSave}
          secondaryLabel="Cancel"
          onSecondary={onCancel}
          onChangeName={onChangeName}
          onChangeSlug={onChangeSlug}
          onChangeDescription={onChangeDescription}
        />

        {!canSave && missingHints.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <CircleAlert
              className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="font-medium">Complete these to save:</p>
              <ul className="ml-3 list-disc space-y-0.5">
                {missingHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <SchemaTabs>
          <SchemaCanvas
            schemaName={name || 'New Schema'}
            schemaStatus="draft"
            rows={fields.map((f, i) => ({
              id: `draft-${i}`,
              slug: f.slug,
              label: f.label,
              logical_type: f.logical_type,
              nullable: f.nullable ?? true,
              lifecycle: 'active' as const,
              selected: i === selectedIndex,
              retired: false,
              incomplete: f.slug.trim() !== '' && f.label.trim() === '',
            }))}
            loading={false}
            emptyLabel="Start building this schema by adding a field from the toolbar below."
            onSelect={(id) => onSelectField(Number(id.replace('draft-', '')))}
            onAdd={onAddField}
            canAdd
          />
        </SchemaTabs>

        {Boolean(createError) && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(createError)}
          </p>
        )}
      </div>

      {inspectorOpen ? (
        <FieldPropertiesPanel
          mode={fields.length > 0 ? 'draft' : 'none'}
          savedField={null}
          pendingField={null}
          draftField={selectedField}
          isOwner={isOwner}
          canAdd
          publishedSchemas={publishedSchemas}
          currentSchemaId={null}
          addPending={false}
          retirePending={false}
          onDraftChange={(next) => onChangeField(next, selectedIndex)}
          onRemoveDraft={() => onRemoveField(selectedIndex)}
          onPendingChange={() => {}}
          onAddField={() => {}}
          onCancelPending={() => {}}
          onRetireField={() => {}}
          onClose={onToggleInspector}
        />
      ) : (
        <div className="flex w-10 shrink-0 justify-center border-l py-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleInspector}
            aria-label="Show field properties"
          >
            <PanelRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* View-mode editor                                                           */
/* -------------------------------------------------------------------------- */

interface SchemaEditorProps {
  schema: DatasetSchemaWire
  fields: DatasetSchemaFieldWire[]
  fieldsLoading: boolean
  fieldsError: unknown
  selectedFieldId: string | null
  pendingField: DatasetSchemaFieldInput | null
  panelMode: 'none' | 'draft' | 'pending' | 'saved'
  isOwner: boolean
  canAdd: boolean
  publishedSchemas: DatasetSchemaWire[]
  referenceTargetByFieldId: Record<string, string>
  addPending: boolean
  addError: unknown
  publishPending: boolean
  publishError: unknown
  retirePending: boolean
  retireError: unknown
  onSelectField: (id: string) => void
  onStartAddField: (type: ScientificLogicalType) => void
  onPendingChange: (field: DatasetSchemaFieldInput) => void
  onCancelPending: () => void
  onAddField: () => void
  onPublish: () => void
  onRetireField: (id: string) => void
  onShowGraph: () => void
  inspectorOpen: boolean
  onToggleInspector: () => void
}

function SchemaEditor({
  schema,
  fields,
  fieldsLoading,
  fieldsError,
  selectedFieldId,
  pendingField,
  panelMode,
  isOwner,
  canAdd,
  publishedSchemas,
  referenceTargetByFieldId,
  addPending,
  addError,
  publishPending,
  publishError,
  retirePending,
  retireError,
  onSelectField,
  onStartAddField,
  onPendingChange,
  onCancelPending,
  onAddField,
  onPublish,
  onRetireField,
  onShowGraph,
  inspectorOpen,
  onToggleInspector,
}: SchemaEditorProps) {
  const activeSavedField = fields.find((f) => f.id === selectedFieldId) || null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SchemaHeader
          title={schema.name}
          status={schema.status}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{schema.slug}</span>
              <span aria-hidden="true">·</span>
              <span>Version {schema.revision}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {formatRelativeTime(schema.updated_at)}</span>
            </span>
          }
          description={schema.description}
          isOwner={isOwner}
          canPublish={schema.status === 'draft' && isOwner}
          primaryLabel="Publish"
          primaryPending={publishPending}
          onPrimary={onPublish}
          publishError={publishError}
          onShowGraph={onShowGraph}
        />

        <SchemaTabs>
          <SchemaCanvas
            schemaName={schema.name}
            schemaStatus={schema.status}
            rows={fields.map((f) => ({
              id: f.id,
              slug: f.slug,
              label: f.label,
              logical_type: f.logical_type,
              nullable: f.nullable,
              lifecycle: f.lifecycle,
              selected: f.id === selectedFieldId,
              retired: f.lifecycle === 'retired',
            }))}
            loading={fieldsLoading}
            error={fieldsError}
            emptyLabel="Start building this schema by adding a field from the toolbar below."
            onSelect={onSelectField}
            onAdd={onStartAddField}
            canAdd={canAdd}
          />
        </SchemaTabs>

        {Boolean(retireError) && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(retireError)}
          </p>
        )}
      </div>

      {inspectorOpen ? (
        <FieldPropertiesPanel
          mode={panelMode}
          savedField={activeSavedField}
          pendingField={pendingField}
          draftField={null}
          isOwner={isOwner}
          canAdd={canAdd}
          publishedSchemas={publishedSchemas}
          currentSchemaId={schema.id}
          referenceTargetByFieldId={referenceTargetByFieldId}
          addPending={addPending}
          retirePending={retirePending}
          onDraftChange={() => {}}
          onRemoveDraft={() => {}}
          onPendingChange={onPendingChange}
          onAddField={onAddField}
          onCancelPending={onCancelPending}
          onRetireField={onRetireField}
          onClose={onToggleInspector}
        />
      ) : (
        <div className="flex w-10 shrink-0 justify-center border-l py-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleInspector}
            aria-label="Show field properties"
          >
            <PanelRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {Boolean(addError) && (
        <p role="alert" className="sr-only">
          {errorMessage(addError)}
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

interface SchemaHeaderProps {
  title: string
  status: DatasetSchemaWire['status']
  subtitle?: React.ReactNode
  description: string | null
  editingName?: boolean
  editingSlug?: boolean
  name?: string
  slug?: string
  isOwner: boolean
  canPublish?: boolean
  primaryLabel: string
  primaryPending?: boolean
  primaryDisabled?: boolean
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  onShowGraph?: () => void
  onChangeName?: (value: string) => void
  onChangeSlug?: (value: string) => void
  onChangeDescription?: (value: string) => void
  publishError?: unknown
}

function SchemaHeader({
  title,
  status,
  subtitle,
  description,
  editingName,
  editingSlug,
  name,
  slug,
  isOwner,
  canPublish,
  primaryLabel,
  primaryPending,
  primaryDisabled,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onShowGraph,
  onChangeName,
  onChangeSlug,
  onChangeDescription,
  publishError,
}: SchemaHeaderProps) {
  return (
    <div className="shrink-0 space-y-1 border-b px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Schema name"
                value={name}
                onChange={(e) => onChangeName?.(e.target.value)}
                placeholder="Schema name"
                className="h-8 max-w-xs text-base font-semibold"
              />
              <StatusBadge
                status={status}
                vocabulary={schemaStatusVocabulary}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Database className="size-4 text-violet-500" aria-hidden="true" />
              <h1 className="truncate text-base font-semibold tracking-tight">
                {title}
              </h1>
              <StatusBadge
                status={status}
                vocabulary={schemaStatusVocabulary}
                size="sm"
              />
            </div>
          )}
          {subtitle}
          {!editingName && description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onShowGraph && (
            <Button variant="outline" size="sm" onClick={onShowGraph}>
              <Workflow className="size-3.5" aria-hidden="true" /> Graph
            </Button>
          )}
          <Button variant="outline" size="sm" disabled>
            <Eye className="size-3.5" aria-hidden="true" /> Preview data
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Schema actions">
                <EllipsisVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Schema actions</DropdownMenuLabel>
              <DropdownMenuItem disabled>
                Duplicate as new revision
              </DropdownMenuItem>
              <DropdownMenuItem disabled>Export as JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!isOwner}
                className="text-destructive data-[focus]:text-destructive"
              >
                Delete schema
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {secondaryLabel && (
            <Button variant="outline" size="sm" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            size="sm"
            disabled={
              primaryDisabled ??
              (canPublish === false || Boolean(primaryPending))
            }
            onClick={onPrimary}
          >
            {primaryPending ? 'Working…' : primaryLabel}
          </Button>
        </div>
      </div>

      {(editingName || editingSlug) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {editingSlug && (
            <div className="space-y-1">
              <Label htmlFor="schema-slug" className="text-xs">
                Slug{' '}
                <span className="font-normal text-muted-foreground">
                  (auto-generated from name)
                </span>
              </Label>
              <Input
                id="schema-slug"
                value={slug}
                onChange={(e) => onChangeSlug?.(e.target.value)}
                placeholder="e.g. virus_stability_assay"
                className="h-8 font-mono text-sm"
              />
            </div>
          )}
          <div className={cn('space-y-1', !editingSlug && 'sm:col-span-2')}>
            <Label htmlFor="schema-description" className="text-xs">
              Description
            </Label>
            <Textarea
              id="schema-description"
              value={description ?? ''}
              onChange={(e) => onChangeDescription?.(e.target.value)}
              placeholder="What does this schema measure?"
              rows={1}
              className="min-h-8"
            />
          </div>
        </div>
      )}

      {Boolean(publishError) && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(publishError)}
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

function SchemaTabs({ children }: { children: React.ReactNode }) {
  return (
    <Tabs
      defaultValue="schema"
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <TabsList className="absolute left-0 top-0 z-10 w-fit">
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="records">Records</TabsTrigger>
        <TabsTrigger value="views">Views</TabsTrigger>
        <TabsTrigger value="permissions">Permissions</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent
        value="schema"
        className="absolute inset-x-0 bottom-0 top-10 flex min-h-0 flex-col gap-2"
      >
        {children}
      </TabsContent>
      <TabsContent value="records" className="mt-2">
        <ComingSoonTab label="Records" />
      </TabsContent>
      <TabsContent value="views" className="mt-2">
        <ComingSoonTab label="Saved views" />
      </TabsContent>
      <TabsContent value="permissions" className="mt-2">
        <ComingSoonTab
          label="Permissions"
          hint="Workspace owners can publish and retire fields; members can create drafts."
        />
      </TabsContent>
      <TabsContent value="history" className="mt-2">
        <ComingSoonTab label="Revision history" />
      </TabsContent>
    </Tabs>
  )
}

function ComingSoonTab({ label, hint }: { label: string; hint?: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-1 p-10 text-center text-sm text-muted-foreground">
      <span>{label} are coming soon.</span>
      {hint && <span className="text-xs">{hint}</span>}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Schema canvas — ReactFlow visual field editor                              */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* SCI-011: multi-schema graph canvas                                         */
/* -------------------------------------------------------------------------- */

interface GraphSchemaNodeData extends Record<string, unknown> {
  schema: DatasetSchemaWire
  isSelected: boolean
  onDoubleClick: (id: string) => void
}

type GraphSchemaNode = Node<GraphSchemaNodeData, 'graphSchema'>

const relationshipEdgeColor: Record<RelationshipType, string> = {
  references: '#3b82f6',
  derives_from: '#8b5cf6',
  composed_of: '#10b981',
}

const relationshipTypeOptions: RelationshipType[] = [
  'references',
  'derives_from',
  'composed_of',
]
const cardinalityOptions: RelationshipCardinality[] = [
  'one_to_one',
  'one_to_many',
  'many_to_many',
]

const cardinalityBadge: Record<RelationshipCardinality, string> = {
  one_to_one: '1:1',
  one_to_many: '1:N',
  many_to_many: 'N:M',
}

interface SchemaGraphCanvasProps {
  schemas: DatasetSchemaWire[]
  relationships: DatasetSchemaRelationshipWire[]
  relationshipsLoading: boolean
  relationshipsError: unknown
  selectedId: string | null
  isOwner: boolean
  createPending: boolean
  createError: unknown
  deletePending: boolean
  onSelectSchema: (id: string) => void
  onCreateRelationship: (input: CreateSchemaRelationshipInput) => void
  onDeleteRelationship: (id: string) => void
}

function SchemaGraphCanvas({
  schemas,
  relationships,
  relationshipsLoading,
  relationshipsError,
  selectedId,
  isOwner,
  createPending,
  createError,
  deletePending,
  onSelectSchema,
  onCreateRelationship,
  onDeleteRelationship,
}: SchemaGraphCanvasProps) {
  // One node per slug — latest revision wins (ADR 0035: slug-level graph).
  const latestPerSlug = useMemo(() => {
    const bySlug = new Map<string, DatasetSchemaWire>()
    for (const s of schemas) {
      const prev = bySlug.get(s.slug)
      if (!prev || s.revision > prev.revision) bySlug.set(s.slug, s)
    }
    return bySlug
  }, [schemas])
  const graphSchemas = useMemo(
    () => Array.from(latestPerSlug.values()),
    [latestPerSlug],
  )

  // Pending drag-to-connect: captured connection awaiting the dialog.
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(
    null,
  )
  const [dialogType, setDialogType] = useState<RelationshipType>('references')
  const [dialogLabel, setDialogLabel] = useState('')
  const [dialogCardinality, setDialogCardinality] =
    useState<RelationshipCardinality>('one_to_many')
  const [dialogSourceFieldId, setDialogSourceFieldId] = useState<string | null>(
    null,
  )
  const [dialogTargetFieldId, setDialogTargetFieldId] = useState<string | null>(
    null,
  )
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // SCI-011: load the source/target schema fields for the edge-creation dialog
  // so the caller can attach optional source/target fields (ADR 0035).
  const sourceSchemaId = pendingConnection?.source ?? null
  const targetSchemaId = pendingConnection?.target ?? null
  const sourceFieldsQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.fields(sourceSchemaId ?? 'none'),
    queryFn: () =>
      fetchDatasetSchemaFields(dataClient, sourceSchemaId ?? 'none'),
    enabled: Boolean(sourceSchemaId),
  })
  const targetFieldsQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.fields(targetSchemaId ?? 'none'),
    queryFn: () =>
      fetchDatasetSchemaFields(dataClient, targetSchemaId ?? 'none'),
    enabled: Boolean(targetSchemaId),
  })
  const sourceFields: DatasetSchemaFieldWire[] = sourceFieldsQuery.data || []
  const targetFields: DatasetSchemaFieldWire[] = targetFieldsQuery.data || []

  const nodes: GraphSchemaNode[] = useMemo(
    () =>
      graphSchemas.map((s) => ({
        id: s.id,
        type: 'graphSchema',
        position: { x: 0, y: 0 },
        data: {
          schema: s,
          isSelected: s.id === selectedId,
          onDoubleClick: onSelectSchema,
        },
        draggable: false,
      })),
    [graphSchemas, selectedId, onSelectSchema],
  )

  // Build visible edges: only those whose source/target schema ids are
  // rendered nodes (latest revision per slug). ReactFlow needs stable ids.
  const visibleEdges: Edge[] = useMemo(() => {
    const nodeIds = new Set(graphSchemas.map((s) => s.id))
    // Relationships may point at older revisions; remap to the latest
    // revision of that slug so the edge attaches to the visible node.
    const idToSlug = new Map<string, string>()
    for (const s of schemas) idToSlug.set(s.id, s.slug)
    const slugToLatestId = new Map<string, string>()
    for (const s of graphSchemas) slugToLatestId.set(s.slug, s.id)
    return relationships
      .map((r) => {
        const sourceSlug = idToSlug.get(r.source_schema_id)
        const targetSlug = idToSlug.get(r.target_schema_id)
        const sourceId = sourceSlug
          ? (slugToLatestId.get(sourceSlug) ?? r.source_schema_id)
          : r.source_schema_id
        const targetId = targetSlug
          ? (slugToLatestId.get(targetSlug) ?? r.target_schema_id)
          : r.target_schema_id
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return null
        return {
          id: r.id,
          source: sourceId,
          target: targetId,
          label: `${r.relationship_type} · ${cardinalityBadge[r.cardinality]}`,
          type: 'default',
          animated: r.lifecycle === 'active',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: relationshipEdgeColor[r.relationship_type],
          },
          style: {
            stroke: relationshipEdgeColor[r.relationship_type],
            strokeWidth: 2,
          },
          data: { relationship: r },
        }
      })
      .filter(Boolean) as Edge[]
  }, [relationships, graphSchemas, schemas])

  // dagre layout — compute positions once per node/edge set.
  const layoutedNodes = useMemo(() => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 240 })
    g.setDefaultEdgeLabel(() => ({}))
    const nodeWidth = 240
    const nodeHeight = 96
    for (const n of nodes)
      g.setNode(n.id, { width: nodeWidth, height: nodeHeight })
    for (const e of visibleEdges) g.setEdge(e.source, e.target)
    dagre.layout(g)
    return nodes.map((n) => {
      const pos = g.node(n.id)
      return {
        ...n,
        position: pos
          ? { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 }
          : n.position,
      }
    })
  }, [nodes, visibleEdges])

  function onConnect(conn: Connection) {
    setDialogType('references')
    setDialogLabel('')
    setDialogCardinality('one_to_many')
    setDialogSourceFieldId(null)
    setDialogTargetFieldId(null)
    setPendingConnection(conn)
  }

  function confirmCreate() {
    if (!pendingConnection) return
    onCreateRelationship({
      source_schema_id: pendingConnection.source,
      target_schema_id: pendingConnection.target,
      relationship_type: dialogType,
      label: dialogLabel || undefined,
      cardinality: dialogCardinality,
      source_field_id: dialogSourceFieldId,
      target_field_id: dialogTargetFieldId,
    })
    setPendingConnection(null)
  }

  const selectedEdge = visibleEdges.find((e) => e.id === selectedEdgeId) || null
  const selectedRelationship: DatasetSchemaRelationshipWire | null =
    (
      selectedEdge?.data as
        { relationship?: DatasetSchemaRelationshipWire } | undefined
    )?.relationship ?? null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Workflow className="size-4 text-violet-500" aria-hidden="true" />
          <h1 className="text-base font-semibold tracking-tight">
            Schema relationships
          </h1>
          <span className="text-xs text-muted-foreground">
            {graphSchemas.length} schema
            {graphSchemas.length === 1 ? '' : 's'} · {visibleEdges.length}{' '}
            relationship{visibleEdges.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {relationshipsLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            Loading relationships…
          </div>
        )}
        {Boolean(relationshipsError) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-6 text-center text-sm text-destructive">
            {errorMessage(relationshipsError)}
          </div>
        )}
        {graphSchemas.length === 0 && !relationshipsLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Database
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="max-w-md text-sm text-muted-foreground">
              No historical SCI-010 schemas in this workspace.
            </p>
          </div>
        )}
        <div className="absolute inset-0">
          <ReactFlow
            nodes={layoutedNodes}
            edges={visibleEdges}
            nodeTypes={graphNodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.5}
            panOnDrag
            zoomOnScroll
            proOptions={{ hideAttribution: true }}
            nodesConnectable
            elementsSelectable
            onConnect={onConnect}
            onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            onNodeDoubleClick={(_, n) => {
              const data = n.data
              data.onDoubleClick(n.id)
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              className="bg-muted/20"
            />
            <MiniMap
              pannable
              zoomable
              className="!bg-background !border"
              maskColor="rgba(0,0,0,0.05)"
            />
            <Panel position="top-left">
              <div className="rounded-md border bg-card/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
                <p className="font-medium">
                  Drag from a node’s right handle to another node to create a
                  relationship.
                </p>
                <p className="text-muted-foreground">
                  Double-click a node to zoom into its field editor.
                </p>
              </div>
            </Panel>
            {selectedRelationship && (
              <Panel position="top-right">
                <div className="space-y-2 rounded-md border bg-card/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
                  <p className="font-medium">
                    {selectedRelationship.relationship_type}
                    {selectedRelationship.label
                      ? ': ' + selectedRelationship.label
                      : ''}
                  </p>
                  <p className="text-muted-foreground">
                    Cardinality: {selectedRelationship.cardinality}
                  </p>
                  {isOwner ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deletePending}
                      onClick={() =>
                        setConfirmDeleteId(selectedRelationship.id)
                      }
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {deletePending ? 'Deleting…' : 'Delete relationship'}
                    </Button>
                  ) : (
                    <p className="text-muted-foreground">
                      Only workspace owners can delete relationships.
                    </p>
                  )}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>

      {Boolean(createError) && (
        <p role="alert" className="shrink-0 px-4 py-1 text-sm text-destructive">
          {errorMessage(createError)}
        </p>
      )}

      {/* Edge-creation dialog */}
      <Dialog
        open={Boolean(pendingConnection)}
        onOpenChange={(open) => !open && setPendingConnection(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New schema relationship</DialogTitle>
            <DialogDescription>
              Define how these two schemas relate. You can adjust the type,
              label, and cardinality.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Relationship type</Label>
              <Select
                value={dialogType}
                onChange={(e) =>
                  setDialogType(e.target.value as RelationshipType)
                }
                className="h-8"
              >
                {relationshipTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Label{' '}
                <span className="font-normal text-muted-foreground">
                  (optional, e.g. “measured on”)
                </span>
              </Label>
              <Input
                value={dialogLabel}
                onChange={(e) => setDialogLabel(e.target.value)}
                className="h-8"
                placeholder="measured on"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cardinality</Label>
              <Select
                value={dialogCardinality}
                onChange={(e) =>
                  setDialogCardinality(
                    e.target.value as RelationshipCardinality,
                  )
                }
                className="h-8"
              >
                {cardinalityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Source field{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Select
                value={dialogSourceFieldId ?? ''}
                onChange={(e) => setDialogSourceFieldId(e.target.value || null)}
                className="h-8"
              >
                <option value="">None</option>
                {sourceFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.slug})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Target field{' '}
                <span className="font-normal text-muted-foreground">
                  (optional, usually the target identifier)
                </span>
              </Label>
              <Select
                value={dialogTargetFieldId ?? ''}
                onChange={(e) => setDialogTargetFieldId(e.target.value || null)}
                className="h-8"
              >
                <option value="">None</option>
                {targetFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.slug})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingConnection(null)}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={createPending} onClick={confirmCreate}>
              {createPending ? 'Creating…' : 'Create relationship'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edge-deletion confirmation */}
      <Dialog
        open={Boolean(confirmDeleteId)}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete relationship?</DialogTitle>
            <DialogDescription>
              This soft-deletes the relationship. The schemas and their data are
              not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deletePending}
              onClick={() => {
                if (confirmDeleteId) {
                  onDeleteRelationship(confirmDeleteId)
                  setConfirmDeleteId(null)
                  setSelectedEdgeId(null)
                }
              }}
            >
              {deletePending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const graphNodeTypes = { graphSchema: GraphSchemaNodeComponent }

function GraphSchemaNodeComponent({ data }: NodeProps<GraphSchemaNode>) {
  const { schema, isSelected } = data
  const isDraft = schema.status === 'draft'
  return (
    <div
      className={cn(
        'w-[240px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors',
        isDraft
          ? 'border-dashed border-amber-400/70 opacity-80'
          : 'border-border',
        isSelected && 'ring-2 ring-primary',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Database
            className="size-3.5 shrink-0 text-violet-500"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold">{schema.name}</span>
        </div>
        <StatusBadge
          status={schema.status}
          vocabulary={schemaStatusVocabulary}
          size="sm"
        />
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
        {schema.slug} · rev {schema.revision}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-0 !bg-muted-foreground"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Schema canvas (single-schema zoom view)                                    */
/* -------------------------------------------------------------------------- */

interface FieldRowData {
  id: string
  slug: string
  label: string
  logical_type: ScientificLogicalType
  nullable: boolean
  lifecycle: 'active' | 'retired'
  selected: boolean
  retired: boolean
  incomplete?: boolean
}

interface SchemaNodeData extends Record<string, unknown> {
  schemaName: string
  schemaStatus: DatasetSchemaWire['status']
  rows: FieldRowData[]
  onSelectField: (id: string) => void
}

type SchemaNode = Node<SchemaNodeData, 'schema'>

function SchemaCanvas({
  schemaName,
  schemaStatus,
  rows,
  loading,
  error,
  emptyLabel,
  onSelect,
  onAdd,
  canAdd,
}: {
  schemaName: string
  schemaStatus: DatasetSchemaWire['status']
  rows: FieldRowData[]
  loading?: boolean
  error?: unknown
  emptyLabel: string
  onSelect: (id: string) => void
  onAdd: (type: ScientificLogicalType) => void
  canAdd: boolean
}) {
  const handleSelect = useCallback((id: string) => onSelect(id), [onSelect])

  const nodes: SchemaNode[] = useMemo(
    () => [
      {
        id: 'schema-node',
        type: 'schema',
        position: { x: 120, y: 40 },
        data: {
          schemaName,
          schemaStatus,
          rows,
          onSelectField: handleSelect,
        },
        draggable: false,
      },
    ],
    [schemaName, schemaStatus, rows, handleSelect],
  )

  const edges: Edge[] = []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            Loading fields…
          </div>
        )}
        {Boolean(error) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-6 text-center text-sm text-destructive">
            {errorMessage(error)}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}
        <div className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.5}
            maxZoom={1.5}
            panOnDrag={false}
            zoomOnScroll
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={{ width: '100%', height: '100%' }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              className="bg-muted/20"
            />
            <MiniMap
              pannable
              zoomable
              className="!bg-background !border"
              maskColor="rgba(0,0,0,0.05)"
            />
          </ReactFlow>
        </div>
      </div>

      {/* Add-field toolbar — floating bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2 shadow-sm">
        {canAdd ? (
          <>
            <span className="px-1 text-xs font-medium text-muted-foreground">
              Add field:
            </span>
            {typeShortcuts.map(({ label, type, icon: Icon }) => (
              <Button
                key={type}
                variant="ghost"
                size="sm"
                onClick={() => onAdd(type)}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </>
        ) : (
          <span className="px-1 text-xs text-muted-foreground">
            {rows.length} field{rows.length === 1 ? '' : 's'} · schema is
            published
          </span>
        )}
      </div>
    </div>
  )
}

/** Custom ReactFlow node: renders the schema as a Benchling-style field card. */
const nodeTypes = { schema: SchemaNodeComponent }

function SchemaNodeComponent({ data }: NodeProps<SchemaNode>) {
  const { schemaName, schemaStatus, rows, onSelectField } = data
  return (
    <div className="w-[480px] overflow-hidden rounded-lg border border-border bg-card shadow-md">
      {/* Node header */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Database
            className="size-4 shrink-0 text-violet-500"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold">{schemaName}</span>
        </div>
        <StatusBadge
          status={schemaStatus}
          vocabulary={schemaStatusVocabulary}
          size="sm"
        />
      </div>
      {/* Column header */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="flex-1">Field</span>
          <span className="w-20 shrink-0 text-center">Type</span>
          <span className="w-32 shrink-0 font-mono normal-case">Slug</span>
        </div>
      )}
      {/* Field rows */}
      <div className="max-h-[400px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No fields yet. Add your first field from the toolbar below, then
            select it to configure its properties.
          </p>
        )}
        {rows.map((row) => {
          const Icon = typeIcon[row.logical_type]
          return (
            <button
              key={row.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSelectField(row.id)
              }}
              className={cn(
                'flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50',
                row.selected &&
                  'bg-primary/8 ring-1 ring-inset ring-primary/25',
                row.retired && 'opacity-40',
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <Icon
                  className={cn(
                    'size-3.5 shrink-0',
                    row.incomplete ? 'text-amber-500' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    'truncate text-sm',
                    row.retired && 'line-through',
                  )}
                >
                  {row.label || row.slug || 'Untitled'}
                </span>
                {!row.nullable && (
                  <span className="text-primary" aria-label="Required">
                    *
                  </span>
                )}
                {row.incomplete && (
                  <span
                    className="shrink-0 rounded bg-amber-100 px-1 text-xs font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    title="This field has a slug but no label — add a label in the properties panel"
                  >
                    Needs label
                  </span>
                )}
              </span>
              <span className="w-20 shrink-0 text-center text-xs text-muted-foreground">
                {row.logical_type}
              </span>
              <span className="w-32 shrink-0 truncate font-mono text-xs text-muted-foreground">
                {row.slug || '—'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Properties panel                                                           */
/* -------------------------------------------------------------------------- */

interface FieldPropertiesPanelProps {
  mode: 'none' | 'draft' | 'pending' | 'saved'
  savedField: DatasetSchemaFieldWire | null
  pendingField: DatasetSchemaFieldInput | null
  draftField: DatasetSchemaFieldInput | null
  isOwner: boolean
  canAdd: boolean
  publishedSchemas: DatasetSchemaWire[]
  currentSchemaId: string | null
  referenceTargetByFieldId?: Record<string, string>
  addPending: boolean
  retirePending: boolean
  onDraftChange: (field: DatasetSchemaFieldInput) => void
  onRemoveDraft: () => void
  onPendingChange: (field: DatasetSchemaFieldInput) => void
  onAddField: () => void
  onCancelPending: () => void
  onRetireField: (id: string) => void
  onClose?: () => void
}

function FieldPropertiesPanel(props: FieldPropertiesPanelProps) {
  const {
    mode,
    savedField,
    pendingField,
    draftField,
    isOwner,
    canAdd,
    publishedSchemas,
    currentSchemaId,
    referenceTargetByFieldId,
    addPending,
    retirePending,
    onDraftChange,
    onRemoveDraft,
    onPendingChange,
    onAddField,
    onCancelPending,
    onRetireField,
    onClose,
  } = props

  if (mode === 'none') {
    return (
      <Card className="hidden w-64 shrink-0 self-stretch border-l border-l-border p-4 lg:block">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Select a field to inspect or configure it.
          </p>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Hide field properties"
            >
              <PanelRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </Card>
    )
  }

  // Saved (read-only) field view.
  if (mode === 'saved' && savedField) {
    return (
      <Card className="flex w-64 shrink-0 self-stretch flex-col gap-3 overflow-y-auto border-l border-l-border p-4">
        <PanelHeader
          title={savedField.label || savedField.slug}
          onClose={onClose}
        />
        <Separator />
        <BasicSection
          slug={savedField.slug}
          label={savedField.label}
          type={savedField.logical_type}
          fieldId={savedField.id}
          targetSchemaId={
            savedField.logical_type === 'reference'
              ? (referenceTargetByFieldId?.[savedField.id] ?? null)
              : null
          }
          publishedSchemas={publishedSchemas}
          currentSchemaId={currentSchemaId}
          readOnly
        />
        <ValidationSection
          nullable={savedField.nullable}
          defaultValue={savedField.default_value}
          unit={savedField.unit}
          description={savedField.description ?? ''}
          readOnly
        />
        <AdvancedSection validation={savedField.validation} readOnly />
        {savedField.lifecycle === 'active' && isOwner && (
          <button
            type="button"
            disabled={retirePending}
            onClick={() => onRetireField(savedField.id)}
            className="self-start text-left text-xs text-destructive hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {retirePending ? 'Retiring…' : 'Retire field'}
          </button>
        )}
        {savedField.lifecycle === 'retired' && (
          <p className="text-xs text-muted-foreground">
            This field is retired. Existing data is preserved, but no new values
            can be written.
          </p>
        )}
      </Card>
    )
  }

  // Editable (draft or pending) field view.
  const editable =
    (mode === 'draft' ? draftField : pendingField) ?? emptyField()
  const change = mode === 'draft' ? onDraftChange : onPendingChange

  return (
    <Card className="flex w-64 shrink-0 self-stretch flex-col gap-3 overflow-y-auto border-l border-l-border p-4">
      <PanelHeader
        title={editable.label || editable.slug || 'New field'}
        hint={
          mode === 'pending' ? (
            <Badge variant="outline">New</Badge>
          ) : (
            <StatusBadge
              status="draft"
              vocabulary={schemaStatusVocabulary}
              size="sm"
            />
          )
        }
        onClose={onClose}
      />
      <Separator />
      <BasicSection
        slug={editable.slug}
        label={editable.label}
        type={editable.logical_type}
        targetSchemaId={editable.target_schema_id ?? null}
        publishedSchemas={publishedSchemas}
        currentSchemaId={currentSchemaId}
        onChangeSlug={(v) => change({ ...editable, slug: v })}
        onChangeLabel={(v) => change({ ...editable, label: v })}
        onChangeType={(v) =>
          change({
            ...editable,
            logical_type: v,
            // Clear reference target when leaving the reference type.
            target_schema_id:
              v === 'reference' ? (editable.target_schema_id ?? null) : null,
          })
        }
        onChangeTargetSchema={(v) =>
          change({ ...editable, target_schema_id: v })
        }
      />
      <ValidationSection
        nullable={editable.nullable ?? true}
        defaultValue={editable.default_value}
        unit={editable.unit}
        description={editable.description ?? ''}
        onChangeNullable={(v) => change({ ...editable, nullable: v })}
        onChangeDefault={(v) => change({ ...editable, default_value: v })}
        onChangeUnit={(v) => change({ ...editable, unit: v })}
        onChangeDescription={(v) => change({ ...editable, description: v })}
      />
      <AdvancedSection
        validation={editable.validation ?? {}}
        onChangeValidation={(v) => change({ ...editable, validation: v })}
      />

      {mode === 'pending' && (
        <div className="space-y-2">
          <Button
            disabled={
              !canAdd ||
              !editable.slug.trim() ||
              !editable.label.trim() ||
              addPending
            }
            onClick={onAddField}
            size="sm"
            className="w-full"
          >
            {addPending ? 'Adding…' : 'Add field to schema'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancelPending}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      )}

      {mode === 'draft' && (
        <button
          type="button"
          onClick={onRemoveDraft}
          className="self-start text-left text-xs text-destructive hover:underline"
        >
          Remove field
        </button>
      )}
    </Card>
  )
}

function PanelHeader({
  title,
  hint,
  onClose,
}: {
  title: string
  hint?: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="truncate text-sm font-semibold">{title}</h3>
      <div className="flex items-center gap-1">
        {hint}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Hide field properties"
          >
            <PanelRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Panel sections                                                             */
/* -------------------------------------------------------------------------- */

function BasicSection({
  slug,
  label,
  type,
  fieldId,
  targetSchemaId,
  publishedSchemas,
  currentSchemaId,
  readOnly,
  onChangeSlug,
  onChangeLabel,
  onChangeType,
  onChangeTargetSchema,
}: {
  slug: string
  label: string
  type: ScientificLogicalType
  fieldId?: string
  targetSchemaId?: string | null
  publishedSchemas?: DatasetSchemaWire[]
  currentSchemaId?: string | null
  readOnly?: boolean
  onChangeSlug?: (value: string) => void
  onChangeLabel?: (value: string) => void
  onChangeType?: (value: ScientificLogicalType) => void
  onChangeTargetSchema?: (value: string | null) => void
}) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Basic
      </h4>
      <div className="space-y-1.5">
        <Label htmlFor="fp-slug" className="text-xs">
          Field name (slug)
        </Label>
        <Input
          id="fp-slug"
          value={slug}
          readOnly={readOnly}
          onChange={(e) => onChangeSlug?.(e.target.value)}
          className="h-8 font-mono text-sm"
        />
      </div>
      {fieldId && (
        <div className="space-y-1.5">
          <Label className="text-xs">Field ID</Label>
          <p className="font-mono text-xs text-muted-foreground">
            {fieldId.slice(0, 8)}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="fp-label" className="text-xs">
          Label <span className="text-destructive">*</span>
          <span className="font-normal text-muted-foreground">
            {' '}
            (human-readable name)
          </span>
        </Label>
        <Input
          id="fp-label"
          value={label}
          readOnly={readOnly}
          onChange={(e) => onChangeLabel?.(e.target.value)}
          className={cn(
            'h-8',
            !readOnly &&
              !label.trim() &&
              'border-amber-400 focus-visible:border-amber-500',
          )}
          placeholder="e.g. Sample ID"
        />
        {!readOnly && !label.trim() && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Label is required to save this field.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fp-type" className="text-xs">
          Type
        </Label>
        <Select
          id="fp-type"
          value={type}
          disabled={readOnly}
          className="h-8"
          onChange={(e) =>
            onChangeType?.(e.target.value as ScientificLogicalType)
          }
        >
          {logicalTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </div>
      {type === 'reference' && (
        <div className="space-y-1.5">
          <Label htmlFor="fp-target-schema" className="text-xs">
            Target schema{' '}
            <span className="font-normal text-muted-foreground">
              (referenced dataset)
            </span>
          </Label>
          <Select
            id="fp-target-schema"
            value={targetSchemaId ?? ''}
            disabled={readOnly}
            className="h-8"
            onChange={(e) => onChangeTargetSchema?.(e.target.value || null)}
          >
            <option value="">{readOnly ? '—' : 'Select a schema…'}</option>
            {(publishedSchemas ?? [])
              .filter((s) => s.id !== currentSchemaId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
          </Select>
          {!readOnly && !targetSchemaId && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Pick the schema this field points to.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function ValidationSection({
  nullable,
  defaultValue,
  unit,
  description,
  readOnly,
  onChangeNullable,
  onChangeDefault,
  onChangeUnit,
  onChangeDescription,
}: {
  nullable: boolean
  defaultValue: unknown
  unit: unknown
  description: string
  readOnly?: boolean
  onChangeNullable?: (value: boolean) => void
  onChangeDefault?: (value: unknown) => void
  onChangeUnit?: (value: Record<string, unknown>) => void
  onChangeDescription?: (value: string) => void
}) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Validation
      </h4>
      <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <span className="text-sm">Required</span>
        <Checkbox
          checked={!nullable}
          disabled={readOnly}
          onCheckedChange={(checked) => onChangeNullable?.(checked !== true)}
        />
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="fp-default" className="text-xs">
          Default value
        </Label>
        <Input
          id="fp-default"
          value={defaultToString(defaultValue)}
          readOnly={readOnly}
          onChange={(e) => onChangeDefault?.(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fp-unit" className="text-xs">
          Unit
        </Label>
        <Input
          id="fp-unit"
          value={unitToString(unit)}
          readOnly={readOnly}
          onChange={(e) => onChangeUnit?.({ value: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="fp-description" className="text-xs">
            Description
          </Label>
          <span className="text-xs text-muted-foreground">
            {description.length} chars
          </span>
        </div>
        <Textarea
          id="fp-description"
          value={description}
          readOnly={readOnly}
          rows={2}
          onChange={(e) => onChangeDescription?.(e.target.value)}
        />
      </div>
    </section>
  )
}

function AdvancedSection({
  validation,
  readOnly,
  onChangeValidation,
}: {
  validation: Record<string, unknown>
  readOnly?: boolean
  onChangeValidation?: (value: Record<string, unknown>) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(() => safeStringify(validation))
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="size-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3" aria-hidden="true" />
        )}
        Advanced
      </button>
      {open && (
        <div className="space-y-2">
          <Label htmlFor="fp-validation" className="text-xs">
            Validation rules (JSON)
          </Label>
          <Textarea
            id="fp-validation"
            value={text}
            readOnly={readOnly}
            rows={3}
            className="font-mono text-xs"
            onChange={(e) => {
              setText(e.target.value)
              if (readOnly) return
              const parsed = tryParseJson(e.target.value)
              if (parsed.ok) {
                setError(null)
                onChangeValidation?.(parsed.value as Record<string, unknown>)
              } else {
                setError(parsed.error)
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function unitToString(unit: unknown): string {
  if (unit == null) return ''
  if (typeof unit === 'string') return unit
  if (typeof unit === 'object') {
    const obj = unit as Record<string, unknown>
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.label === 'string') return obj.label
  }
  return ''
}

function defaultToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return safeStringify(value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function tryParseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    }
  }
}
