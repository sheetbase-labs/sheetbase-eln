/**
 * REG-003 — Reagents Registry.
 *
 * Workspace-scoped registry of reagent records (kind='reagent') built on the
 * reusable RegistryComposition (REG-001). Server-side pagination, sorting and
 * status/storage filtering through the same-origin /api/db boundary; the
 * browser never loads the whole workspace. Low-stock and expiry attention are
 * derived from configured thresholds (low_stock_threshold,
 * expiry_warning_days) rather than manual badges, with authoritative summary
 * counts from the `reagent_attention_summary` RPC.
 *
 * Controlled mutations — receive, consume, quarantine, archive — call the
 * `record_reagent_movement` and `archive_record` RPCs so quantity logic and
 * status transitions are enforced at the database, and every quantity change
 * is recorded in the `reagent_movements` ledger with a supplier/lot/expiry
 * snapshot so the historical identity used by experiments is preserved.
 *
 * The inspector shows identity, supplier details, lot/expiry, quantity,
 * storage, status, attention, usage (incoming links), linked protocols and
 * documents (outgoing links) and recent movements (orders).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Archive, FlaskConical } from 'lucide-react'

import { useShell } from '#/components/shell'
import { CreateReagentDialog } from '#/components/reagents/create-reagent-dialog'
import { ReagentInspector } from '#/components/reagents/reagent-inspector'
import { RegistryComposition } from '#/components/registry'
import type { DataGridField } from '#/components/data-grid'
import type { RegistrySummary } from '#/components/registry'
import { StatusBadge } from '#/components/scientific'
import {
  Button,
  ButtonGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Label,
} from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { fetchModelFields } from '#/lib/model-fields'
import {
  archiveReagent,
  createReagent,
  editReagent,
  DEFAULT_EXPIRY_WARNING_DAYS,
  fetchReagent,
  fetchReagentAttentionSummary,
  fetchReagentMovements,
  fetchReagentUsage,
  fetchReagentsCount,
  fetchReagentsPage,
  REAGENT_STATUS_OPTIONS,
  REAGENT_STORAGE_OPTIONS,
  recordReagentMovement,
  reagentQueryKeys,
  reagentAttention,
} from '#/lib/reagent-data'
import type { Reagent, ReagentAttentionSummary } from '#/lib/reagent-data'
import { decodeRegistryQuery, encodeRegistryQuery } from '#/lib/registry'
import type { RegistryQuery } from '#/lib/registry'

/**
 * REG-003 reagents registry route. Workspace-scoped (no project param): a
 * reagent is an inventory item referenced by many experiments across
 * projects, so the registry lists every reagent in the active workspace.
 */
export const Route = createFileRoute('/reagents')({
  validateSearch: (search: Record<string, unknown>) => ({
    rq: typeof search.rq === 'string' ? search.rq : '',
    sort: typeof search.sort === 'string' ? search.sort : '',
    group: typeof search.group === 'string' ? search.group : 'category',
    status: typeof search.status === 'string' ? search.status : '',
    storage: typeof search.storage === 'string' ? search.storage : '',
    q: typeof search.q === 'string' ? search.q : '',
    selected: typeof search.selected === 'string' ? search.selected : '',
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ReagentsRegistryRoute,
})

// Shared data client for the registry. Stateless; the proxy stamps the
// session cookie per request.
const client = createDataClient()

const columnHelper = createColumnHelper<Reagent>()

/**
 * Build the server-owned RegistryQuery from the parsed URL search state.
 * Filters keep a stable id order (status, storage, q) so saved views and the
 * composition's filter bar stay aligned.
 */
function queryFromSearch(search: {
  rq: string
  sort: string
  group: string
  status: string
  storage: string
  q: string
}): RegistryQuery {
  const decoded = decodeRegistryQuery(search.rq)
  if (decoded) return { ...decoded, pageIndex: 0, pageSize: 50 }
  const sorting: RegistryQuery['sorting'] = []
  if (search.sort) {
    const [id, desc] = search.sort.split(',')
    if (id) sorting.push({ id, desc: desc === 'desc' })
  }
  const filters: RegistryQuery['filters'] = []
  if (search.status)
    filters.push({ fieldId: 'status', operator: 'eq', values: [search.status] })
  if (search.storage)
    filters.push({
      fieldId: 'storage',
      operator: 'eq',
      values: [search.storage],
    })
  if (search.q)
    filters.push({ fieldId: 'q', operator: 'contains', values: [search.q] })
  return {
    pageIndex: 0,
    pageSize: 50,
    sorting,
    grouping: search.group ? [search.group] : [],
    filters,
  }
}

function ReagentsRegistryRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const query = queryFromSearch(search)
  const selectedId = search.selected || null

  function setQuery(next: RegistryQuery) {
    void navigate({
      to: '/reagents',
      search: {
        rq: encodeRegistryQuery({ ...next, pageIndex: 0 }),
        sort: '',
        group: '',
        status: '',
        storage: '',
        q: '',
        selected: selectedId ?? '',
      },
      replace: false,
    })
  }

  function setSelected(id: string | null) {
    void navigate({
      to: '/reagents',
      search: { ...search, selected: id ?? '' },
      replace: false,
    })
  }

  const countQuery = useQuery({
    queryKey: reagentQueryKeys.count(query),
    queryFn: () => fetchReagentsCount(client, query),
  })
  const rowsQuery = useInfiniteQuery({
    queryKey: reagentQueryKeys.infinite(query),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchReagentsPage(client, { ...query, pageIndex: pageParam }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.length, 0)
      if (
        lastPage.length < query.pageSize ||
        (countQuery.data !== undefined && loaded >= countQuery.data)
      ) {
        return undefined
      }
      return pages.length
    },
  })
  const attentionQuery = useQuery({
    queryKey: reagentQueryKeys.attention(DEFAULT_EXPIRY_WARNING_DAYS),
    queryFn: () =>
      fetchReagentAttentionSummary(client, DEFAULT_EXPIRY_WARNING_DAYS),
  })
  // Selected reagent detail + inspector data. Loaded independently of the
  // current page so selection persists across refreshes and pagination.
  const selectedQuery = useQuery({
    queryKey: selectedId
      ? reagentQueryKeys.detail(selectedId)
      : ['reg-003', 'reagents', 'detail', 'none'],
    queryFn: () => fetchReagent(client, selectedId!),
    enabled: !!selectedId,
  })
  const movementsQuery = useQuery({
    queryKey: selectedId
      ? reagentQueryKeys.movements(selectedId)
      : ['reg-003', 'reagents', 'movements', 'none'],
    queryFn: () => fetchReagentMovements(client, selectedId!),
    enabled: !!selectedId,
  })
  const usageQuery = useQuery({
    queryKey: selectedId
      ? reagentQueryKeys.usage(selectedQuery.data?.identifier ?? 'pending')
      : ['reg-003', 'reagents', 'usage', 'none'],
    queryFn: () => fetchReagentUsage(client, selectedQuery.data!.identifier),
    enabled: !!selectedId && !!selectedQuery.data,
  })

  const rows = useMemo(() => {
    const byId = new Map<string, Reagent>()
    for (const page of rowsQuery.data?.pages ?? []) {
      for (const reagent of page) byId.set(reagent.id, reagent)
    }
    return Array.from(byId.values())
  }, [rowsQuery.data])
  const totalCount = countQuery.data ?? 0
  const attention = attentionQuery.data ?? null
  const selectedReagent = selectedQuery.data ?? null
  const movements = movementsQuery.data ?? []
  const usage = usageQuery.data ?? []

  const initialError = rowsQuery.isLoadingError
    ? rowsQuery.error
    : countQuery.error
  const permissionDenied =
    initialError instanceof DataClientError &&
    initialError.code === 'permission_denied'

  const summaries: RegistrySummary[] = attention
    ? buildSummaries(attention)
    : []

  const fields = useMemo(() => buildFields(buildColumns()), [])

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: { name: context.user.name, email: context.user.email },
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['reg-003', 'projects'],
    queryFn: () =>
      client.list<{ id: string; key: string; title: string }>(
        'projects',
        '?order=created_at.desc&select=id,key,title',
      ),
  })
  const modelFieldsQuery = useQuery({
    queryKey: ['reg-003', 'reagent-fields'],
    queryFn: () => fetchModelFields(notebookDataClient, 'reagent'),
  })
  const modelFields = modelFieldsQuery.data ?? []

  function handleMutated() {
    void queryClient.invalidateQueries({
      queryKey: ['reg-003', 'reagents'],
    })
  }

  const createMutation = useMutation({
    mutationFn: async (input: {
      projectId: string
      title: string
      category: string
      properties: {
        supplier: string
        catalogNo: string
        lot: string
        expiry: string
        quantity: string
        unit: string
        storage: string
      }
      customFields: Record<string, unknown>
    }) => {
      const quantity =
        input.properties.quantity === ''
          ? undefined
          : Number(input.properties.quantity)
      return createReagent(client, {
        projectId: input.projectId,
        title: input.title,
        tags: input.category ? [input.category] : [],
        properties: {
          supplier: input.properties.supplier || undefined,
          catalogNo: input.properties.catalogNo || undefined,
          lot: input.properties.lot || undefined,
          expiry: input.properties.expiry || undefined,
          quantity,
          unit: input.properties.unit || undefined,
          storage: input.properties.storage || undefined,
        },
        customFields: input.customFields,
      })
    },
    onSuccess: (reagent) => {
      setCreateError(null)
      setCreateOpen(false)
      handleMutated()
      setSelected(reagent.id)
    },
    onError: (error) => {
      setCreateError(
        error instanceof Error ? error.message : 'Could not create reagent.',
      )
    },
  })

  useShell({
    fullBleed: true,
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Reagents' }],
  })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
        <RegistryComposition
          registryId="reagents"
          title="Reagents"
          description="Find stock by name, supplier or lot, and check quantity, storage and expiry."
          rows={rows}
          totalCount={totalCount}
          fields={fields}
          query={query}
          onQueryChange={setQuery}
          getRowId={(row) => row.id}
          selectedId={selectedId}
          selectedRecord={selectedReagent}
          onSelectedIdChange={setSelected}
          inspectorLabel="Reagent details"
          summaries={summaries}
          initialColumnVisibility={{
            updatedAt: false,
            catalogNo: false,
            category: false,
          }}
          loading={rowsQuery.isLoading || countQuery.isLoading}
          error={initialError}
          permissionDenied={permissionDenied}
          onRetry={() => {
            void Promise.all([rowsQuery.refetch(), countQuery.refetch()])
          }}
          incrementalRows={{
            hasMore: rowsQuery.hasNextPage,
            loadingMore: rowsQuery.isFetchingNextPage,
            onLoadMore: () => void rowsQuery.fetchNextPage(),
            loadError: rowsQuery.isFetchNextPageError
              ? rowsQuery.error
              : undefined,
          }}
          resizableColumns
          searchDebounceMs={300}
          emptyTitle="No reagents yet"
          noResultsTitle="No matching reagents"
          actions={
            <Button
              size="sm"
              onClick={() => {
                setCreateError(null)
                setCreateOpen(true)
              }}
            >
              <FlaskConical className="size-3.5" /> New reagent
            </Button>
          }
          renderInspector={(row) =>
            row ? (
              <ReagentInspector
                reagent={row}
                movements={movements}
                usage={usage}
                onClose={() => setSelected(null)}
                actions={
                  <ReagentActions reagent={row} onMutated={handleMutated} />
                }
              />
            ) : selectedReagent ? (
              <ReagentInspector
                reagent={selectedReagent}
                movements={movements}
                usage={usage}
                onClose={() => setSelected(null)}
                actions={
                  <ReagentActions
                    reagent={selectedReagent}
                    onMutated={handleMutated}
                  />
                }
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                Select a reagent to see its details, supplier and lot identity,
                stock movements and usage.
              </div>
            )
          }
        />
        <CreateReagentDialog
          key={createOpen ? 'open' : 'closed'}
          open={createOpen}
          onOpenChange={setCreateOpen}
          projects={projectsQuery.data ?? []}
          projectsLoading={
            projectsQuery.isLoading || modelFieldsQuery.isLoading
          }
          loadError={
            projectsQuery.isError || modelFieldsQuery.isError
              ? 'Could not load the reagent form. Try again.'
              : null
          }
          onRetry={() => {
            void Promise.all([
              projectsQuery.refetch(),
              modelFieldsQuery.refetch(),
            ])
          }}
          pending={createMutation.isPending}
          error={createError}
          modelFields={modelFields}
          onCreate={(input) => createMutation.mutate(input)}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Columns.
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Reagent, unknown>[] {
  return [
    columnHelper.accessor('identifier', {
      id: 'identifier',
      header: 'Reagent ID',
      size: 112,
      minSize: 96,
      cell: (info) => (
        <span className="font-mono text-xs font-medium tabular-nums text-primary hover:underline">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('title', {
      id: 'title',
      header: 'Name',
      size: 194,
      minSize: 160,
    }),
    columnHelper.accessor('category', {
      id: 'category',
      header: 'Category',
      size: 128,
      minSize: 104,
      cell: (info) => (
        <span className="text-muted-foreground">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor('supplier', {
      id: 'supplier',
      header: 'Supplier',
      size: 144,
      minSize: 112,
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('catalogNo', {
      id: 'catalogNo',
      header: 'Catalog No.',
      size: 112,
      minSize: 96,
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('lot', {
      id: 'lot',
      header: 'Lot',
      size: 104,
      minSize: 88,
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('expiry', {
      id: 'expiry',
      header: 'Expiry',
      size: 104,
      minSize: 92,
      cell: (info) => {
        if (!info.getValue()) return '—'
        const attention = reagentAttention(info.row.original)
        return (
          <div>
            <span>{formatDate(info.getValue())}</span>
            {attention.expired || attention.nearExpiry ? (
              <span
                className={
                  attention.expired
                    ? 'block text-xs text-destructive'
                    : 'block text-xs text-warning-foreground'
                }
              >
                {attention.expired ? 'Expired' : 'Expiring soon'}
              </span>
            ) : null}
          </div>
        )
      },
    }),
    columnHelper.accessor((row) => row.quantity, {
      id: 'quantity',
      header: 'Quantity',
      size: 104,
      minSize: 88,
      enableSorting: false,
      cell: (info) => {
        const row = info.row.original
        if (row.quantity === null) return '—'
        return (
          <div className="tabular-nums">
            <span>
              {row.quantity}
              {row.unit ? ` ${row.unit}` : ''}
            </span>
            {reagentAttention(row).lowStock ? (
              <span className="block text-xs text-warning-foreground">
                Low stock
              </span>
            ) : null}
          </div>
        )
      },
    }),
    columnHelper.accessor('storage', {
      id: 'storage',
      header: 'Storage',
      size: 96,
      minSize: 80,
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('status', {
      id: 'status',
      header: 'Status',
      size: 128,
      minSize: 112,
      cell: (info) => <StatusBadge domain="reagent" status={info.getValue()} />,
    }),
    columnHelper.accessor('updatedAt', {
      id: 'updatedAt',
      header: 'Updated',
      size: 104,
      minSize: 92,
      meta: { dataGridFormat: { kind: 'date', dateStyle: 'short' } },
      cell: (info) => formatDate(info.getValue()),
    }),
  ] as ColumnDef<Reagent, unknown>[]
}

function buildFields(
  columns: ColumnDef<Reagent, unknown>[],
): DataGridField<Reagent>[] {
  const labels: Record<string, string> = {
    identifier: 'Reagent ID',
    title: 'Name',
    category: 'Category',
    supplier: 'Supplier',
    catalogNo: 'Catalogue number',
    lot: 'Lot',
    expiry: 'Expiry',
    quantity: 'Quantity',
    storage: 'Storage',
    status: 'Status',
    updatedAt: 'Updated',
  }
  const textFilter = (placeholder: string) => ({
    type: 'text' as const,
    placeholder,
    operators: [{ value: 'contains' as const, label: 'contains' }],
  })
  const filters: Record<string, DataGridField<Reagent>['filter']> = {
    category: textFilter('Category contains'),
    supplier: textFilter('Supplier contains'),
    catalogNo: textFilter('Catalogue number contains'),
    lot: textFilter('Lot contains'),
    storage: {
      type: 'select',
      placeholder: 'All storage',
      operators: [{ value: 'eq', label: 'is' }],
      options: REAGENT_STORAGE_OPTIONS,
    },
    status: {
      type: 'select',
      placeholder: 'All statuses',
      operators: [{ value: 'eq', label: 'is' }],
      options: [
        ...REAGENT_STATUS_OPTIONS,
        { value: 'archived', label: 'Archived' },
      ],
    },
  }
  const fields: DataGridField<Reagent>[] = columns.map((column) => {
    const id = String(
      column.id ?? ('accessorKey' in column ? column.accessorKey : ''),
    )
    return {
      id,
      label: labels[id] ?? id,
      column,
      filter: filters[id],
      groupable: ['category', 'storage', 'supplier', 'status'].includes(id),
    }
  })
  fields.push({
    id: 'q',
    label: 'Search',
    column: false,
    filter: textFilter('ID, name, supplier, catalogue number or lot'),
    groupable: false,
  })
  return fields
}

// ---------------------------------------------------------------------------
// Summaries.
// ---------------------------------------------------------------------------

function buildSummaries(attention: ReagentAttentionSummary): RegistrySummary[] {
  return [
    { label: 'Active reagents', value: attention.total, hint: 'In inventory' },
    {
      label: 'Low stock',
      value: attention.lowStock,
      hint: attention.lowStock > 0 ? 'needs reorder' : undefined,
    },
    {
      label: 'Expiring soon',
      value: attention.nearExpiry,
      hint: attention.nearExpiry > 0 ? 'within warning period' : undefined,
    },
    {
      label: 'Expired',
      value: attention.expired,
      hint: attention.expired > 0 ? 'review required' : undefined,
    },
    {
      label: 'Quarantined',
      value: attention.quarantined,
      hint: attention.quarantined > 0 ? 'isolated' : undefined,
    },
  ]
}

// ---------------------------------------------------------------------------
// Actions — receive, consume, quarantine, archive. Each is a controlled
// mutation through the RPC; the dialog surfaces stale_version,
// insufficient_stock and invalid_transition errors inline.
// ---------------------------------------------------------------------------

function ReagentActions({
  reagent,
  onMutated,
}: {
  reagent: Reagent
  onMutated: (reagentId: string) => void
}) {
  const [dialog, setDialog] = useState<
    null | 'receive' | 'consume' | 'quarantine' | 'archive' | 'edit'
  >(null)

  const movementMutation = useMutation({
    mutationFn: async (input: {
      operation: 'receive' | 'consume' | 'quarantine' | 'restore'
      quantityDelta?: number
      reason?: string
    }) =>
      recordReagentMovement(client, {
        recordId: reagent.id,
        operation: input.operation,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        expectedMetadataVersion: reagent.metadataVersion,
      }),
    onSuccess: () => {
      onMutated(reagent.id)
      setDialog(null)
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async () =>
      archiveReagent(client, reagent.id, reagent.metadataVersion),
    onSuccess: () => {
      onMutated(reagent.id)
      setDialog(null)
    },
  })
  const editMutation = useMutation({
    mutationFn: async (input: {
      title: string
      supplier: string
      catalogNo: string
      lot: string
    }) =>
      editReagent(client, {
        recordId: reagent.id,
        expectedMetadataVersion: reagent.metadataVersion,
        title: input.title,
        properties: {
          supplier: input.supplier || null,
          catalogNo: input.catalogNo || null,
          lot: input.lot || null,
          expiry: reagent.expiry,
          quantity: reagent.quantity,
          unit: reagent.unit,
          storage: reagent.storage,
          lowStockThreshold: reagent.lowStockThreshold,
          expiryWarningDays: reagent.expiryWarningDays,
        },
      }),
    onSuccess: () => {
      onMutated(reagent.id)
      setDialog(null)
    },
  })

  const error =
    (movementMutation.error instanceof DataClientError
      ? movementMutation.error
      : null) ??
    (archiveMutation.error instanceof DataClientError
      ? archiveMutation.error
      : null) ??
    (editMutation.error instanceof DataClientError ? editMutation.error : null)
  const errorMessage = error ? describeMovementError(error) : null
  const pending =
    movementMutation.isPending ||
    archiveMutation.isPending ||
    editMutation.isPending

  // Disable actions that the RPC will reject for the current status, so the
  // UI hints honestly rather than offering an impossible operation.
  const canReceive = ['available', 'reserved', 'consumed'].includes(
    reagent.status,
  )
  const canConsume = ['available', 'reserved'].includes(reagent.status)
  const canQuarantine = reagent.status === 'available'
  const canArchive = true

  return (
    <div className="space-y-2">
      <ButtonGroup className="flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setDialog('edit')}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canReceive}
          onClick={() => setDialog('receive')}
        >
          Receive
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canConsume}
          onClick={() => setDialog('consume')}
        >
          Consume
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canQuarantine}
          onClick={() => setDialog('quarantine')}
        >
          Quarantine
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canArchive}
          onClick={() => setDialog('archive')}
        >
          <Archive className="size-3.5" />
          Archive
        </Button>
      </ButtonGroup>

      {dialog === 'receive' || dialog === 'consume' ? (
        <QuantityDialog
          operation={dialog}
          reagent={reagent}
          pending={pending}
          errorMessage={errorMessage}
          onCancel={() => setDialog(null)}
          onSubmit={(quantity, reason) =>
            movementMutation.mutate({
              operation: dialog,
              quantityDelta: quantity,
              reason,
            })
          }
        />
      ) : null}

      {dialog === 'quarantine' ? (
        <ConfirmDialog
          title={`Quarantine ${reagent.identifier}?`}
          description="The reagent will be isolated from consumption and experiments until restored. Stock quantity is unchanged."
          confirmLabel="Quarantine"
          pending={pending}
          errorMessage={errorMessage}
          onCancel={() => setDialog(null)}
          onConfirm={() => movementMutation.mutate({ operation: 'quarantine' })}
        />
      ) : null}

      {dialog === 'archive' ? (
        <ConfirmDialog
          title={`Archive ${reagent.identifier}?`}
          description="Archiving removes the reagent from the active registry. Historical links and stock movements are preserved. Restore it to record new movements."
          confirmLabel="Archive"
          pending={pending}
          errorMessage={errorMessage}
          onCancel={() => setDialog(null)}
          onConfirm={() => archiveMutation.mutate()}
        />
      ) : null}

      {dialog === 'edit' ? (
        <EditReagentDialog
          reagent={reagent}
          pending={pending}
          errorMessage={errorMessage}
          onCancel={() => setDialog(null)}
          onSubmit={(input) => editMutation.mutate(input)}
        />
      ) : null}
    </div>
  )
}

function QuantityDialog({
  operation,
  reagent,
  pending,
  errorMessage,
  onCancel,
  onSubmit,
}: {
  operation: 'receive' | 'consume'
  reagent: Reagent
  pending: boolean
  errorMessage: string | null
  onCancel: () => void
  onSubmit: (quantity: number, reason: string) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const parsed = Number(quantity)
  const valid = quantity !== '' && Number.isFinite(parsed) && parsed > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {operation === 'receive' ? 'Receive stock' : 'Consume stock'} —{' '}
            {reagent.identifier}
          </DialogTitle>
          <DialogDescription>
            {operation === 'receive'
              ? `Add stock to ${reagent.title}. The reagent returns to available.`
              : `Record usage from ${reagent.title}. Quantity cannot go below zero.`}
            {reagent.quantity !== null
              ? ` Current stock: ${reagent.quantity}${reagent.unit ? ` ${reagent.unit}` : ''}.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="reagent-quantity">
              Quantity{reagent.unit ? ` (${reagent.unit})` : ''}
            </FieldLabel>
            <Input
              id="reagent-quantity"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="reagent-reason">Reason (optional)</FieldLabel>
            <Input
              id="reagent-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                operation === 'receive'
                  ? 'PO-1234, received from supplier'
                  : 'Used in EXP-2026-0001'
              }
            />
          </Field>
        </FieldGroup>
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid || pending}
            onClick={() => onSubmit(parsed, reason.trim() || '')}
          >
            {pending
              ? 'Saving…'
              : operation === 'receive'
                ? 'Receive'
                : 'Consume'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: {
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  errorMessage: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function describeMovementError(error: DataClientError): string {
  switch (error.code) {
    case 'stale_version':
    case 'SB001':
      return 'This reagent was changed elsewhere. Refresh and try again.'
    case 'SB006':
      return 'Insufficient stock: the quantity to consume is more than is available.'
    case 'SB004':
    case 'invalid_transition':
      return 'This action is not allowed for the reagent’s current status.'
    case 'unauthenticated':
      return 'Your session expired. Sign in again.'
    case 'permission_denied':
      return 'You do not have permission to modify this reagent.'
    default:
      return error.message || 'Could not record the movement. Try again.'
  }
}

function EditReagentDialog({
  reagent,
  pending,
  errorMessage,
  onCancel,
  onSubmit,
}: {
  reagent: Reagent
  pending: boolean
  errorMessage: string | null
  onCancel: () => void
  onSubmit: (input: {
    title: string
    supplier: string
    catalogNo: string
    lot: string
  }) => void
}) {
  const [title, setTitle] = useState(reagent.title)
  const [supplier, setSupplier] = useState(reagent.supplier ?? '')
  const [catalogNo, setCatalogNo] = useState(reagent.catalogNo ?? '')
  const [lot, setLot] = useState(reagent.lot ?? '')
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {reagent.identifier}</DialogTitle>
          <DialogDescription>
            Update identity fields. Stock quantity still uses receive/consume.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label className="text-xs text-muted-foreground">
            Name
            <Input
              className="mt-1 h-9"
              aria-label="Reagent name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Supplier
            <Input
              className="mt-1 h-9"
              aria-label="Supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Catalog No.
            <Input
              className="mt-1 h-9"
              aria-label="Catalog number"
              value={catalogNo}
              onChange={(event) => setCatalogNo(event.target.value)}
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Lot
            <Input
              className="mt-1 h-9"
              aria-label="Lot"
              value={lot}
              onChange={(event) => setLot(event.target.value)}
            />
          </Label>
        </div>
        {errorMessage ? (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={pending || !title.trim()}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                supplier,
                catalogNo,
                lot,
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
