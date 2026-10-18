import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/v3/projects/project-access'
import { Select } from '#/components/v3/ui/select'
import { useProjectNames } from '#/components/v3/samples/samples-data'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Inspector } from '#/components/v3/ui/layout'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Field, Input } from '#/components/v3/ui/input'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  Textarea,
} from '#/components/v3/inventory/list'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  materialListQueryKeys,
  toMaterialListRow,
  useReagentPage,
} from '#/components/v3/materials/materials-data'
import type { MaterialListRow } from '#/components/v3/materials/materials-data'
import {
  createReagent,
  fetchCertificateFile,
  fetchReplacementLot,
  fetchReagentUsage,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import type { Reagent } from '#/lib/reagent-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['instock', 'expiring', 'quarantine', 'expired'] as const

/** The orderings the registry offers. Every key is one the list can actually
 * apply: the route sorts the lots it fetched by the chosen field. */
const sorts = ['Expiry', 'ID', 'Material'] as const
type MaterialSort = (typeof sorts)[number]

/** Today as a date input states it — the local calendar day, because that is
 * what a `type=date` field hands back. */
function todayISO(): string {
  const now = new Date()
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
function stockOfTotal(row: MaterialListRow): string {
  const unit = row.unit ? ` ${row.unit}` : ''
  const current = row.stock
  if (row.initialQuantity == null) return current
  const total = row.initialQuantity.toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
  return `${current.replace(unit, '')} of ${total}${unit}`
}
type MaterialTab = (typeof tabs)[number]
/** The `expiring` tab is each lot's own expiry warning window (30 days by
 * default, overridable per lot in its reagent properties), so its label claims
 * no fixed window. */
const tabLabel: Record<MaterialTab, string> = {
  instock: 'In stock',
  expiring: 'Expiring soon',
  quarantine: 'Quarantine',
  expired: 'Expired',
}

/** UI port (roadmap-4/ui-app3): the materials registry list, wired to real
 * material records. Receive lot writes through record_reagent_movement. */
export const Route = createFileRoute('/materials')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: MaterialTab; selected?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab:
      search.tab === 'expiring' ||
      search.tab === 'quarantine' ||
      search.tab === 'expired' ||
      search.tab === 'instock'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: MaterialsList,
})

function MaterialsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = useReagentPage()
  const queryClient = useQueryClient()
  const tab: MaterialTab = search.tab ?? 'instock'
  const [selected, setSelected] = useState<string | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const projects = useProjectNames()
  const hasProjectAccess = useHasProjectAccess()
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  const [sort, setSort] = useState<MaterialSort>('Expiry')

  const rows = useMemo(() => {
    const by: Record<MaterialSort, (a: Reagent, b: Reagent) => number> = {
      // Soonest expiry first, so the lot that lapses next leads the list; a lot
      // with no expiry is not imminent and sorts after every dated one.
      Expiry: (a, b) => {
        if (a.expiry === b.expiry) return 0
        if (a.expiry === null) return 1
        if (b.expiry === null) return -1
        return a.expiry.localeCompare(b.expiry)
      },
      ID: (a, b) =>
        a.identifier.localeCompare(b.identifier, 'en-GB', { numeric: true }),
      Material: (a, b) => a.title.localeCompare(b.title),
    }
    return [...(page.data?.rows ?? [])].sort(by[sort]).map(toMaterialListRow)
  }, [page.data, sort])

  const inTab = (r: MaterialListRow, t: MaterialTab): boolean =>
    r.tabs.includes(t)
  const counts = Object.fromEntries(
    tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
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

  // A link such as `?selected=<lot>` names a lot, not a tab. When that lot lives
  // on another tab (an expired or quarantined lot, say) move to the tab that
  // holds it instead of selecting the first row of the wrong list.
  const linked = search.selected
    ? rows.find((r) => r.uuid === search.selected)
    : undefined
  const linkedTab =
    linked && !inTab(linked, tab)
      ? tabs.find((t) => inTab(linked, t))
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

  const columns = useMemo<RegistryColumn<MaterialListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      { id: 'material', header: 'Material', accessorFn: (m) => m.name },
      { id: 'supplier', header: 'Supplier', accessorFn: (m) => m.supplier },
      { id: 'lot', header: 'Lot', accessorFn: (m) => m.lot },
      {
        id: 'stock',
        header: 'Stock',
        accessorFn: (m) => m.stock,
        meta: rightAligned<MaterialListRow>().meta,
      },
      { id: 'location', header: 'Location', accessorFn: (m) => m.location },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Status tone={row.original.status.tone}>
            {row.original.status.label}
          </Status>
        ),
      },
    ],
    [],
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
      toast('Lot quarantined')
      setQuarantineOpen(false)
      setQuarantineReason('')
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not quarantine lot')
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
      toast('Lot restored')
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not restore lot')
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
      toast('Replacement lot registered')
      setReplacementOpen(false)
    },
    onError: (error: unknown) => {
      toast(
        error instanceof Error
          ? error.message
          : 'Could not register the replacement lot',
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
    mutationFn: (input: RegisterLotInput) =>
      createReagent(notebookDataClient, {
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
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: materialListQueryKeys.page,
      })
      toast(`Lot ${created.identifier} registered`)
      setRegisterOpen(false)
      void navigate({
        to: '/materials',
        search: { selected: created.id },
        replace: true,
      })
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not register lot')
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
      toast('Lot received')
      setReceiveOpen(false)
    },
    onError: (error: unknown) => {
      toast(error instanceof Error ? error.message : 'Could not receive lot')
    },
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Materials"
          total={page.data?.total}
          actions={
            <>
              <Button
                icon="scan"
                nativeButton={false}
                render={<Link to="/scan" />}
              >
                Scan label
              </Button>
              <Button
                variant={sel ? 'secondary' : 'primary'}
                onClick={() => setRegisterOpen(true)}
              >
                Register lot
              </Button>
              <Button
                variant={sel ? 'primary' : 'secondary'}
                disabled={!sel}
                title={
                  sel
                    ? undefined
                    : 'Select a lot to receive more stock into it, or register a new lot.'
                }
                onClick={() => setReceiveOpen(true)}
              >
                Receive lot
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label="Material lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
                link: {
                  to: '/materials',
                  search: { tab: t === 'instock' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search materials"
          placeholder="Search by ID, material, supplier, lot"
          views={{
            sorts: [...sorts],
            sort,
            onSort: (s) => setSort(s as MaterialSort),
            showSortValue: false,
            groupLabel: '',
          }}
          onSearch={(next) =>
            void navigate({
              to: '/materials',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {page.isLoading || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Material lots"
              rows={visible}
              columns={columns}
              getRowId={(m) => m.uuid}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              isLoading={page.isLoading}
            />
          ) : null}
          <MobileList
            label="Material lots"
            items={visible.map((m) => ({
              key: m.uuid,
              id: m.id,
              title: m.name,
              sub: `${m.stock} · ${m.location}`,
              status: <Status tone={m.status.tone}>{m.status.label}</Status>,
              onSelect: () => setSelected(m.uuid),
              selected: m.uuid === sel?.uuid,
            }))}
          />
          {!page.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                className="items-center py-14 text-center"
                icon={q ? 'search' : 'box'}
                title={
                  hasProjectAccess === false
                    ? noProjectAccessTitle('materials')
                    : q
                      ? `No material lots match “${search.q}”`
                      : tab === 'instock'
                        ? 'No lots in stock'
                        : `No ${tabLabel[tab].toLowerCase()} lots`
                }
                description={
                  hasProjectAccess === false
                    ? NO_PROJECT_ACCESS_BODY
                    : q
                      ? 'Search looks at ID, material, supplier, lot and location.'
                      : tab === 'instock'
                        ? 'Register a material lot to start the inventory.'
                        : 'Lots appear here when their status or expiry puts them in this list.'
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
                      {q ? 'Clear search' : 'Back to in stock'}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setRegisterOpen(true)}
                    >
                      Register lot
                    </Button>
                  )
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {visible.length} of {counts[tab]} {tabLabel[tab].toLowerCase()}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector aria-label="Material lot" className="gap-0 p-0">
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">
              {sel.id} · lot {sel.lot}
            </span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            {sel.expiryNote ? (
              <div className="text-label">
                <Status tone={sel.status.tone}>{sel.expiryNote}</Status>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setReplacementOpen(true)}
              >
                Register replacement lot
              </Button>
              {sel.tabs.includes('quarantine') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  {restore.isPending ? 'Restoring…' : 'Restore'}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={quarantine.isPending}
                  onClick={() => setQuarantineOpen(true)}
                >
                  Quarantine
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {/* The registry's inspector is a top-level section of the page, so
                its headings are H2 (H1 → H2, no skipped level). */}
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">Lot</h2>
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
                    'Released by',
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
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                {replacementLink.data
                  ? 'Replacement lot'
                  : 'No replacement lot'}
              </h2>
              <p className="text-label text-fg-muted">
                {replacementLink.data
                  ? `${replacementLink.data.targetIdentifier}${replacementLink.data.reason ? ` · ${replacementLink.data.reason}` : ''}`
                  : 'No lot has been registered to replace this one.'}
              </p>
            </section>
            {usage.data?.length ? (
              <section>
                <h2 className="mb-1.5 font-sans text-label font-semibold">
                  Used in
                </h2>
                <ul className="flex flex-col gap-1">
                  {usage.data.map((link) => (
                    <li key={link.id} className="text-label">
                      {link.sourceIdentifier}
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

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title="Receive lot"
            description={sel ? `${sel.id} · ${sel.name}` : undefined}
          />
          <DialogBody>
            <ReceiveForm
              busy={receive.isPending}
              onSubmit={(input) => receive.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="receive-lot-form"
              disabled={receive.isPending}
            >
              {receive.isPending ? 'Receiving…' : 'Receive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader title="Register material lot" />
          <DialogBody>
            <RegisterLotForm
              busy={register.isPending}
              projects={projects.data ?? new Map()}
              onSubmit={(input) => register.mutate(input)}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="register-lot-form"
              disabled={register.isPending}
            >
              {register.isPending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replacementOpen} onOpenChange={setReplacementOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title="Register replacement lot"
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
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              type="submit"
              form="replacement-lot-form"
              disabled={replacement.isPending}
            >
              {replacement.isPending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={quarantineOpen} onOpenChange={setQuarantineOpen}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>Quarantine this lot?</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {sel ? `${sel.id} · ${sel.name}. ` : ''}A quarantined lot is held
              aside and experiments cannot use it until it is restored.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Textarea
            className="min-h-[70px]"
            placeholder="Why is this lot held? (optional)…"
            value={quarantineReason}
            onChange={(event) => setQuarantineReason(event.target.value)}
          />
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={quarantine.isPending}
              onClick={() => quarantine.mutate(quarantineReason)}
            >
              {quarantine.isPending ? 'Quarantining…' : 'Quarantine'}
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
  return (
    <form
      id="register-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)
        const next: Record<string, string> = {}
        if (!projectId) next.project = 'Choose the project that owns this lot.'
        if (!title.trim()) next.title = 'Enter the material name.'
        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0)
          next.quantity = 'Enter a quantity greater than zero.'
        if (expiry && expiry < todayISO())
          next.expiry = 'The expiry must be today or later.'
        setErrors(next)
        if (Object.keys(next).length) return
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
        })
      }}
    >
      <Field label="Project" required error={errors.project}>
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={busy}
        >
          <option value="">Choose…</option>
          {[...projects].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Material" required error={errors.title}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier">
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Catalogue no.">
          <Input
            value={catalogNo}
            onChange={(e) => setCatalogNo(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Lot number">
          <Input
            value={lot}
            onChange={(e) => setLot(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Expiry" error={errors.expiry}>
          <Input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Quantity" required error={errors.quantity}>
          <Input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Unit">
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>
      <Field label="Storage location">
        <Input
          value={storage}
          onChange={(e) => setStorage(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}

function ReplacementForm({
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
        const lotProblem = lot.trim() ? null : 'Enter the replacement lot.'
        const expiryProblem = !expiry
          ? 'Enter the replacement lot’s expiry date.'
          : expiry < todayISO()
            ? 'The expiry must be today or later.'
            : null
        const quantityProblem =
          quantity.trim() === '' || !Number.isFinite(n) || n <= 0
            ? 'Enter a quantity greater than zero.'
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
      <Field label="Lot number" required error={lotError}>
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
      <Field label="Expiry" required error={expiryError}>
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
      <Field label="Quantity" required error={quantityError}>
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
      <Field label="Unit">
        <Input
          value={unitValue}
          onChange={(e) => setUnitValue(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label="Reason">
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
          setQuantityError('Enter the quantity received, greater than zero.')
          return
        }
        setQuantityError(null)
        onSubmit({ quantity: n, reason: reason || undefined })
      }}
    >
      <Field label="Quantity" required error={quantityError}>
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
      <Field label="Reason">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}
