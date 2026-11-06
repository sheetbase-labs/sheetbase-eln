import { useEffect, useMemo, useState } from 'react'

import { ObjectLink } from '#/components/ui/object-link'
import {
  FillFromText,
  addedFillFields,
} from '#/components/assist/fill-from-text'
import { onlyIsoDate } from '#/lib/assist-fill'
import {
  Link,
  Outlet,
  getRouteApi,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/projects/project-access'
import { Select } from '#/components/ui/select'
import { useProjectNames } from '#/components/samples/samples-data'
import { Status } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { DescriptionList, Inspector } from '#/components/ui/layout'
import { useHasCapability } from '#/lib/use-capability'
import {
  HazardPictograms,
  MaterialSafetySection,
} from '#/components/materials/material-safety'
import {
  fetchAllMaterialSafety,
  materialSafetyKeys,
} from '#/lib/material-safety'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { reagentPath } from '#/lib/navigation'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Field, Input } from '#/components/ui/input'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import {
  ListFooter,
  ListHeader,
  ReadOnlyNote,
  ListToolbar,
  MobileList,
  footerCount,
  Textarea,
} from '#/components/inventory/list'
import { Tabs } from '#/components/ui/tabs'
import {
  ORDER_TONE,
  ReagentOrdersPanel,
  RequestReorderDialog,
  openOrderFor,
  orderStatusLabel,
  useReagentOrders,
} from '#/components/materials/reagent-orders'
import { MakeSolutionDialog } from '#/components/materials/make-solution-dialog'
import {
  materialListQueryKeys,
  useArchivedReagentCount,
  toMaterialListRow,
  useReagentPage,
} from '#/components/materials/materials-data'
import type { MaterialListRow } from '#/components/materials/materials-data'
import {
  createReagent,
  fetchCertificateFile,
  fetchReplacementLot,
  fetchReagentUsage,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
  useAddedFieldListColumns,
  withAddedColumns,
} from '#/components/models/added-fields'
import type { Reagent } from '#/lib/reagent-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { now as appNow } from '#/lib/clock'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { formatDate } from '#/lib/format-date'
import { useListView } from '#/lib/list-views'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import { SpendReportPanel } from '#/components/materials/spend-report'
import { t } from '#/copy'

const MATERIAL_MODEL = requireBuiltInModel('material')

const tabs = [
  'instock',
  'expiring',
  'quarantine',
  'expired',
  'archived',
  'orders',
  'spend',
] as const

/** Today as a date input states it — the local calendar day, because that is
 * what a `type=date` field hands back. */
function todayISO(): string {
  const now = appNow()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The inspector states dates in full, e.g. "4 Jun 2026". */
function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Day and month, for the compact usage line ("23 Sep"). */
function shortDay(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getUTCDate()} ${date
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    .slice(0, 3)}`
}

/** "2 of 6 units": what is left of what was received. */
export function stockOfTotal(row: MaterialListRow): string {
  const unit = row.unit ? ` ${row.unit}` : ''
  const current = row.stock
  if (row.initialQuantity == null) return current
  const total = row.initialQuantity.toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
  return `${current.replace(unit, '')} of ${total}${unit}`
}
export type MaterialTab = (typeof tabs)[number]
/** The `expiring` tab is each lot's own expiry warning window (30 days by
 * default, overridable per lot in its reagent properties), so its label claims
 * no fixed window. */
const tabLabel: Record<MaterialTab, string> = {
  instock: t('library.materials.page.inStock'),
  expiring: t('library.materials.page.expiringSoon'),
  quarantine: 'Quarantine',
  expired: 'Expired',
  archived: t('library.materials.page.archived'),
  orders: t('library.materials.orders.tab'),
  spend: t('spend.spendReport.tab'),
}

/** UI port (roadmap-4/ui-app3): the materials registry list, wired to real
 * material records. Receive lot writes through record_reagent_movement. */
const Route = getRouteApi('/materials')

/** The registry, or the lot page nested under it. */
export function MaterialsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/materials',
  })
  return isIndex ? <MaterialsList /> : <Outlet />
}

function MaterialsList() {
  const canWrite = useHasCapability('record.create')
  const canPlaceOrders = useHasCapability('schema.edit')
  const orders = useReagentOrders()
  const [reorderOpen, setReorderOpen] = useState(false)
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const openMaterial = useOpenRow<MaterialListRow>(
    navigate,
    (row) => reagentPath(row.uuid),
    (row) => row.name,
  )
  // Spend shows prices, which only the people who place orders can read.
  const tab: MaterialTab =
    search.tab === 'spend' && !canPlaceOrders
      ? 'instock'
      : (search.tab ?? 'instock')
  // Orders and Spend are panels of their own, not lists of lots.
  const panelTab = tab === 'orders' || tab === 'spend'
  const page = useReagentPage()
  const archivedPage = useReagentPage(undefined, true, tab === 'archived')
  const archivedCount = useArchivedReagentCount()
  const view = useListView('materials')
  const bulk = useBulkSelection()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: open the dialog, then drop
  // the flag so a reload does not open it again.
  useEffect(() => {
    if (!search.new) return
    setRegisterOpen(true)
    void navigate({
      to: '/materials',
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [search.new, navigate])
  const projects = useProjectNames()
  const hasProjectAccess = useHasProjectAccess()
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  // Soonest expiry first, so the lot that lapses next leads the list; a lot
  // with no expiry is not imminent and sorts after every dated one. A click on
  // a column header takes over from this order.
  const rows = useMemo(() => {
    const byExpiry = (a: Reagent, b: Reagent) => {
      if (a.expiry === b.expiry) return 0
      if (a.expiry === null) return 1
      if (b.expiry === null) return -1
      return a.expiry.localeCompare(b.expiry)
    }
    return [...(page.data?.rows ?? []), ...(archivedPage.data?.rows ?? [])]
      .sort(byExpiry)
      .map(toMaterialListRow)
  }, [page.data, archivedPage.data])

  const inTab = (r: MaterialListRow, item: MaterialTab): boolean =>
    r.tabs.includes(item)
  const counts = Object.fromEntries(
    tabs.map((item) => [
      item,
      item === 'orders'
        ? (orders.data ?? []).filter(
            (o) => o.status === 'requested' || o.status === 'ordered',
          ).length
        : item === 'spend'
          ? 0
          : item === 'archived'
            ? (archivedCount.data ?? 0)
            : rows.filter((r) => inTab(r, item)).length,
    ]),
  ) as Record<MaterialTab, number>
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows
    .filter((r) => inTab(r, tab))
    .filter(
      (r) =>
        !q ||
        [r.id, r.name, r.supplier, r.lot, r.location].some((v) =>
          v.toLowerCase().includes(q),
        ),
    )
  const sel =
    visible.find((r) => r.uuid === (selected ?? search.selected)) ??
    visible.at(0)
  const openOrder = sel ? openOrderFor(orders.data, sel.uuid) : undefined

  // A link such as `?selected=<lot>` names a lot, not a tab. When that lot lives
  // on another tab (an expired or quarantined lot, say) move to the tab that
  // holds it instead of selecting the first row of the wrong list.
  const linked = search.selected
    ? rows.find((r) => r.uuid === search.selected)
    : undefined
  const linkedTab =
    linked && !inTab(linked, tab)
      ? tabs.find((item) => inTab(linked, item))
      : undefined
  useEffect(() => {
    if (!linkedTab) return
    void navigate({
      to: '/materials',
      search: (s) => ({
        ...s,
        tab: linkedTab === 'instock' ? undefined : linkedTab,
        q: undefined,
      }),
      replace: true,
    })
  }, [linkedTab, navigate])

  const addedColumns = useAddedFieldListColumns<MaterialListRow>(
    'material',
    'uuid',
  )
  const safetyByLot = useQuery({
    queryKey: materialSafetyKeys.all(),
    queryFn: () => fetchAllMaterialSafety(notebookDataClient),
    staleTime: 30_000,
  })
  const safetyMap = safetyByLot.data
  const baseColumns = useMemo<RegistryColumn<MaterialListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        accessorFn: (m) => m.id,
        enableHiding: false,
        cell: ({ row }) => (
          <ObjectLink
            kind="material"
            id={row.original.uuid}
            identifier={row.original.id}
          />
        ),
      },
      { id: 'material', header: 'Material', accessorFn: (m) => m.name },
      { id: 'supplier', header: 'Supplier', accessorFn: (m) => m.supplier },
      { id: 'lot', header: 'Lot', accessorFn: (m) => m.lot },
      {
        id: 'stock',
        header: 'Stock',
        accessorFn: (m) => m.stock,
        enableSorting: false,
        meta: rightAligned<MaterialListRow>().meta,
      },
      { id: 'location', header: 'Location', accessorFn: (m) => m.location },
      {
        id: 'expiry',
        header: t('library.materials.page.expiry'),
        accessorFn: (m) => m.expiry ?? undefined,
        cell: ({ row }) =>
          row.original.expiry ? (
            formatDate(row.original.expiry)
          ) : (
            <span className="text-fg-muted">—</span>
          ),
        meta: { exportValue: (m: MaterialListRow) => m.expiry ?? '' },
      },
      {
        id: 'hazards',
        header: t('safety.badge.column'),
        enableSorting: false,
        cell: ({ row }) => (
          <HazardPictograms
            pictograms={safetyMap?.get(row.original.uuid)?.pictograms ?? []}
            size={20}
          />
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (m) => m.status.label,
        cell: ({ row }) => (
          <Status tone={row.original.status.tone}>
            {row.original.status.label}
          </Status>
        ),
      },
    ],
    [safetyMap],
  )
  const columns = useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.uuid ?? null,
    setSelected,
  )

  const usage = useQuery({
    queryKey: ['ui-port', 'materials', 'usage', sel?.id ?? ''],
    queryFn: () => fetchReagentUsage(notebookDataClient, sel!.id),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  // A quarantined lot is isolated, not gone: the same RPC restores it. The
  // reason is the operator's, never a fabricated ledger entry.
  const quarantine = useMutation({
    mutationFn: (reason: string) =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'quarantine',
        quantityDelta: 0,
        reason: reason.trim() || undefined,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotQuarantined'))
      setQuarantineOpen(false)
      setQuarantineReason('')
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.page.couldNotQuarantineLot'),
      )
    },
  })

  const restore = useMutation({
    mutationFn: () =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'restore',
        quantityDelta: 0,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotRestored'))
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.page.couldNotRestoreLot'),
      )
    },
  })

  const replacement = useMutation({
    mutationFn: (input: {
      lot: string
      expiry: string
      quantity: number
      unit?: string
      reason?: string
    }) =>
      registerReplacementLot(notebookDataClient, {
        recordId: sel!.uuid,
        lot: input.lot,
        expiry: input.expiry,
        quantity: input.quantity,
        unit: input.unit ?? sel!.unit,
        reason: input.reason,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.replacementLotRegistered'))
      setReplacementOpen(false)
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.page.couldNotRegisterTheReplacement'),
      )
    },
  })

  const replacementLink = useQuery({
    queryKey: ['ui-port', 'materials', 'replacement', sel?.id ?? ''],
    queryFn: () => fetchReplacementLot(notebookDataClient, sel!.id),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  const certificate = useQuery({
    queryKey: ['ui-port', 'materials', 'certificate', sel?.uuid ?? ''],
    queryFn: () => fetchCertificateFile(notebookDataClient, sel!.uuid),
    enabled: Boolean(sel),
    staleTime: 15_000,
  })

  const register = useMutation({
    mutationFn: async (input: RegisterLotInput) => {
      const created = await createReagent(notebookDataClient, {
        projectId: input.projectId,
        title: input.title,
        properties: {
          supplier: input.supplier ?? null,
          catalogNo: input.catalogNo ?? null,
          lot: input.lot ?? null,
          expiry: input.expiry ?? null,
          quantity: input.quantity,
          unit: input.unit ?? null,
          storage: input.storage ?? null,
        },
        customFields: input.customFields,
      })
      if (!input.typeKey) return created
      // A subtype gives the lot its own ID.
      const typed = await saveNewObjectFields(
        notebookDataClient,
        MATERIAL_MODEL,
        created.id,
        input.typeKey,
        input.typeFields ?? {},
      )
      return { ...created, identifier: typed.identifier ?? created.identifier }
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(
        t('library.materials.page.lotRegistered', {
          identifier: created.identifier,
        }),
      )
      setRegisterOpen(false)
      void navigate({
        to: '/materials',
        search: { selected: created.id },
        replace: true,
      })
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.page.couldNotRegisterLot'),
      )
    },
  })

  const receive = useMutation({
    mutationFn: (input: { quantity: number; reason?: string }) =>
      recordReagentMovement(notebookDataClient, {
        recordId: sel!.uuid,
        operation: 'receive',
        quantityDelta: input.quantity,
        reason: input.reason,
        expectedMetadataVersion: sel!.metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(t('library.materials.page.lotReceived'))
      setReceiveOpen(false)
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : t('library.materials.page.couldNotReceiveLot'),
      )
    },
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={t('library.materials.page.materials')}
          total={page.data?.total}
          actions={
            <>
              <IconButton
                variant="secondary"
                icon="scan"
                label={t('library.materials.page.scanLabel')}
                nativeButton={false}
                render={<Link to="/scan" />}
              />
              {canWrite ? (
                <>
                  <Button
                    variant={sel ? 'secondary' : 'primary'}
                    // On a phone Receive lot sits in More, so Register lot is
                    // the one main action and always reads as primary.
                    className="max-md:border-primary max-md:bg-primary max-md:text-primary-foreground max-md:hover:bg-primary-hover max-md:hover:text-primary-foreground"
                    onClick={() => setRegisterOpen(true)}
                  >
                    {t('library.materials.page.registerLot')}
                  </Button>
                  <Button
                    className="max-md:hidden"
                    variant={sel ? 'primary' : 'secondary'}
                    disabled={!sel}
                    title={
                      sel
                        ? undefined
                        : t('library.materials.page.selectALotToReceive')
                    }
                    onClick={() => setReceiveOpen(true)}
                  >
                    {t('library.materials.page.receiveLot')}
                  </Button>
                  <Button
                    className="max-md:hidden"
                    variant="secondary"
                    title={t('library.materials.solution.actionHint')}
                    onClick={() => setSolutionOpen(true)}
                  >
                    {t('library.materials.solution.action')}
                  </Button>
                  {/* A phone has room for Scan and Register lot: the rest sit
                      in More, as on Samples. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <IconButton
                          variant="secondary"
                          className="md:hidden"
                          icon="more"
                          label={t('common.actions.more')}
                        />
                      }
                    />
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        disabled={!sel}
                        onClick={() => setReceiveOpen(true)}
                      >
                        {t('library.materials.page.receiveLot')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSolutionOpen(true)}>
                        {t('library.materials.solution.action')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <ReadOnlyNote>
                  {t('common.readOnly.cannotAdd', {
                    things: t('common.readOnly.things.materials'),
                  })}
                </ReadOnlyNote>
              )}
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.materials.page.materialLists')}
              value={tab}
              items={tabs
                .filter((item) => item !== 'spend' || canPlaceOrders)
                .map((item) => ({
                  key: item,
                  label: tabLabel[item],
                  count:
                    item === 'spend'
                      ? undefined
                      : (
                            item === 'orders'
                              ? orders.isPending
                              : item === 'archived'
                                ? archivedCount.isPending
                                : page.isPending
                          )
                        ? undefined
                        : counts[item],
                  link: {
                    to: '/materials',
                    search: {
                      tab: item === 'instock' ? undefined : item,
                      q: search.q ?? '',
                    },
                  },
                }))}
            />
          }
        />
        {tab === 'orders' ? (
          <ReagentOrdersPanel canPlace={canPlaceOrders} canWrite={canWrite} />
        ) : null}
        {tab === 'spend' ? <SpendReportPanel /> : null}
        {!panelTab ? (
          <ListToolbar
            q={search.q}
            label={t('library.materials.page.searchMaterials')}
            placeholder={t('library.materials.page.searchByIdMaterialSupplier')}
            onSearch={(next) =>
              void navigate({
                to: '/materials',
                search: (s) => ({ ...s, q: next || undefined }),
                replace: true,
              })
            }
          />
        ) : null}
        {!panelTab ? (
          <RecordBulkBar
            selection={bulk}
            kind="material"
            restore={tab === 'archived'}
            canWrite={canWrite}
            onChanged={() => {
              void queryClient.invalidateQueries({
                queryKey: materialListQueryKeys.page,
              })
            }}
          />
        ) : null}
        {!panelTab ? (
          <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
            {page.isPending || visible.length > 0 ? (
              <RegistryGrid
                className="max-md:hidden"
                label={t('library.materials.page.materialLots')}
                view={view}
                bulk={bulk}
                rowLabel={(m) => m.id}
                rows={visible}
                columns={columns}
                getRowId={(m) => m.uuid}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                onRowClick={openMaterial}
                isLoading={page.isPending}
              />
            ) : null}
            <MobileList
              label={t('library.materials.page.materialLots')}
              items={visible.map((m) => ({
                key: m.uuid,
                id: m.id,
                title: m.name,
                sub: `${m.stock} · ${m.location}`,
                status: <Status tone={m.status.tone}>{m.status.label}</Status>,
                link: {
                  to: '/materials/$lotId',
                  params: { lotId: m.uuid },
                  onClick: (event: React.MouseEvent) => openMaterial(m, event),
                },
                selected: m.uuid === sel?.uuid,
              }))}
            />
            {!page.isPending && visible.length === 0 ? (
              <div role="status" className="flex justify-center px-6">
                <EmptyState
                  className="items-center py-14 text-center"
                  icon={q ? 'search' : 'box'}
                  title={
                    hasProjectAccess === false
                      ? noProjectAccessTitle('materials')
                      : q
                        ? t('library.materials.page.noMaterialLotsMatch', {
                            q: search.q ?? '',
                          })
                        : tab === 'instock'
                          ? t('library.materials.page.noLotsInStock')
                          : tab === 'archived'
                            ? t('library.materials.page.noArchivedLots')
                            : t('library.materials.page.noLots', {
                                toLowerCase: tabLabel[tab].toLowerCase(),
                              })
                  }
                  description={
                    hasProjectAccess === false
                      ? NO_PROJECT_ACCESS_BODY
                      : q
                        ? t('library.materials.page.searchLooksAtIdMaterial')
                        : tab === 'instock'
                          ? t('library.materials.page.registerAMaterialLotTo')
                          : tab === 'archived'
                            ? t('library.materials.page.archivedStayHere')
                            : t(
                                'library.materials.page.lotsAppearHereWhenTheir',
                              )
                  }
                  action={
                    hasProjectAccess === false ? undefined : q ||
                      tab !== 'instock' ? (
                      <Button
                        nativeButton={false}
                        render={
                          <Link
                            to="/materials"
                            search={{
                              tab: !q && tab !== 'instock' ? undefined : tab,
                            }}
                          />
                        }
                      >
                        {q
                          ? t('library.materials.page.clearSearch')
                          : t('library.materials.page.backToInStock')}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => setRegisterOpen(true)}
                      >
                        {t('library.materials.page.registerLot')}
                      </Button>
                    )
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {!panelTab ? (
          <ListFooter
            loading={page.isPending}
            right={sel ? '1 selected' : undefined}
          >
            {footerCount({
              shown: visible.length,
              total: counts[tab],
              one: 'material lot',
              tab: tabLabel[tab],
            })}
          </ListFooter>
        ) : null}
      </div>

      {sel ? (
        <Inspector
          aria-label={t('library.materials.page.materialLot')}
          className="gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">
              {t('library.materials.page.lot', { id: sel.id, lot: sel.lot })}
            </span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            {sel.expiryNote ? (
              <div className="text-label">
                <Status tone={sel.status.tone}>{sel.expiryNote}</Status>
              </div>
            ) : null}
            <HazardPictograms
              pictograms={safetyMap?.get(sel.uuid)?.pictograms ?? []}
              size={28}
              className="mt-0.5"
            />
            {sel.attention?.label === 'Low stock' ? (
              <div className="text-label">
                <Status tone={sel.attention.tone}>{sel.attention.label}</Status>
                {openOrder ? null : (
                  <span className="ml-2 text-fg-muted">
                    {t('library.materials.orders.lowStockHint')}
                  </span>
                )}
              </div>
            ) : null}
            {openOrder ? (
              <div className="text-label">
                <Link
                  to="/materials"
                  search={{ tab: 'orders' }}
                  className="hover:underline"
                >
                  <Status tone={ORDER_TONE[openOrder.status]}>
                    {t('library.materials.orders.openOrderValue', {
                      reference: openOrder.reference,
                      status: orderStatusLabel(openOrder.status),
                    })}
                  </Status>
                </Link>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link to="/materials/$lotId" params={{ lotId: sel.uuid }} />
                }
              >
                {t('library.materials.page.openLot')}
              </Button>
              <Button
                variant={
                  canWrite && !openOrder && sel.attention?.label === 'Low stock'
                    ? 'secondary'
                    : 'primary'
                }
                size="sm"
                onClick={() => setReplacementOpen(true)}
              >
                {t('library.materials.page.registerReplacementLot')}
              </Button>
              {canWrite && !openOrder ? (
                <Button
                  variant={
                    sel.attention?.label === 'Low stock'
                      ? 'primary'
                      : 'secondary'
                  }
                  size="sm"
                  onClick={() => setReorderOpen(true)}
                >
                  {t('library.materials.orders.requestReorder')}
                </Button>
              ) : null}
              {sel.tabs.includes('quarantine') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  {restore.isPending
                    ? t('library.materials.page.restoring')
                    : t('common.actions.restore')}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={quarantine.isPending}
                  onClick={() => setQuarantineOpen(true)}
                >
                  {t('library.materials.page.quarantine')}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {/* The registry's inspector is a top-level section of the page, so
                its headings are H2 (H1 → H2, no skipped level). */}
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                {t('library.materials.page.lot2')}
              </h2>
              <DescriptionList
                labelWidth={88}
                items={[
                  [
                    'Supplier',
                    sel.catalogNo
                      ? `${sel.supplier} · cat. ${sel.catalogNo}`
                      : sel.supplier,
                  ],
                  ['Received', dayLabel(sel.received)],
                  [
                    t('library.materials.page.releasedBy'),
                    sel.releasedBy
                      ? `${sel.releasedBy} · ${dayLabel(sel.releasedAt)}`
                      : '—',
                  ],
                  [
                    'Certificate',
                    certificate.data ? (
                      <Link
                        to="/records/$recordId"
                        params={{ recordId: certificate.data.fileRecordId }}
                        className="hover:underline"
                      >
                        {certificate.data.displayName}
                      </Link>
                    ) : (
                      (sel.certificate ?? '—')
                    ),
                  ],
                  ['Stock', stockOfTotal(sel)],
                ]}
              />
            </section>
            <MaterialSafetySection
              recordId={sel.uuid}
              name={sel.name}
              projectId={sel.projectId}
              canEdit={canWrite}
            />
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                {replacementLink.data
                  ? t('library.materials.page.replacementLot')
                  : t('library.materials.page.noReplacementLot')}
              </h2>
              <p className="text-label text-fg-muted">
                {replacementLink.data
                  ? `${replacementLink.data.targetIdentifier}${replacementLink.data.reason ? ` · ${replacementLink.data.reason}` : ''}`
                  : t('library.materials.page.noLotHasBeenRegistered')}
              </p>
            </section>
            {usage.data?.length ? (
              <section>
                <h2 className="mb-1.5 font-sans text-label font-semibold">
                  {t('library.materials.page.usedIn')}
                </h2>
                <ul className="flex flex-col gap-1">
                  {usage.data.map((link) => (
                    <li key={link.id} className="text-label">
                      {link.sourceRecordId ? (
                        <Link
                          to="/records/$recordId"
                          params={{ recordId: link.sourceRecordId }}
                          className="mono hover:underline"
                        >
                          {link.sourceIdentifier}
                        </Link>
                      ) : (
                        link.sourceIdentifier
                      )}
                      {link.quantity != null
                        ? ` · ${link.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${link.unit ? ` ${link.quantity === 1 ? link.unit.replace(/s$/, '') : link.unit}` : ''}, ${shortDay(link.createdAt)}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </Inspector>
      ) : null}

      <RequestReorderDialog
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        material={
          sel
            ? { uuid: sel.uuid, id: sel.id, name: sel.name, unit: sel.unit }
            : undefined
        }
      />

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.receiveLot')}
            description={sel ? `${sel.id} · ${sel.name}` : undefined}
          />
          <DialogBody>
            <ReceiveForm
              busy={receive.isPending}
              onSubmit={(input) => receive.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="receive-lot-form"
              disabled={receive.isPending}
            >
              {receive.isPending
                ? t('library.materials.page.receiving')
                : t('library.materials.page.receive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MakeSolutionDialog open={solutionOpen} onOpenChange={setSolutionOpen} />

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.registerMaterialLot')}
          />
          <DialogBody>
            <RegisterLotForm
              busy={register.isPending}
              projects={projects.data ?? new Map()}
              onSubmit={(input) => register.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="register-lot-form"
              disabled={register.isPending}
            >
              {register.isPending
                ? t('library.materials.page.registering')
                : t('library.materials.page.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replacementOpen} onOpenChange={setReplacementOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.materials.page.registerReplacementLot')}
            description={sel ? `${sel.id} · ${sel.name}` : undefined}
          />
          <DialogBody>
            <ReplacementForm
              busy={replacement.isPending}
              unit={sel?.unit ?? null}
              onSubmit={(input) => replacement.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="replacement-lot-form"
              disabled={replacement.isPending}
            >
              {replacement.isPending
                ? t('library.materials.page.registering')
                : t('library.materials.page.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={quarantineOpen} onOpenChange={setQuarantineOpen}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.materials.page.quarantineThisLot')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {sel ? `${sel.id} · ${sel.name}. ` : ''}
              {t('library.materials.page.aQuarantinedLotIsHeld')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Textarea
            className="mx-5 my-3 box-border min-h-[70px] w-[calc(100%-2.5rem)]"
            placeholder={t('library.materials.page.whyIsThisLotHeld')}
            value={quarantineReason}
            onChange={(event) => setQuarantineReason(event.target.value)}
          />
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={quarantine.isPending}
              onClick={() => quarantine.mutate(quarantineReason)}
            >
              {quarantine.isPending
                ? t('library.materials.page.quarantining')
                : t('library.materials.page.quarantine')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

interface RegisterLotInput {
  projectId: string
  title: string
  supplier?: string
  catalogNo?: string
  lot?: string
  expiry?: string
  quantity: number
  unit?: string
  storage?: string
  customFields?: Record<string, unknown>
  typeKey?: string | null
  typeFields?: Record<string, unknown>
}

function RegisterLotForm({
  busy,
  projects,
  onSubmit,
}: {
  busy: boolean
  projects: Map<string, string>
  onSubmit: (input: RegisterLotInput) => void
}) {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [supplier, setSupplier] = useState('')
  const [catalogNo, setCatalogNo] = useState('')
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [storage, setStorage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const addedFields = useAddedFieldDraft('material')
  const [tried, setTried] = useState(false)
  const fillFields = [
    { key: 'name', label: t('library.materials.page.material') },
    { key: 'supplier', label: t('library.materials.page.supplier') },
    { key: 'catalogNo', label: t('library.materials.page.catalogueNo') },
    { key: 'lot', label: t('library.materials.page.lotNumber') },
    {
      key: 'expiry',
      label: t('library.materials.page.expiry'),
      hint: t('library.fill.hintDate'),
    },
    {
      key: 'quantity',
      label: t('library.materials.page.quantity'),
      hint: t('library.fill.hintNumber'),
    },
    { key: 'unit', label: t('library.materials.page.unit') },
    {
      key: 'storage',
      label: t('library.materials.page.storageLocation'),
    },
    ...addedFillFields(addedFields.fields),
  ]
  return (
    <form
      id="register-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        const next: Record<string, string> = {}
        if (!projectId)
          next.project = t('library.materials.page.chooseTheProjectThatOwns')
        if (!title.trim())
          next.title = t('library.materials.page.enterTheMaterialName')
        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0)
          next.quantity = t('library.materials.page.enterAQuantityGreaterThan')
        if (expiry && expiry < todayISO())
          next.expiry = t('library.materials.page.theExpiryMustBeToday')
        setErrors(next)
        setTried(true)
        if (Object.keys(next).length || !addedFields.valid) return
        onSubmit({
          projectId,
          title: title.trim(),
          supplier: supplier.trim() || undefined,
          catalogNo: catalogNo.trim() || undefined,
          lot: lot.trim() || undefined,
          expiry: expiry || undefined,
          quantity: n,
          unit: unit.trim() || undefined,
          storage: storage.trim() || undefined,
          customFields: addedFields.rootPayload(),
          typeKey: addedFields.typeKey,
          typeFields: addedFields.payload(),
        })
      }}
    >
      <FillFromText
        fields={fillFields}
        onFill={(values) => {
          if (values.name) setTitle(values.name)
          if (values.supplier) setSupplier(values.supplier)
          if (values.catalogNo) setCatalogNo(values.catalogNo)
          if (values.lot) setLot(values.lot)
          if (values.expiry && onlyIsoDate(values.expiry))
            setExpiry(values.expiry)
          if (values.quantity && Number.isFinite(Number(values.quantity)))
            setQuantity(values.quantity)
          if (values.unit) setUnit(values.unit)
          if (values.storage) setStorage(values.storage)
          for (const [key, value] of Object.entries(values)) {
            if (key.startsWith('field:'))
              addedFields.setValue(key.slice(6), value)
          }
        }}
      />
      <Field
        label={t('library.materials.page.project')}
        required
        error={errors.project}
      >
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={busy}
        >
          <option value="">{t('library.materials.page.choose')}</option>
          {[...projects].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('library.materials.page.material')}
        required
        error={errors.title}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('library.materials.page.supplier')}>
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.catalogueNo')}>
          <Input
            value={catalogNo}
            onChange={(e) => setCatalogNo(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.lotNumber')}>
          <Input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.expiry')} error={errors.expiry}>
          <Input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field
          label={t('library.materials.page.quantity')}
          required
          error={errors.quantity}
        >
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label={t('library.materials.page.unit')}>
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>
      <Field label={t('library.materials.page.storageLocation')}>
        <Input
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          disabled={busy}
        />
      </Field>
      <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
    </form>
  )
}

export function ReplacementForm({
  busy,
  unit,
  onSubmit,
}: {
  busy: boolean
  unit: string | null
  onSubmit: (input: {
    lot: string
    expiry: string
    quantity: number
    unit?: string
    reason?: string
  }) => void
}) {
  const [lot, setLot] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitValue, setUnitValue] = useState(unit ?? '')
  const [reason, setReason] = useState('')
  const [lotError, setLotError] = useState<string | null>(null)
  const [expiryError, setExpiryError] = useState<string | null>(null)
  const [quantityError, setQuantityError] = useState<string | null>(null)
  return (
    <form
      id="replacement-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        // A refused submission states why: the form never returns silently.
        const lotProblem = lot.trim()
          ? null
          : t('library.materials.page.enterTheReplacementLot')
        const expiryProblem = !expiry
          ? t('library.materials.page.enterTheReplacementLotsExpiry')
          : expiry < todayISO()
            ? t('library.materials.page.theExpiryMustBeToday')
            : null
        const quantityProblem =
          quantity.trim() === '' || !Number.isFinite(n) || n <= 0
            ? t('library.materials.page.enterAQuantityGreaterThan')
            : null
        setLotError(lotProblem)
        setExpiryError(expiryProblem)
        setQuantityError(quantityProblem)
        if (lotProblem || expiryProblem || quantityProblem) return
        onSubmit({
          lot: lot.trim(),
          expiry,
          quantity: n,
          unit: unitValue.trim() || undefined,
          reason: reason.trim() || undefined,
        })
      }}
    >
      <Field
        label={t('library.materials.page.lotNumber')}
        required
        error={lotError}
      >
        <Input
          value={lot}
          aria-invalid={lotError !== null}
          onChange={(e) => {
            setLot(e.target.value)
            setLotError(null)
          }}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Field
        label={t('library.materials.page.expiry')}
        required
        error={expiryError}
      >
        <Input
          type="date"
          value={expiry}
          aria-invalid={expiryError !== null}
          onChange={(e) => {
            setExpiry(e.target.value)
            setExpiryError(null)
          }}
          disabled={busy}
        />
      </Field>
      <Field
        label={t('library.materials.page.quantity')}
        required
        error={quantityError}
      >
        <Input
          type="number"
          value={quantity}
          aria-invalid={quantityError !== null}
          onChange={(e) => {
            setQuantity(e.target.value)
            setQuantityError(null)
          }}
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.unit')}>
        <Input
          value={unitValue}
          onChange={(e) => setUnitValue(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.reason')}>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}

function ReceiveForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (input: { quantity: number; reason?: string }) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [quantityError, setQuantityError] = useState<string | null>(null)
  return (
    <form
      id="receive-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        // A refused submission states why: the form never returns silently. The
        // browser empties a number field that holds letters, so an empty value
        // is the same refusal as a zero.
        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0) {
          setQuantityError(
            t('library.materials.page.enterTheQuantityReceivedGreater'),
          )
          return
        }
        setQuantityError(null)
        onSubmit({ quantity: n, reason: reason || undefined })
      }}
    >
      <Field
        label={t('library.materials.page.quantity')}
        required
        error={quantityError}
      >
        <Input
          type="number"
          value={quantity}
          aria-invalid={quantityError !== null}
          onChange={(e) => {
            setQuantity(e.target.value)
            setQuantityError(null)
          }}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.page.reason')}>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}
