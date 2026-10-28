import { useEffect, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/v3/projects/project-access'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { samplePath } from '#/lib/navigation'
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
  footerCount,
} from '#/components/v3/inventory/list'
import { Tabs } from '#/components/v3/ui/tabs'
import { BulkRegisterDialog } from '#/components/v3/samples/bulk-register-dialog'
import { SampleInspector } from '#/components/v3/samples/sample-inspector'
import { LocationInput } from '#/components/v3/samples/location-field'
import { PrintLabelsDialog } from '#/components/v3/samples/sample-label-sheet'
import {
  distinctLocations,
  sampleListQueryKeys,
  toSampleListRow,
  useProjectNames,
  useSamplePage,
} from '#/components/v3/samples/samples-data'
import type { SampleListRow } from '#/components/v3/samples/samples-data'
import { parseCreateContext } from '#/lib/create-context-search'
import { linkExperimentToSample } from '#/lib/notebook-create'
import { createSample } from '#/lib/samples'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['instock', 'mine', 'awaiting', 'quarantine', 'consumed'] as const
type SampleTab = (typeof tabs)[number]
const tabLabel: Record<SampleTab, string> = {
  instock: 'In stock',
  mine: 'Mine',
  awaiting: 'Reserved',
  quarantine: 'Quarantine',
  consumed: 'Consumed',
}

function pickSampleContext(search: Record<string, unknown>) {
  const { project, experiment, returnTo } = parseCreateContext(search)
  return { project, experiment, returnTo }
}

/** UI port (roadmap-4/ui-app3): the sample registry list, wired to real sample
 * records. The detail route and the custody dialogs follow. */
export const Route = createFileRoute('/samples')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    q?: string
    tab?: SampleTab
    new?: boolean
    bulk?: boolean
    selected?: string
    project?: string
    experiment?: string
    returnTo?: string
  } => ({
    // The shared create-context params: the project or experiment the sample
    // is registered for, and where closing the dialog goes back to.
    ...pickSampleContext(search),
    q: typeof search.q === 'string' ? search.q : undefined,
    // The project in view travels in, so a registration starts on it.
    project:
      typeof search.project === 'string' && search.project
        ? search.project
        : undefined,
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
    bulk: search.bulk === true || search.bulk === 'true' || undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
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
  const openSample = useOpenRow<SampleListRow>(
    navigate,
    (row) => samplePath(row.uuid),
    (row) => row.name,
  )
  const page = useSamplePage()
  const projects = useProjectNames()
  const queryClient = useQueryClient()
  const tab: SampleTab = search.tab ?? 'instock'
  const [selected, setSelected] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  // Newest first, as the board's "Sort: Created" reads. Identifiers are issued
  // in order, so the highest is the latest registered.
  const rows = useMemo(
    () =>
      (page.data?.rows ?? [])
        .map((r) =>
          toSampleListRow(r, projects.data ?? new Map(), context.user.id),
        )
        .sort((a, b) => b.id.localeCompare(a.id)),
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
  const recordsById = new Map((page.data?.rows ?? []).map((r) => [r.id, r]))
  const printable = visible.flatMap((r) => recordsById.get(r.uuid) ?? [])
  const projectOptions = [...(projects.data ?? new Map()).entries()].map(
    ([id, title]) => ({ id, title }),
  )
  const locations = distinctLocations(rows.map((r) => r.location))
  const sel = visible.find((r) => r.uuid === (selected ?? search.selected))

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
            onClick={(event) => openSample(row.original, event)}
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
    [sel?.uuid, openSample],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.uuid ?? null,
    setSelected,
  )

  // A sample registered for an experiment goes into that experiment's project
  // and is linked to it.
  const forExperiment = useQuery({
    queryKey: ['ui-port', 'samples', 'register-for', search.experiment],
    queryFn: () =>
      notebookDataClient
        .list<{ id: string; identifier: string; project_id: string | null }>(
          'records',
          `?id=eq.${encodeURIComponent(search.experiment ?? '')}&kind=eq.experiment&select=id,identifier,project_id&limit=1`,
        )
        .then((found) => found[0] ?? null),
    enabled: Boolean(search.experiment),
  })
  const defaultProjectId =
    search.project ?? forExperiment.data?.project_id ?? undefined

  const create = useMutation({
    mutationFn: async (input: {
      projectId: string
      title: string
      sampleType?: string
      quantity?: string
      quantityUnit?: string
      storageLocation?: string
    }) => {
      const created = await createSample(notebookDataClient, {
        projectId: input.projectId,
        title: input.title,
        properties: {
          sampleType: input.sampleType,
          quantity: input.quantity ? Number(input.quantity) : undefined,
          quantityUnit: input.quantityUnit,
          storageLocation: input.storageLocation,
        },
      })
      let linkError: string | null = null
      if (search.experiment) {
        try {
          await linkExperimentToSample(notebookDataClient, search.experiment, {
            identifier: created.identifier,
            recordId: created.id,
          })
        } catch (error) {
          linkError =
            error instanceof Error ? error.message : 'The link was refused.'
        }
      }
      return { created, linkError }
    },
    onSuccess: ({ created, linkError }) => {
      void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })
      if (search.experiment) {
        void queryClient.invalidateQueries({
          queryKey: ['ui-port', 'experiment-links', search.experiment],
        })
      }
      toast(
        linkError ? 'Sample registered, not linked' : 'Sample registered',
        linkError
          ? {
              description: `It could not be linked to the experiment: ${linkError}`,
            }
          : search.experiment
            ? { description: 'Linked to the experiment.' }
            : undefined,
      )
      // Land on the new sample, not back on the list it was registered from.
      void navigate({
        to: '/samples/$sampleId',
        params: { sampleId: created.id },
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
                disabled={visible.length === 0}
                onClick={() => setPrintOpen(true)}
              >
                Print labels
              </Button>
              <Button
                onClick={() =>
                  navigate({
                    to: '/samples',
                    search: (s) => ({ ...s, bulk: true }),
                  })
                }
              >
                Register from list
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  navigate({
                    to: '/samples',
                    search: (s) => ({ ...s, new: true }),
                  })
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
                count: page.isPending ? undefined : counts[t],
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
          {page.isPending || visible.length > 0 ? (
            <RegistryGrid
              className="max-md:hidden"
              label="Samples"
              rows={visible}
              columns={columns}
              getRowId={(s) => s.uuid}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={openSample}
              isLoading={page.isPending}
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
              link: {
                to: '/samples/$sampleId',
                params: { sampleId: s.uuid },
                onClick: (event: React.MouseEvent) => openSample(s, event),
              },
              selected: s.uuid === sel?.uuid,
            }))}
          />
          {!page.isPending && visible.length === 0 ? (
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
        <ListFooter
          loading={page.isPending}
          right={sel ? '1 selected' : undefined}
        >
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'sample',
            tab: tabLabel[tab],
          })}
        </ListFooter>
      </div>

      {sel && recordsById.get(sel.uuid) ? (
        <SampleInspector sample={recordsById.get(sel.uuid)!} />
      ) : null}

      <RegisterSampleDialog
        open={Boolean(search.new)}
        busy={create.isPending}
        projects={[...(projects.data ?? new Map()).entries()].map(
          ([id, title]) => ({ id, title }),
        )}
        initialProjectId={defaultProjectId}
        locations={locations}
        onOpenChange={(open) => {
          if (open) return
          // Cancel goes back to the page the dialog was opened from.
          if (search.returnTo) {
            void navigate({ href: search.returnTo })
            return
          }
          void navigate({
            to: '/samples',
            search: (s) => ({ ...s, new: undefined }),
            replace: true,
          })
        }}
        onRegister={(input) => create.mutate(input)}
      />
      <BulkRegisterDialog
        open={Boolean(search.bulk)}
        projects={projectOptions}
        defaultProjectId={search.project}
        onOpenChange={(open) => {
          if (!open)
            void navigate({
              to: '/samples',
              search: (s) => ({ ...s, bulk: undefined }),
              replace: true,
            })
        }}
        onRegistered={() =>
          void queryClient.invalidateQueries({
            queryKey: sampleListQueryKeys.page,
          })
        }
      />
      <PrintLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        records={printable}
        scope={`the ${printable.length} ${tabLabel[tab].toLowerCase()} samples shown`}
        onPrinted={() =>
          void queryClient.invalidateQueries({
            queryKey: sampleListQueryKeys.page,
          })
        }
      />
    </div>
  )
}

function RegisterSampleDialog({
  open,
  busy,
  onOpenChange,
  projects,
  initialProjectId,
  locations,
  onRegister,
}: {
  open: boolean
  busy: boolean
  /** The project the sample is being registered for, when a page named one. */
  initialProjectId?: string
  locations: readonly string[]
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
  const [projectId, setProjectId] = useState(initialProjectId ?? '')
  // The project can arrive after the dialog opens (an experiment's project is
  // read from the experiment); never overwrite a choice the person made.
  useEffect(() => {
    if (initialProjectId) setProjectId((current) => current || initialProjectId)
  }, [initialProjectId])
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
            <LocationInput
              value={storageLocation}
              onChange={setStorageLocation}
              locations={locations}
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
