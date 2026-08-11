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
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { PackagePlus } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegistryComposition } from '#/components/registry/registry-composition'
import type { RegistryField } from '#/components/registry/registry-composition'
import { SampleInspector } from '#/components/samples/sample-inspector'
import type { SampleCustodyAction } from '#/components/samples/sample-inspector'
import { StatusBadge } from '#/components/scientific/status-badge'
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
import { DEFAULT_REGISTRY_QUERY } from '#/lib/registry'
import type { RegistryQuery } from '#/lib/registry'

export const Route = createFileRoute('/samples')({
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
  const queryClient = useQueryClient()

  const [query, setQuery] = useState<RegistryQuery>({
    ...DEFAULT_REGISTRY_QUERY,
    pageSize: 50,
    grouping: ['sampleType'],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // ---- Registry page query ----
  const pageQuery = useQuery({
    queryKey: sampleQueryKeys.page(query),
    queryFn: () => fetchSamplesPage(notebookDataClient, query),
  })

  const { rows, totalCount } = pageQuery.data ?? { rows: [], totalCount: 0 }
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
    const cols = sampleColumns<SampleRecord>()
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
  }, [])

  const fields: RegistryField<SampleRecord>[] = columns.map((column) => {
    const id = String(
      column.id ?? ('accessorKey' in column ? column.accessorKey : ''),
    )
    const labels: Record<string, string> = {
      identifier: 'Sample ID',
      title: 'Title',
      sampleType: 'Type',
      quantity: 'Quantity',
      storageLocation: 'Storage',
      barcode: 'Barcode',
      status: 'Status',
      updatedAt: 'Updated',
    }
    const filter =
      id === 'status'
        ? {
            type: 'select' as const,
            operators: [{ value: 'eq' as const, label: 'is' }],
            options: sampleStatusOptions(),
          }
        : ['sampleType', 'storageLocation', 'barcode'].includes(id)
          ? {
              type: 'text' as const,
              placeholder: `All ${labels[id].toLowerCase()}`,
              operators: [{ value: 'contains' as const, label: 'contains' }],
            }
          : undefined
    return {
      id,
      label: labels[id] ?? id,
      column,
      filter,
      groupable: ['status', 'sampleType', 'storageLocation'].includes(id),
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
      />
    ) : (
      <SampleInspector
        sample={null}
        events={[]}
        linkedExperiments={[]}
        linkedFiles={[]}
        onAction={() => {}}
      />
    )

  useShell({
    fullBleed: true,
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Samples' }],
  })

  return (
    <>
      <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
        <RegistryComposition
          registryId="samples"
          title="Samples Registry"
          description="Track sample identity, quantity, storage and chain of custody."
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
          initialColumnVisibility={{ barcode: false, sampleType: false }}
          loading={pageQuery.isLoading}
          error={pageQuery.error}
          onRetry={() => pageQuery.refetch()}
          emptyTitle="No samples yet"
          noResultsTitle="No matching samples"
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PackagePlus className="size-3.5" /> New sample
            </Button>
          }
        />
        <CreateSampleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projects={projectsQuery.data ?? []}
          projectsLoading={projectsQuery.isLoading}
          pending={createMutation.isPending}
          error={createError}
          onCreate={(input) => createMutation.mutate(input)}
        />
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

function CreateSampleDialog({
  open,
  onOpenChange,
  projects,
  projectsLoading,
  pending,
  error,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; key: string; title: string }[]
  projectsLoading: boolean
  pending: boolean
  error: string | null
  onCreate: (input: {
    projectId: string
    title: string
    properties: CreateSampleForm
  }) => void
}) {
  const [form, setForm] = useState<CreateSampleForm>(EMPTY_FORM)

  function update(field: keyof CreateSampleForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function submit() {
    if (!form.projectId || !form.title.trim()) return
    onCreate({
      projectId: form.projectId,
      title: form.title.trim(),
      properties: form,
    })
    setForm(EMPTY_FORM)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sample</DialogTitle>
          <DialogDescription>
            Create a sample record. Quantity, storage and barcode can be
            adjusted later through custody actions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Label className="text-xs text-muted-foreground">
            Project
            <Select
              value={form.projectId}
              onChange={(e) => update('projectId', e.target.value)}
              className="mt-1 h-9"
              aria-label="Project"
            >
              <option value="">
                {projectsLoading ? 'Loading…' : 'Select a project'}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} — {p.title}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="text-xs text-muted-foreground">
            Title
            <Input
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className="mt-1 h-9"
              aria-label="Sample title"
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
              Low-stock at
              <Input
                type="number"
                step="any"
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
        </div>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !form.projectId || !form.title.trim()}
          >
            Create sample
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
