import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'

import { AppShell } from '#/components/app-shell'
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
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
  DatasetSchemaWire,
} from '#/lib/dataset-schema-data'
import type { ScientificLogicalType } from '#/lib/scientific-sheet-data'

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
const emptyField = (): DatasetSchemaFieldInput => ({
  slug: '',
  label: '',
  logical_type: 'text',
})

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed.'
}

export function SchemaManagementRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showAddField, setShowAddField] = useState(false)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [newFields, setNewFields] = useState<DatasetSchemaFieldInput[]>([
    emptyField(),
  ])
  const [field, setField] = useState<DatasetSchemaFieldInput>(emptyField())

  const schemasQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.list,
    queryFn: () => fetchDatasetSchemas(dataClient),
  })
  const schemas: DatasetSchemaWire[] = schemasQuery.data || []
  const activeId = selectedId || schemas[0]?.id || null
  const selected = schemas.find((schema) => schema.id === activeId)
  const fieldsQuery = useQuery({
    queryKey: datasetSchemaQueryKeys.fields(activeId || 'none'),
    queryFn: () => fetchDatasetSchemaFields(dataClient, activeId || 'none'),
    enabled: Boolean(activeId),
  })
  const fields = fieldsQuery.data || []

  const refreshList = () =>
    queryClient.invalidateQueries({ queryKey: datasetSchemaQueryKeys.list })
  const refreshFields = (schemaId: string) =>
    queryClient.invalidateQueries({
      queryKey: datasetSchemaQueryKeys.fields(schemaId),
    })

  const createMutation = useMutation({
    mutationFn: () =>
      createDatasetSchema(dataClient, {
        slug,
        name,
        description: description || undefined,
        fields: newFields,
      }),
    onSuccess: (result) => {
      setSelectedId(result.schema.id)
      setShowCreate(false)
      setSlug('')
      setName('')
      setDescription('')
      setNewFields([emptyField()])
      void refreshList()
    },
  })
  const addMutation = useMutation({
    mutationFn: () => addDatasetSchemaField(dataClient, selected!.id, field),
    onSuccess: () => {
      setField(emptyField())
      setShowAddField(false)
      void refreshFields(selected!.id)
      void refreshList()
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
  const canAdd = Boolean(
    selected?.status === 'draft' &&
    (isOwner || selected.created_by_user_id === context.user.id),
  )
  const grouped = schemas.reduce<Record<string, DatasetSchemaWire[]>>(
    (groups, schema) => {
      ;(groups[schema.slug] ??= []).push(schema)
      return groups
    },
    {},
  )
  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  return (
    <AppShell
      context={shellContext}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Schemas' }]}
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Dataset schemas
            </h1>
            <p className="text-sm text-muted-foreground">
              Browse and manage reusable workspace dataset definitions.
            </p>
          </div>
          <Button onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Cancel' : 'New schema'}
          </Button>
        </header>

        {showCreate && (
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Create a draft schema</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schema-slug">Slug</Label>
                <Input
                  id="schema-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schema-name">Name</Label>
                <Input
                  id="schema-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schema-description">Description</Label>
              <Textarea
                id="schema-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Fields</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setNewFields((items) => [...items, emptyField()])
                  }
                >
                  Add row
                </Button>
              </div>
              {newFields.map((item, index) => (
                <FieldEditor
                  key={index}
                  field={item}
                  prefix={`new-${index}`}
                  onChange={(next) =>
                    setNewFields((items) =>
                      items.map((old, i) => (i === index ? next : old)),
                    )
                  }
                  onRemove={
                    newFields.length > 1
                      ? () =>
                          setNewFields((items) =>
                            items.filter((_, i) => i !== index),
                          )
                      : undefined
                  }
                />
              ))}
            </div>
            {createMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(createMutation.error)}
              </p>
            )}
            <Button
              disabled={
                !slug.trim() ||
                !name.trim() ||
                newFields.some(
                  (item) => !item.slug.trim() || !item.label.trim(),
                ) ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create schema'}
            </Button>
          </Card>
        )}

        <div className="grid min-h-[28rem] gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="p-3">
            <h2 className="px-2 pb-3 font-semibold">Schema registry</h2>
            {schemasQuery.isLoading && (
              <p className="px-2 text-sm text-muted-foreground">
                Loading schemas…
              </p>
            )}
            {schemasQuery.error && (
              <p role="alert" className="px-2 text-sm text-destructive">
                {errorMessage(schemasQuery.error)}
              </p>
            )}
            {!schemasQuery.isLoading && schemas.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">
                No schemas yet.
              </p>
            )}
            <div className="space-y-4">
              {Object.entries(grouped).map(([groupSlug, revisions]) => (
                <section key={groupSlug} aria-label={`${groupSlug} revisions`}>
                  <p className="px-2 text-xs font-medium uppercase text-muted-foreground">
                    {groupSlug}
                  </p>
                  <div className="mt-1 space-y-1">
                    {revisions.map((schema) => (
                      <button
                        key={schema.id}
                        type="button"
                        aria-label={`Select ${schema.name} revision ${schema.revision}`}
                        onClick={() => {
                          setSelectedId(schema.id)
                          setShowAddField(false)
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${activeId === schema.id ? 'bg-muted' : ''}`}
                      >
                        <span className="truncate">
                          {schema.name}{' '}
                          <span className="text-muted-foreground">
                            r{schema.revision}
                          </span>
                        </span>
                        <StatusBadge status={schema.status} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden p-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Select a schema to inspect its fields.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">{selected.name}</h2>
                      <StatusBadge status={selected.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selected.slug} · revision {selected.revision}
                    </p>
                    {selected.description && (
                      <p className="mt-2 text-sm">{selected.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {canAdd && (
                      <Button
                        variant="outline"
                        onClick={() => setShowAddField((value) => !value)}
                      >
                        Add field
                      </Button>
                    )}
                    {selected.status === 'draft' && isOwner && (
                      <Button
                        disabled={publishMutation.isPending}
                        onClick={() => publishMutation.mutate(selected.id)}
                      >
                        Publish
                      </Button>
                    )}
                  </div>
                </div>
                {publishMutation.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {errorMessage(publishMutation.error)}
                  </p>
                )}
                {showAddField && canAdd && (
                  <div className="space-y-3 rounded-md border p-4">
                    <h3 className="text-sm font-medium">Add a field</h3>
                    <FieldEditor
                      field={field}
                      prefix="add"
                      onChange={setField}
                    />
                    {addMutation.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {errorMessage(addMutation.error)}
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={
                        !field.slug.trim() ||
                        !field.label.trim() ||
                        addMutation.isPending
                      }
                      onClick={() => addMutation.mutate()}
                    >
                      {addMutation.isPending ? 'Adding…' : 'Add field'}
                    </Button>
                  </div>
                )}
                {retireMutation.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {errorMessage(retireMutation.error)}
                  </p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Slug</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Lifecycle</TableHead>
                      <TableHead>Nullable</TableHead>
                      {isOwner && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fieldsQuery.isLoading && (
                      <TableRow>
                        <TableCell colSpan={isOwner ? 6 : 5}>
                          Loading fields…
                        </TableCell>
                      </TableRow>
                    )}
                    {fieldsQuery.error && (
                      <TableRow>
                        <TableCell colSpan={isOwner ? 6 : 5}>
                          <span role="alert" className="text-destructive">
                            {errorMessage(fieldsQuery.error)}
                          </span>
                        </TableCell>
                      </TableRow>
                    )}
                    {!fieldsQuery.isLoading &&
                      !fieldsQuery.error &&
                      fields.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={isOwner ? 6 : 5}
                            className="text-muted-foreground"
                          >
                            No fields.
                          </TableCell>
                        </TableRow>
                      )}
                    {fields.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">
                          {item.slug}
                        </TableCell>
                        <TableCell>{item.label}</TableCell>
                        <TableCell>{item.logical_type}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.lifecycle}</Badge>
                        </TableCell>
                        <TableCell>{item.nullable ? 'Yes' : 'No'}</TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            {item.lifecycle === 'active' && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={retireMutation.isPending}
                                aria-label={`Retire field ${item.label}`}
                                onClick={() => retireMutation.mutate(item.id)}
                              >
                                Retire
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  )
}

function StatusBadge({ status }: { status: DatasetSchemaWire['status'] }) {
  return (
    <Badge variant={status === 'published' ? 'default' : 'outline'}>
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  )
}

function FieldEditor({
  field,
  prefix,
  onChange,
  onRemove,
}: {
  field: DatasetSchemaFieldInput
  prefix: string
  onChange: (field: DatasetSchemaFieldInput) => void
  onRemove?: () => void
}) {
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-slug`}>Slug</Label>
        <Input
          id={`${prefix}-slug`}
          value={field.slug}
          onChange={(event) => onChange({ ...field, slug: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-label`}>Label</Label>
        <Input
          id={`${prefix}-label`}
          value={field.label}
          onChange={(event) =>
            onChange({ ...field, label: event.target.value })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-type`}>Logical type</Label>
        <Select
          id={`${prefix}-type`}
          value={field.logical_type}
          onChange={(event) =>
            onChange({
              ...field,
              logical_type: event.target.value as ScientificLogicalType,
            })
          }
        >
          {logicalTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove field ${field.label || field.slug || prefix}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      )}
    </div>
  )
}
