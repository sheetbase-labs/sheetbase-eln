/**
 * REG-002: Samples Registry route.
 *
 * The first production consumer of the reusable RegistryComposition. Wires
 * server-side pagination/sort/filter (RegistryQuery → PostgREST on
 * `records` where kind='sample'), summary metrics, a Samples inspector with
 * chain-of-custody, linked experiments and files, and the controlled
 * receive/consume/transfer/edit/archive/restore mutations. PostgreSQL RLS
 * remains the access-control boundary; the RPCs enforce quantity and
 * location integrity.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { PackagePlus, Upload } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ImportWizard } from '#/components/import/import-wizard'
import { RegistryComposition } from '#/components/registry/registry-composition'
import type { DataGridField } from '#/components/data-grid'
import { SampleInspector } from '#/components/samples/sample-inspector'
import type { SampleCustodyAction } from '#/components/samples/sample-inspector'
import { StatusBadge } from '#/components/scientific/status-badge'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  fetchModelFields,
  modelFieldValuesFromInput,
  modelFieldColumnId,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import {
  archiveSample,
  consumeSample,
  computeSampleSummaries,
  createSample,
  describeSampleError,
  editSample,
  fetchLinkedExperiments,
  fetchLinkedFiles,
  fetchSample,
  fetchSampleEvents,
  fetchSamplesPage,
  isLowStock,
  receiveSample,
  restoreSample,
  sampleColumns,
  sampleQueryKeys,
  sampleStatusOptions,
  transferSample,
} from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import {
  decodeRegistryFilters,
  decodeRegistryQuery,
  DEFAULT_REGISTRY_QUERY,
  encodeRegistryFilters,
} from '#/lib/registry'
import type { RegistryQuery } from '#/lib/registry'

const DEFAULT_SAMPLES_QUERY: RegistryQuery = {
  ...DEFAULT_REGISTRY_QUERY,
  pageSize: 50,
  grouping: ['sampleType'],
}

export function searchFromSamplesQuery(
  query: RegistryQuery,
  selected?: string | null,
) {
  return {
    page: query.pageIndex > 0 ? query.pageIndex : undefined,
    size:
      query.pageSize !== DEFAULT_SAMPLES_QUERY.pageSize
        ? query.pageSize
        : undefined,
    sort:
      query.sorting.length > 0
        ? query.sorting
            .map(({ id, desc }) => `${id}:${desc ? 'desc' : 'asc'}`)
            .join(',')
        : undefined,
    group: query.grouping.join(','),
    filters: encodeRegistryFilters(query.filters) || undefined,
    selected: selected || undefined,
    rq: undefined,
  }
}

export const Route = createFileRoute('/samples')({
  staticData: { shellFullBleed: true },
  validateSearch: (search: Record<string, unknown>) => {
    const page = Number(search.page)
    const size = Number(search.size)
    return {
      page: Number.isInteger(page) && page > 0 ? page : undefined,
      size:
        Number.isInteger(size) && size > 0 && size <= 500 && size !== 50
          ? size
          : undefined,
      sort: typeof search.sort === 'string' ? search.sort : undefined,
      group: typeof search.group === 'string' ? search.group : undefined,
      filters: typeof search.filters === 'string' ? search.filters : undefined,
      selected:
        typeof search.selected === 'string' ? search.selected : undefined,
      rq: typeof search.rq === 'string' ? search.rq : undefined,
    }
  },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SamplesRegistryRoute,
})

const dataClient = createDataClient()

function SamplesRegistryRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const query = useMemo(
    (): RegistryQuery =>
      decodeRegistryQuery(search.rq) ?? {
        pageIndex: search.page ?? 0,
        pageSize: search.size ?? DEFAULT_SAMPLES_QUERY.pageSize,
        sorting: (search.sort ?? '')
          .split(',')
          .filter(Boolean)
          .map((entry) => {
            const [id, direction] = entry.split(':')
            return { id, desc: direction === 'desc' }
          }),
        grouping: search.group ? search.group.split(',').filter(Boolean) : [],
        filters: decodeRegistryFilters(search.filters),
      },
    [
      search.filters,
      search.group,
      search.page,
      search.rq,
      search.size,
      search.sort,
    ],
  )
  const selectedId = search.selected ?? null
  const [actionError, setActionError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  function setQuery(next: RegistryQuery) {
    void navigate({
      to: '/samples',
      search: searchFromSamplesQuery(next, selectedId),
      replace: false,
    })
  }

  function setSelectedId(id: string | null) {
    void navigate({
      to: '/samples',
      search: searchFromSamplesQuery(query, id),
      replace: false,
    })
  }

  useEffect(() => {
    if (!search.rq) return
    void navigate({
      to: '/samples',
      search: searchFromSamplesQuery(query, selectedId),
      replace: true,
    })
  }, [navigate, query, search.rq, selectedId])

  // ---- Registry page query ----
  const pageQuery = useQuery({
    queryKey: sampleQueryKeys.page(query),
    queryFn: () => fetchSamplesPage(notebookDataClient, query),
  })

  const { rows, totalCount } = pageQuery.data ?? { rows: [], totalCount: 0 }
  const modelFieldsQuery = useQuery({
    queryKey: ['model-fields', 'sample'],
    queryFn: () => fetchModelFields(notebookDataClient, 'sample'),
  })
  const modelFields = modelFieldsQuery.data ?? []
  const summaries = useMemo(
    () => computeSampleSummaries(rows, totalCount),
    [rows, totalCount],
  )

  // ---- Selected sample detail (loaded independently of the page) ----
  const selectedInPage = selectedId
    ? (rows.find((r) => r.id === selectedId) ?? null)
    : null
  const selectedDetailQuery = useQuery({
    queryKey: sampleQueryKeys.detail(selectedId ?? 'none'),
    queryFn: () => fetchSample(notebookDataClient, selectedId!),
    enabled: Boolean(selectedId) && !selectedInPage,
  })
  const selectedRecord: SampleRecord | null =
    selectedInPage ?? selectedDetailQuery.data ?? null

  const eventsQuery = useQuery({
    queryKey: sampleQueryKeys.events(selectedId ?? 'none'),
    queryFn: () => fetchSampleEvents(notebookDataClient, selectedId!),
    enabled: Boolean(selectedId),
  })
  const experimentsQuery = useQuery({
    queryKey: sampleQueryKeys.links(selectedId ?? 'none'),
    queryFn: async () => {
      const [experiments, files] = await Promise.all([
        fetchLinkedExperiments(notebookDataClient, selectedId!),
        fetchLinkedFiles(notebookDataClient, selectedId!),
      ])
      return { experiments, files }
    },
    enabled: Boolean(selectedId),
  })

  // ---- Projects for the create form ----
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: () =>
      notebookDataClient.list<{ id: string; key: string; title: string }>(
        'projects',
        '?order=created_at.desc&select=id,key,title',
      ),
  })

  // ---- Mutations ----
  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ['reg-002', 'samples'] })
  }

  const [createError, setCreateError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async (input: {
      projectId: string
      title: string
      properties: CreateSampleForm
      customFields: Record<string, unknown>
    }) => {
      const qty =
        input.properties.quantity === ''
          ? undefined
          : Number(input.properties.quantity)
      const threshold =
        input.properties.lowStockThreshold === ''
          ? undefined
          : Number(input.properties.lowStockThreshold)
      return createSample(dataClient, {
        projectId: input.projectId,
        title: input.title,
        properties: {
          sampleType: input.properties.sampleType || undefined,
          quantity: qty,
          quantityUnit: input.properties.quantityUnit || undefined,
          storageLocation: input.properties.storageLocation || undefined,
          barcode: input.properties.barcode || undefined,
          lowStockThreshold: threshold,
          notes: input.properties.notes || undefined,
        },
        customFields: input.customFields,
      })
    },
    onSuccess: (record) => {
      setCreateError(null)
      setCreateOpen(false)
      invalidateAll()
      setSelectedId(record.id)
    },
    onError: (error) => {
      setCreateError(describeSampleError(error))
    },
  })

  const custodyMutation = useMutation({
    mutationFn: async (action: SampleCustodyAction & { recordId: string }) => {
      const { recordId, ...rest } = action
      const expected = selectedRecord?.metadataVersion ?? 0
      switch (rest.kind) {
        case 'receive':
          return receiveSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
        case 'consume':
          return consumeSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
        case 'transfer':
          return transferSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
        case 'edit':
          return editSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
        case 'archive':
          return archiveSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
        case 'restore':
          return restoreSample(dataClient, {
            recordId,
            expectedMetadataVersion: expected,
            ...rest,
          })
      }
    },
    onSuccess: () => {
      setActionError(null)
      invalidateAll()
    },
    onError: (error) => setActionError(describeSampleError(error)),
  })

  // ---- Columns with status + low-stock rendering ----
  const columns = useMemo(() => {
    const cols = sampleColumns<SampleRecord>(modelFields)
    // Replace the plain status column with a StatusBadge cell.
    const statusIdx = cols.findIndex((c) => c.id === 'status')
    if (statusIdx >= 0) {
      cols[statusIdx] = {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge status={row.original.status} domain="sample" />
            {isLowStock(row.original) ? (
              <span className="text-xs font-medium text-warning">Low</span>
            ) : null}
          </span>
        ),
      }
    }
    return cols
  }, [modelFields])

  const fields: DataGridField<SampleRecord>[] = columns.map((column) => {
    const id = String(
      column.id ?? ('accessorKey' in column ? column.accessorKey : ''),
    )
    const labels: Partial<Record<string, string>> = {
      identifier: 'Sample ID',
      title: 'Title',
      sampleType: 'Type',
      quantity: 'Quantity',
      storageLocation: 'Storage',
      barcode: 'Barcode',
      status: 'Status',
      updatedAt: 'Updated',
    }
    const customOperator: 'contains' | 'eq' =
      modelFields.find((field) => modelFieldColumnId(field.fieldName) === id)
        ?.logicalType === 'text'
        ? 'contains'
        : 'eq'
    const filter =
      id === 'status'
        ? {
            type: 'select' as const,
            operators: [{ value: 'eq' as const, label: 'is' }],
            options: sampleStatusOptions(),
          }
        : id.startsWith('custom:')
          ? {
              type: 'text' as const,
              placeholder: `All ${(labels[id] ?? id).toLowerCase()}`,
              operators: [
                {
                  value: customOperator,
                  label: 'is',
                },
              ],
            }
          : ['sampleType', 'storageLocation', 'barcode'].includes(id)
            ? {
                type: 'text' as const,
                placeholder: `All ${(labels[id] ?? id).toLowerCase()}`,
                operators: [{ value: 'contains' as const, label: 'contains' }],
              }
            : undefined
    return {
      id,
      label:
        labels[id] ??
        modelFields.find((field) => modelFieldColumnId(field.fieldName) === id)
          ?.label ??
        id,
      column,
      filter,
      groupable:
        ['status', 'sampleType', 'storageLocation'].includes(id) ||
        id.startsWith('custom:'),
    }
  })
  fields.push({
    id: 'search',
    label: 'Search',
    column: false,
    groupable: false,
    filter: {
      type: 'text',
      placeholder: 'Identifier, title, barcode',
      operators: [{ value: 'contains', label: 'contains' }],
    },
  })

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  const inspector = (row: SampleRecord | null) =>
    row ? (
      <SampleInspector
        sample={row}
        events={eventsQuery.data ?? []}
        eventsLoading={eventsQuery.isLoading}
        linkedExperiments={experimentsQuery.data?.experiments ?? []}
        linkedFiles={experimentsQuery.data?.files ?? []}
        linksLoading={experimentsQuery.isLoading}
        actionPending={custodyMutation.isPending}
        actionError={actionError}
        onAction={(action) =>
          custodyMutation.mutate({ recordId: row.id, ...action })
        }
        modelFields={modelFields}
      />
    ) : (
      <SampleInspector
        sample={null}
        events={[]}
        linkedExperiments={[]}
        linkedFiles={[]}
        onAction={() => {}}
        modelFields={modelFields}
      />
    )

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Samples' }],
  })

  return (
    <>
      <div className="flex h-full flex-col gap-3 overflow-hidden p-4 md:p-6">
        <RegistryComposition
          registryId="samples"
          title="Samples"
          description="Find samples, check stock and record use or transfers."
          rows={rows}
          totalCount={totalCount}
          fields={fields}
          query={query}
          onQueryChange={setQuery}
          getRowId={(row) => row.id}
          selectedId={selectedId}
          selectedRecord={selectedRecord}
          onSelectedIdChange={setSelectedId}
          summaries={summaries}
          renderInspector={inspector}
          inspectorLabel="Sample details"
          initialColumnVisibility={{ barcode: false }}
          searchDebounceMs={250}
          loading={pageQuery.isLoading}
          error={pageQuery.error}
          onRetry={() => pageQuery.refetch()}
          emptyTitle="No samples yet"
          noResultsTitle="No matching samples"
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImportOpen(true)}
                disabled={(projectsQuery.data ?? []).length === 0}
              >
                <Upload className="size-3.5" /> Import
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setCreateError(null)
                  setCreateOpen(true)
                }}
              >
                <PackagePlus className="size-3.5" /> New sample
              </Button>
            </>
          }
        />
        <CreateSampleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projects={projectsQuery.data ?? []}
          projectsLoading={projectsQuery.isLoading}
          projectsError={projectsQuery.isError}
          onRetryProjects={() => void projectsQuery.refetch()}
          pending={createMutation.isPending}
          error={createError}
          onCreate={(input) => createMutation.mutate(input)}
          modelFields={modelFields}
        />
        {projectsQuery.data?.[0] ? (
          <ImportWizard
            open={importOpen}
            onOpenChange={setImportOpen}
            client={dataClient}
            mode={{
              kind: 'record',
              projectId: projectsQuery.data[0].id,
              projects: projectsQuery.data,
              modelKey: 'sample',
              recordKind: 'sample',
              fields: modelFields,
            }}
            onDone={invalidateAll}
          />
        ) : null}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Create-sample dialog.
// ---------------------------------------------------------------------------

interface CreateSampleForm {
  projectId: string
  title: string
  sampleType: string
  quantity: string
  quantityUnit: string
  storageLocation: string
  barcode: string
  lowStockThreshold: string
  notes: string
}

const EMPTY_FORM: CreateSampleForm = {
  projectId: '',
  title: '',
  sampleType: '',
  quantity: '',
  quantityUnit: '',
  storageLocation: '',
  barcode: '',
  lowStockThreshold: '',
  notes: '',
}

export function CreateSampleDialog({
  open,
  onOpenChange,
  projects,
  projectsLoading,
  projectsError = false,
  onRetryProjects,
  pending,
  error,
  onCreate,
  modelFields,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; key: string; title: string }[]
  projectsLoading: boolean
  projectsError?: boolean
  onRetryProjects?: () => void
  pending: boolean
  error: string | null
  onCreate: (input: {
    projectId: string
    title: string
    properties: CreateSampleForm
    customFields: Record<string, unknown>
  }) => void
  modelFields: ModelFieldDefinition[]
}) {
  const [form, setForm] = useState<CreateSampleForm>(EMPTY_FORM)
  const [customFields, setCustomFields] = useState<
    Record<string, string | boolean>
  >({})

  function update(field: keyof CreateSampleForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM)
      setCustomFields({})
    }
  }, [open])

  const projectId =
    form.projectId || (projects.length === 1 ? projects[0].id : '')
  const invalidQuantity = [form.quantity, form.lowStockThreshold].some(
    (value) =>
      value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0),
  )

  function submit() {
    if (
      pending ||
      !projectId ||
      !form.title.trim() ||
      invalidQuantity ||
      missingRequiredModelField
    )
      return
    onCreate({
      projectId,
      title: form.title.trim(),
      properties: form,
      customFields: modelFieldValuesFromInput(modelFields, customFields, true),
    })
  }

  const missingRequiredModelField = modelFields.some(
    (definition) =>
      !definition.nullable &&
      definition.defaultValue == null &&
      (customFields[definition.fieldName] ?? '') === '',
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New sample</DialogTitle>
          <DialogDescription>
            Name the sample and choose its project. Add stock and storage
            details now, or fill them in later.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-sample-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="grid gap-3"
        >
          <Label className="text-xs text-muted-foreground">
            Project (required)
            <Select
              value={projectId}
              onChange={(e) => update('projectId', e.target.value)}
              className="mt-1 h-9"
              aria-label="Project"
              required
              disabled={projectsLoading || projectsError || pending}
            >
              <option value="">
                {projectsLoading ? 'Loading…' : 'Select a project'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Label>
          {projectsError ? (
            <div role="alert" className="text-sm text-danger">
              Could not load projects.
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onRetryProjects}
              >
                Try again
              </Button>
            </div>
          ) : !projectsLoading && projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a project before adding samples.
            </p>
          ) : null}
          <Label className="text-xs text-muted-foreground">
            Sample name (required)
            <Input
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className="mt-1 h-9"
              aria-label="Sample name"
              required
              placeholder="Plasma pool batch 14"
            />
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label className="text-xs text-muted-foreground">
              Type
              <Input
                value={form.sampleType}
                onChange={(e) => update('sampleType', e.target.value)}
                className="mt-1 h-9"
                aria-label="Sample type"
                placeholder="plasma"
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Barcode
              <Input
                value={form.barcode}
                onChange={(e) => update('barcode', e.target.value)}
                className="mt-1 h-9"
                aria-label="Barcode"
              />
            </Label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Label className="text-xs text-muted-foreground">
              Quantity
              <Input
                type="number"
                step="any"
                min="0"
                value={form.quantity}
                onChange={(e) => update('quantity', e.target.value)}
                className="mt-1 h-9"
                aria-label="Quantity"
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Unit
              <Input
                value={form.quantityUnit}
                onChange={(e) => update('quantityUnit', e.target.value)}
                className="mt-1 h-9"
                aria-label="Unit"
                placeholder="mL"
              />
            </Label>
            <Label className="text-xs text-muted-foreground">
              Low-stock at{form.quantityUnit ? ` (${form.quantityUnit})` : ''}
              <Input
                type="number"
                step="any"
                min="0"
                value={form.lowStockThreshold}
                onChange={(e) => update('lowStockThreshold', e.target.value)}
                className="mt-1 h-9"
                aria-label="Low-stock threshold"
              />
            </Label>
          </div>
          <Label className="text-xs text-muted-foreground">
            Storage location
            <Input
              value={form.storageLocation}
              onChange={(e) => update('storageLocation', e.target.value)}
              className="mt-1 h-9"
              aria-label="Storage location"
              placeholder="Freezer A, Shelf 2, Box 1"
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Notes
            <Textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              className="mt-1 min-h-16 text-xs"
              aria-label="Notes"
            />
          </Label>
          {modelFields.length > 0 ? (
            <div className="grid gap-3 border-t pt-3">
              <p className="text-xs font-medium">Workspace fields</p>
              {modelFields.map((definition) => (
                <ModelFieldInput
                  key={definition.id}
                  definition={definition}
                  value={
                    customFields[definition.fieldName] ??
                    (typeof definition.defaultValue === 'boolean'
                      ? definition.defaultValue
                      : definition.defaultValue == null
                        ? ''
                        : String(definition.defaultValue))
                  }
                  onChange={(value) =>
                    setCustomFields((current) => ({
                      ...current,
                      [definition.fieldName]: value,
                    }))
                  }
                />
              ))}
            </div>
          ) : null}
          {invalidQuantity ? (
            <p role="alert" className="text-sm text-danger">
              Quantity and low-stock threshold must be zero or greater.
            </p>
          ) : null}
        </form>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-sample-form"
            disabled={
              pending ||
              !projectId ||
              projectsLoading ||
              projectsError ||
              invalidQuantity ||
              !form.title.trim() ||
              missingRequiredModelField
            }
          >
            {pending ? 'Creating sample…' : 'Create sample'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
