import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useCallback, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import type { NodeProps, Node, Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronDown,
  ChevronRight,
  Database,
  EllipsisVertical,
  Eye,
  Hash,
  Layers,
  Plus,
  Tag,
  ToggleLeft,
  Trash2,
  Type as TypeIcon,
  Calendar,
  PanelLeft,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusVocabulary } from '#/components/scientific/status-badge'
import {
  Badge,
  Button,
  Card,
  Checkbox,
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
  datasetSchemaQueryKeys,
  fetchDatasetSchemaFields,
  fetchDatasetSchemas,
  publishDatasetSchema,
  retireDatasetSchemaField,
} from '#/lib/dataset-schema-data'
import type {
  DatasetSchemaFieldInput,
  DatasetSchemaFieldWire,
  DatasetSchemaWire,
} from '#/lib/dataset-schema-data'
import type { ScientificLogicalType } from '#/lib/scientific-sheet-data'
import { cn } from '#/lib/utils'

const getSchemaContext = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  return getCurrentContext(getRequestHeaders())
})

export const Route = createFileRoute('/schemas')({
  beforeLoad: async () => {
    const context = await getSchemaContext()
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: SchemaManagementRoute,
})

const dataClient = createDataClient()

const logicalTypes: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

const typeIcon: Record<ScientificLogicalType, LucideIcon> = {
  text: TypeIcon,
  integer: Hash,
  decimal: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  timestamp: Calendar,
  category: Tag,
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
})

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed.'
}

type EditorMode = 'view' | 'create'

export function SchemaManagementRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<EditorMode>('view')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [registryOpen, setRegistryOpen] = useState(true)

  // Create-mode draft state.
  const [draftName, setDraftName] = useState('')
  const [draftSlug, setDraftSlug] = useState('')
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

  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: datasetSchemaQueryKeys.list })
  const refreshFields = (schemaId: string) =>
    queryClient.invalidateQueries({
      queryKey: datasetSchemaQueryKeys.fields(schemaId),
    })

  const createMutation = useMutation({
    mutationFn: () =>
      createDatasetSchema(dataClient, {
        slug: draftSlug,
        name: draftName,
        description: draftDescription || undefined,
        fields: draftFields.filter((f) => f.slug.trim() && f.label.trim()),
      }),
    onSuccess: (result) => {
      setMode('view')
      setSelectedId(result.schema.id)
      setRegistryOpen(false)
      resetDraft()
      void refreshList()
    },
  })
  const addMutation = useMutation({
    mutationFn: () =>
      addDatasetSchemaField(dataClient, selected!.id, pendingField!),
    onSuccess: () => {
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
    onSuccess: () => void refreshList(),
  })
  const retireMutation = useMutation({
    mutationFn: (fieldId: string) =>
      retireDatasetSchemaField(dataClient, fieldId),
    onSuccess: () => selected && void refreshFields(selected.id),
  })

  const isOwner = context.workspace?.role === 'owner'
  const canAddToSelected = Boolean(
    selected?.status === 'draft' &&
    (isOwner || selected.created_by_user_id === context.user.id),
  )

  function resetDraft() {
    setDraftName('')
    setDraftSlug('')
    setDraftDescription('')
    setDraftFields([emptyField()])
    setDraftSelected(0)
  }

  function startCreate() {
    resetDraft()
    setPendingField(null)
    setSelectedFieldId(null)
    setRegistryOpen(false)
    setMode('create')
  }

  function selectSchema(id: string) {
    setMode('view')
    setSelectedId(id)
    setPendingField(null)
    setSelectedFieldId(null)
    setRegistryOpen(false)
  }

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

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        { label: 'Data Models' },
        ...(headerTitle ? [{ label: headerTitle }] : []),
      ]}
    >
      <div className="flex h-[calc(100svh-6.5rem)] min-h-0 gap-0 overflow-hidden">
        {/* Schema registry — collapsible */}
        {registryOpen ? (
          <Card className="flex h-full min-h-0 w-60 shrink-0 flex-col rounded-r-none border-r p-0">
            <div className="flex items-center justify-between border-b px-3 py-2.5">
              <h2 className="text-sm font-semibold">Schemas</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startCreate}
                  className="px-1.5"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
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
                    No schemas yet.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={startCreate}
                  >
                    <Plus className="size-3.5" aria-hidden="true" /> New schema
                  </Button>
                </div>
              )}
              <div className="space-y-4">
                {Object.entries(grouped).map(([groupSlug, revisions]) => (
                  <section
                    key={groupSlug}
                    aria-label={`${groupSlug} revisions`}
                  >
                    <p className="px-1.5 pb-1 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                          <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
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
          </Card>
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
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 p-3 pl-3">
          {mode === 'create' ? (
            <CreateSchemaEditor
              name={draftName}
              slug={draftSlug}
              description={draftDescription}
              fields={draftFields}
              selectedIndex={draftSelected}
              isOwner={isOwner}
              createPending={createMutation.isPending}
              createError={createMutation.error}
              onChangeName={setDraftName}
              onChangeSlug={setDraftSlug}
              onChangeDescription={setDraftDescription}
              onChangeField={(next, index) =>
                setDraftFields((items) =>
                  items.map((old, i) => (i === index ? next : old)),
                )
              }
              onSelectField={setDraftSelected}
              onAddField={(type) =>
                setDraftFields((items) => {
                  const next = [...items, emptyField(type)]
                  setDraftSelected(next.length - 1)
                  return next
                })
              }
              onRemoveField={(index) =>
                setDraftFields((items) => {
                  const next = items.filter((_, i) => i !== index)
                  setDraftSelected(
                    Math.max(0, Math.min(index, next.length - 1)),
                  )
                  return next.length ? next : [emptyField()]
                })
              }
              onCancel={() => {
                setMode('view')
                setRegistryOpen(true)
                resetDraft()
              }}
              onSave={() => createMutation.mutate()}
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
            />
          ) : (
            <EmptyState onStartCreate={startCreate} />
          )}
        </div>
      </div>
    </AppShell>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState({ onStartCreate }: { onStartCreate: () => void }) {
  return (
    <Card className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <Database className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">No schema selected</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Dataset schemas are reusable, versioned definitions of the columns a
        sheet measures. Define fields once here, then bind sheets to a schema so
        cross-sheet queries union rows by stable field slug.
      </p>
      <Button onClick={onStartCreate}>
        <Plus className="size-4" aria-hidden="true" /> New schema
      </Button>
    </Card>
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
}

function CreateSchemaEditor({
  name,
  slug,
  description,
  fields,
  selectedIndex,
  isOwner,
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
}: CreateSchemaEditorProps) {
  const selectedField = fields[selectedIndex] ?? null
  const canSave =
    slug.trim() !== '' &&
    name.trim() !== '' &&
    fields.some((f) => f.slug.trim() && f.label.trim()) &&
    !createPending

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
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

      <FieldPropertiesPanel
        mode={fields.length > 0 ? 'draft' : 'none'}
        savedField={null}
        pendingField={null}
        draftField={selectedField}
        isOwner={isOwner}
        canAdd
        addPending={false}
        retirePending={false}
        onDraftChange={(next) => onChangeField(next, selectedIndex)}
        onRemoveDraft={() => onRemoveField(selectedIndex)}
        onPendingChange={() => {}}
        onAddField={() => {}}
        onCancelPending={() => {}}
        onRetireField={() => {}}
      />
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
}: SchemaEditorProps) {
  const activeSavedField = fields.find((f) => f.id === selectedFieldId) || null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
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

      <FieldPropertiesPanel
        mode={panelMode}
        savedField={activeSavedField}
        pendingField={pendingField}
        draftField={null}
        isOwner={isOwner}
        canAdd={canAdd}
        addPending={addPending}
        retirePending={retirePending}
        onDraftChange={() => {}}
        onRemoveDraft={() => {}}
        onPendingChange={onPendingChange}
        onAddField={onAddField}
        onCancelPending={onCancelPending}
        onRetireField={onRetireField}
      />

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
  onChangeName,
  onChangeSlug,
  onChangeDescription,
  publishError,
}: SchemaHeaderProps) {
  return (
    <div className="shrink-0 space-y-2 border-b pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
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
        </div>
        <div className="flex items-center gap-2">
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

      {(editingName || editingSlug || description !== null) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {editingSlug && (
            <div className="space-y-1">
              <Label htmlFor="schema-slug" className="text-xs">
                Slug
              </Label>
              <Input
                id="schema-slug"
                value={slug}
                onChange={(e) => onChangeSlug?.(e.target.value)}
                placeholder="e.g. virus-stability-assay"
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
    <Tabs defaultValue="schema" className="relative flex-1 overflow-hidden">
      <TabsList className="absolute left-0 top-0 z-10 w-fit">
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="records">Records</TabsTrigger>
        <TabsTrigger value="views">Views</TabsTrigger>
        <TabsTrigger value="permissions">Permissions</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent
        value="schema"
        className="absolute inset-0 top-10 flex flex-col gap-2"
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

interface FieldRowData {
  id: string
  slug: string
  label: string
  logical_type: ScientificLogicalType
  nullable: boolean
  lifecycle: 'active' | 'retired'
  selected: boolean
  retired: boolean
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
        position: { x: 80, y: 60 },
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
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      <Card className="relative h-full min-h-0 flex-1 overflow-hidden p-0">
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
        <ReactFlow
          className="!absolute !inset-0 !h-full !w-full"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.5}
          maxZoom={1.5}
          panOnDrag
          zoomOnScroll
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
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
      </Card>

      {/* Add-field toolbar — floating bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2 shadow-sm">
        {canAdd ? (
          <>
            <span className="px-1 text-[11px] font-medium text-muted-foreground">
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
          <span className="px-1 text-[11px] text-muted-foreground">
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
    <div className="w-96 rounded-lg border border-border bg-card shadow-md">
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
                'flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/50',
                row.selected &&
                  'bg-primary/8 ring-1 ring-inset ring-primary/25',
                row.retired && 'opacity-40',
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
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
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Icon className="size-3" aria-hidden="true" />
                <span className="font-mono">{row.slug || '—'}</span>
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
  addPending: boolean
  retirePending: boolean
  onDraftChange: (field: DatasetSchemaFieldInput) => void
  onRemoveDraft: () => void
  onPendingChange: (field: DatasetSchemaFieldInput) => void
  onAddField: () => void
  onCancelPending: () => void
  onRetireField: (id: string) => void
}

function FieldPropertiesPanel(props: FieldPropertiesPanelProps) {
  const {
    mode,
    savedField,
    pendingField,
    draftField,
    isOwner,
    canAdd,
    addPending,
    retirePending,
    onDraftChange,
    onRemoveDraft,
    onPendingChange,
    onAddField,
    onCancelPending,
    onRetireField,
  } = props

  if (mode === 'none') {
    return (
      <Card className="hidden w-72 shrink-0 self-stretch p-4 lg:block">
        <p className="text-sm text-muted-foreground">
          Select a field to inspect or configure it.
        </p>
      </Card>
    )
  }

  // Saved (read-only) field view.
  if (mode === 'saved' && savedField) {
    return (
      <Card className="flex w-72 shrink-0 self-stretch flex-col gap-3 overflow-y-auto p-4">
        <PanelHeader title={savedField.label || savedField.slug} />
        <Separator />
        <BasicSection
          slug={savedField.slug}
          label={savedField.label}
          type={savedField.logical_type}
          fieldId={savedField.id}
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
    <Card className="flex w-72 shrink-0 self-stretch flex-col gap-3 overflow-y-auto p-4">
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
      />
      <Separator />
      <BasicSection
        slug={editable.slug}
        label={editable.label}
        type={editable.logical_type}
        onChangeSlug={(v) => change({ ...editable, slug: v })}
        onChangeLabel={(v) => change({ ...editable, label: v })}
        onChangeType={(v) => change({ ...editable, logical_type: v })}
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
}: {
  title: string
  hint?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="truncate text-sm font-semibold">{title}</h3>
      {hint}
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
  readOnly,
  onChangeSlug,
  onChangeLabel,
  onChangeType,
}: {
  slug: string
  label: string
  type: ScientificLogicalType
  fieldId?: string
  readOnly?: boolean
  onChangeSlug?: (value: string) => void
  onChangeLabel?: (value: string) => void
  onChangeType?: (value: ScientificLogicalType) => void
}) {
  return (
    <section className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          Label
        </Label>
        <Input
          id="fp-label"
          value={label}
          readOnly={readOnly}
          onChange={(e) => onChangeLabel?.(e.target.value)}
          className="h-8"
        />
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
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          <span className="text-[10px] text-muted-foreground">
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
        className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
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
