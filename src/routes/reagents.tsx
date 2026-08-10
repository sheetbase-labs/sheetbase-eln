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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Archive } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ReagentInspector } from '#/components/reagents/reagent-inspector'
import { RegistryComposition } from '#/components/registry'
import type { RegistrySummary } from '#/components/registry'
import { StatusBadge } from '#/components/scientific'
import {
  Badge,
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
} from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { formatDate } from '#/lib/notebook-data'
import {
  archiveReagent,
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
} from '#/lib/reagent-data'
import type { Reagent, ReagentAttentionSummary } from '#/lib/reagent-data'
import type { RegistryQuery } from '#/lib/registry'

/**
 * REG-003 reagents registry route. Workspace-scoped (no project param): a
 * reagent is an inventory item referenced by many experiments across
 * projects, so the registry lists every reagent in the active workspace.
 */
export const Route = createFileRoute('/reagents')({
  validateSearch: (search: Record<string, unknown>) => ({
    pageIndex:
      Number.isInteger(search.pageIndex) && (search.pageIndex as number) >= 0
        ? (search.pageIndex as number)
        : 0,
    pageSize:
      typeof search.pageSize === 'number' &&
      [25, 50, 100].includes(search.pageSize)
        ? search.pageSize
        : 50,
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
  pageIndex: number
  pageSize: number
  sort: string
  group: string
  status: string
  storage: string
  q: string
}): RegistryQuery {
  const sorting: RegistryQuery['sorting'] = []
  if (search.sort) {
    const [id, desc] = search.sort.split(',')
    if (id) sorting.push({ id, desc: desc === 'desc' })
  }
  const filters: RegistryQuery['filters'] = []
  if (search.status) filters.push({ id: 'status', value: search.status })
  if (search.storage) filters.push({ id: 'storage', value: search.storage })
  if (search.q) filters.push({ id: 'q', value: search.q })
  return {
    pageIndex: search.pageIndex,
    pageSize: search.pageSize,
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
        pageIndex: next.pageIndex,
        pageSize: next.pageSize,
        sort: next.sorting[0]
          ? `${next.sorting[0].id},${next.sorting[0].desc ? 'desc' : 'asc'}`
          : '',
        group: next.grouping[0] ?? '',
        status: next.filters.find((f) => f.id === 'status')?.value ?? '',
        storage: next.filters.find((f) => f.id === 'storage')?.value ?? '',
        q: next.filters.find((f) => f.id === 'q')?.value ?? '',
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

  const rowsQuery = useQuery({
    queryKey: reagentQueryKeys.list(query),
    queryFn: () => fetchReagentsPage(client, query),
  })
  const countQuery = useQuery({
    queryKey: reagentQueryKeys.count(query),
    queryFn: () => fetchReagentsCount(client, query),
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

  const rows = rowsQuery.data ?? []
  const totalCount = countQuery.data ?? 0
  const attention = attentionQuery.data ?? null
  const selectedReagent = selectedQuery.data ?? null
  const movements = movementsQuery.data ?? []
  const usage = usageQuery.data ?? []

  const permissionDenied =
    rowsQuery.error instanceof DataClientError &&
    rowsQuery.error.code === 'permission_denied'

  const summaries: RegistrySummary[] = attention
    ? buildSummaries(attention)
    : []

  const columns = buildColumns()

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: { name: context.user.name, email: context.user.email },
  }

  function handleMutated() {
    void queryClient.invalidateQueries({
      queryKey: ['reg-003', 'reagents'],
    })
  }

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
          workspaceId={context.workspace?.id ?? 'unknown'}
          userId={context.user.id}
          title="Reagents Registry"
          description="Central inventory of reagents, consumables and chemicals."
          rows={rows}
          totalCount={totalCount}
          columns={columns}
          query={query}
          onQueryChange={setQuery}
          getRowId={(row) => row.id}
          selectedId={selectedId}
          selectedRecord={selectedReagent}
          onSelectedIdChange={setSelected}
          inspectorLabel="Reagent details"
          initialDensity="compact"
          summaries={summaries}
          filterDefinitions={[
            {
              id: 'status',
              label: 'Status',
              placeholder: 'All statuses',
              options: [
                ...REAGENT_STATUS_OPTIONS,
                { value: 'archived', label: 'Archived' },
              ],
            },
            {
              id: 'storage',
              label: 'Storage',
              placeholder: 'All storage',
              options: REAGENT_STORAGE_OPTIONS,
            },
            {
              id: 'q',
              label: 'Search',
              placeholder: 'Identifier or title',
            },
          ]}
          groupingOptions={[
            { id: 'category', label: 'Category' },
            { id: 'storage', label: 'Storage' },
            { id: 'supplier', label: 'Supplier' },
            { id: 'status', label: 'Status' },
          ]}
          initialColumnVisibility={{ updatedAt: false }}
          loading={rowsQuery.isLoading}
          error={rowsQuery.error}
          permissionDenied={permissionDenied}
          partialData={
            rowsQuery.data !== undefined && countQuery.data === undefined
          }
          onRetry={() => rowsQuery.refetch()}
          emptyTitle="No reagents yet"
          noResultsTitle="No matching reagents"
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
      cell: (info) => (
        <span className="font-mono text-xs font-medium tabular-nums text-primary hover:underline">
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('title', {
      id: 'title',
      header: 'Name',
    }),
    columnHelper.accessor('category', {
      id: 'category',
      header: 'Category',
      cell: (info) => <CategoryBadge category={info.getValue()} />,
    }),
    columnHelper.accessor('supplier', {
      id: 'supplier',
      header: 'Supplier',
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('catalogNo', {
      id: 'catalogNo',
      header: 'Catalog No.',
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('lot', {
      id: 'lot',
      header: 'Lot',
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('expiry', {
      id: 'expiry',
      header: 'Expiry',
      meta: { registryFormat: { kind: 'date', dateStyle: 'short' } },
      cell: (info) => (info.getValue() ? formatDate(info.getValue()) : '—'),
    }),
    columnHelper.accessor((row) => row.quantity, {
      id: 'quantity',
      header: 'Quantity',
      enableSorting: false,
      cell: (info) => {
        const row = info.row.original
        if (row.quantity === null) return '—'
        return `${row.quantity}${row.unit ? ` ${row.unit}` : ''}`
      },
    }),
    columnHelper.accessor('storage', {
      id: 'storage',
      header: 'Storage',
      cell: (info) => info.getValue() ?? '—',
    }),
    columnHelper.accessor('status', {
      id: 'status',
      header: 'Status',
      cell: (info) => <StatusBadge domain="reagent" status={info.getValue()} />,
    }),
    columnHelper.accessor('updatedAt', {
      id: 'updatedAt',
      header: 'Updated',
      meta: { registryFormat: { kind: 'date', dateStyle: 'short' } },
      cell: (info) => formatDate(info.getValue()),
    }),
  ] as ColumnDef<Reagent, unknown>[]
}

function CategoryBadge({ category }: { category: string }) {
  const normalised = category.toLowerCase()
  const variant = normalised.includes('enzyme')
    ? 'violet'
    : normalised.includes('buffer') || normalised.includes('solution')
      ? 'info'
      : normalised.includes('chemical')
        ? 'warning'
        : 'outline'

  return <Badge variant={variant}>{category}</Badge>
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
      hint: attention.nearExpiry > 0 ? 'within 30 days' : undefined,
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
    null | 'receive' | 'consume' | 'quarantine' | 'archive'
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

  const error =
    (movementMutation.error instanceof DataClientError
      ? movementMutation.error
      : null) ??
    (archiveMutation.error instanceof DataClientError
      ? archiveMutation.error
      : null)
  const errorMessage = error ? describeMovementError(error) : null
  const pending = movementMutation.isPending || archiveMutation.isPending

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
