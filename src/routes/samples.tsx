import { useEffect, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/v3/projects/project-access'
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
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { Select } from '#/components/v3/ui/select'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
} from '#/components/v3/inventory/list'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  sampleListQueryKeys,
  toSampleListRow,
  useProjectNames,
  useSamplePage,
} from '#/components/v3/samples/samples-data'
import type { SampleListRow } from '#/components/v3/samples/samples-data'
import { createSample } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'

const tabs = ['instock', 'mine', 'awaiting', 'quarantine', 'consumed'] as const
type SampleTab = (typeof tabs)[number]
const tabLabel: Record<SampleTab, string> = {
  instock: 'In stock',
  mine: 'Mine',
  awaiting: 'Reserved',
  quarantine: 'Quarantine',
  consumed: 'Consumed',
}

/** UI port (roadmap-4/ui-app3): the sample registry list, wired to real sample
 * records. The detail route and the custody dialogs follow. */
export const Route = createFileRoute('/samples')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: SampleTab; new?: boolean; selected?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab:
      search.tab === 'mine' ||
      search.tab === 'awaiting' ||
      search.tab === 'quarantine' ||
      search.tab === 'consumed' ||
      search.tab === 'instock'
        ? search.tab
        : undefined,
    new: search.new === true || search.new === 'true' || undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: SamplesRoute,
})

function SamplesRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/samples',
  })
  return isIndex ? <SamplesList /> : <Outlet />
}

function SamplesList() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = useSamplePage()
  const projects = useProjectNames()
  const queryClient = useQueryClient()
  const tab: SampleTab = search.tab ?? 'instock'
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      (page.data?.rows ?? []).map((r) =>
        toSampleListRow(r, projects.data ?? new Map(), context.user.id),
      ),
    [page.data, projects.data, context.user.id],
  )

  const inTab = (r: SampleListRow, t: SampleTab): boolean =>
    t === 'instock' ? r.tabs.includes('instock') : r.tabs.includes(t)
  const counts = Object.fromEntries(
    tabs.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
  ) as Record<SampleTab, number>
  const q = (search.q ?? '').trim().toLowerCase()
  const hasProjectAccess = useHasProjectAccess()
  const visible = rows
    .filter((r) => inTab(r, tab))
    .filter(
      (r) =>
        !q ||
        [r.id, r.name, r.type, r.location].some((v) =>
          v.toLowerCase().includes(q),
        ),
    )
  const sel =
    visible.find((r) => r.uuid === (selected ?? search.selected)) ??
    visible.at(0)

  // `?selected=<sample>` names a sample, not a tab: move to the tab that holds
  // it rather than selecting the first row of the wrong list.
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
      to: '/samples',
      search: (s) => ({
        ...s,
        tab: linkedTab === 'instock' ? undefined : linkedTab,
        q: undefined,
      }),
      replace: true,
    })
  }, [linkedTab, navigate])

  const columns = useMemo<RegistryColumn<SampleListRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <Link
            to="/samples/$sampleId"
            params={{ sampleId: row.original.uuid }}
            onClick={(event) => event.stopPropagation()}
            // The selected row is the one the inspector shows, and the
            // bespoke body gave that row's name the medium weight.
            className={
              row.original.uuid === sel?.uuid ? 'font-medium' : undefined
            }
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: 'type', header: 'Type', accessorFn: (s) => s.type },
      {
        id: 'quantity',
        header: 'Quantity',
        accessorFn: (s) => s.quantity,
        meta: rightAligned<SampleListRow>().meta,
      },
      { id: 'location', header: 'Location', accessorFn: (s) => s.location },
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
    [sel?.uuid],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.uuid ?? null,
    setSelected,
  )

  const create = useMutation({
    mutationFn: (input: {
      projectId: string
      title: string
      sampleType?: string
      quantity?: string
      quantityUnit?: string
      storageLocation?: string
    }) =>
      createSample(notebookDataClient, {
        projectId: input.projectId,
        title: input.title,
        properties: {
          sampleType: input.sampleType,
          quantity: input.quantity ? Number(input.quantity) : undefined,
          quantityUnit: input.quantityUnit,
          storageLocation: input.storageLocation,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })
      toast('Sample registered')
      void navigate({
        to: '/samples',
        search: (s) => ({ ...s, new: undefined }),
      })
    },
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Samples"
          total={page.data?.totalCount}
          actions={
            <>
              <Button
                icon="scan"
                nativeButton={false}
                render={<Link to="/scan" />}
              >
                Scan label
              </Button>
              <Button nativeButton={false} render={<Link to="/import" />}>
                Import
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  navigate({ to: '/samples', search: { new: true } })
                }
              >
                Register sample
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label="Sample lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
                link: {
                  to: '/samples',
                  search: { tab: t === 'instock' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search samples"
          placeholder="Search by ID, name, location"
          views={{
            sorts: ['Created', 'ID', 'Name'],
            fields: ['ID', 'Name', 'Type', 'Quantity', 'Location', 'Status'],
          }}
          onSearch={(next) =>
            void navigate({
              to: '/samples',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {page.isLoading || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Samples"
              rows={visible}
              columns={columns}
              getRowId={(s) => s.uuid}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              isLoading={page.isLoading}
            />
          ) : null}
          <MobileList
            label="Samples"
            items={visible.map((s) => ({
              key: s.uuid,
              id: s.id,
              title: s.name,
              sub: `${s.quantity} · ${s.location}`,
              status: <Status tone={s.status.tone}>{s.status.label}</Status>,
              onSelect: () => setSelected(s.uuid),
              selected: s.uuid === sel?.uuid,
            }))}
          />
          {!page.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                className="items-center py-14 text-center"
                icon={q ? 'search' : 'tube'}
                title={
                  hasProjectAccess === false
                    ? noProjectAccessTitle('samples')
                    : q
                      ? `No samples match “${search.q}”`
                      : `No samples in ${tabLabel[tab].toLowerCase()}`
                }
                description={
                  hasProjectAccess === false
                    ? NO_PROJECT_ACCESS_BODY
                    : q
                      ? 'Search looks at ID, name, type and location.'
                      : 'Register a sample or import a plate map to start the registry.'
                }
                action={
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        to="/samples"
                        search={{ tab: tab === 'instock' ? undefined : tab }}
                      />
                    }
                  >
                    {q ? 'Clear search' : 'Back to in stock'}
                  </Button>
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
        <Inspector aria-label="Sample summary" className="gap-0 p-0">
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.id}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            <div className="text-label">
              <Status tone={sel.status.tone}>
                {sel.status.label}
                {sel.quantity !== '—' ? ` · ${sel.quantity}` : ''}
              </Status>
            </div>
            <div className="mt-1.5">
              <Button
                size="sm"
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/samples/$sampleId"
                    params={{ sampleId: sel.uuid }}
                  />
                }
              >
                Open sample
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {/* The registry's inspector is a top-level section of the page, so
                its heading is an H2 (H1 → H2, no skipped level). */}
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                Key properties
              </h2>
              <DescriptionList
                labelWidth={104}
                items={[
                  ['Type', sel.type],
                  ['Quantity', sel.quantity],
                  ['Location', sel.location],
                  ['Project', sel.project],
                ]}
              />
            </section>
          </div>
        </Inspector>
      ) : null}

      <RegisterSampleDialog
        open={Boolean(search.new)}
        busy={create.isPending}
        projects={[...(projects.data ?? new Map()).entries()].map(
          ([id, title]) => ({ id, title }),
        )}
        onOpenChange={(open) => {
          if (!open)
            void navigate({
              to: '/samples',
              search: (s) => ({ ...s, new: undefined }),
              replace: true,
            })
        }}
        onRegister={(input) => create.mutate(input)}
      />
    </div>
  )
}

function RegisterSampleDialog({
  open,
  busy,
  onOpenChange,
  projects,
  onRegister,
}: {
  open: boolean
  busy: boolean
  projects: { id: string; title: string }[]
  onOpenChange: (open: boolean) => void
  onRegister: (input: {
    projectId: string
    title: string
    sampleType?: string
    quantity?: string
    quantityUnit?: string
    storageLocation?: string
  }) => void
}) {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [sampleType, setSampleType] = useState('')
  const [quantity, setQuantity] = useState('')
  const [quantityUnit, setQuantityUnit] = useState('mL')
  const [storageLocation, setStorageLocation] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title="Register sample" />
        <DialogBody>
          <Field label="Project" required>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Choose…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Type">
            <Input
              value={sampleType}
              onChange={(e) => setSampleType(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Unit">
              <Select
                value={quantityUnit}
                onChange={(e) => setQuantityUnit(e.target.value)}
              >
                {['mL', 'µL', 'mg', 'µg', 'vial'].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Storage location">
            <Input
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !projectId}
            onClick={() =>
              onRegister({
                projectId,
                title: title.trim(),
                sampleType: sampleType || undefined,
                quantity: quantity || undefined,
                quantityUnit,
                storageLocation: storageLocation || undefined,
              })
            }
          >
            {busy ? 'Registering…' : 'Register sample'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
