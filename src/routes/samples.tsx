import { useEffect, useMemo, useState } from 'react'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { Select } from '#/components/v3/ui/select'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
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
import { PlaceField } from '#/components/v3/samples/place-field'
import { PrintLabelsDialog } from '#/components/v3/samples/sample-label-sheet'
import {
  SAMPLE_LIST_PAGE_SIZE,
  sampleListQueryKeys,
  toSampleListRow,
  useProjectNames,
  useSampleList,
  useSampleTabCounts,
  useStorageLocations,
} from '#/components/v3/samples/samples-data'
import type { SampleListRow } from '#/components/v3/samples/samples-data'
import { parseCreateContext } from '#/lib/create-context-search'
import { linkExperimentToSample } from '#/lib/notebook-create'
import { createSample, fetchSample } from '#/lib/samples'
import { moveSampleToPosition } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'
import { canManageSettings } from '#/lib/settings-access'
import {
  AddedFieldsFormSection,
  addedFieldColumns,
  useAddedFieldDraft,
} from '#/components/v3/models/added-fields'
import { useBuiltInModelFields } from '#/components/v3/models/built-in-model-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { t } from '#/copy'

const SAMPLE_MODEL = requireBuiltInModel('sample')

const tabs = ['instock', 'mine', 'awaiting', 'quarantine', 'consumed'] as const
type SampleTab = (typeof tabs)[number]
const tabLabel: Record<SampleTab, string> = {
  instock: t('library.samples.list.inStock'),
  mine: t('library.samples.list.mine'),
  awaiting: t('library.samples.list.reserved'),
  quarantine: t('library.samples.list.quarantine'),
  consumed: t('library.samples.list.consumed'),
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
  const projects = useProjectNames()
  const queryClient = useQueryClient()
  const tab: SampleTab = search.tab ?? 'instock'
  const [selected, setSelected] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [limit, setLimit] = useState(SAMPLE_LIST_PAGE_SIZE)
  const q = (search.q ?? '').trim()
  // The database applies the open tab and the search, so the list and the tab
  // numbers cover every sample, not just the ones loaded.
  const page = useSampleList(tab, context.user.id, q || undefined, limit)
  const tabCounts = useSampleTabCounts(context.user.id, q || undefined)
  const counts = tabCounts.data

  // The list is already newest first from the database.
  const rows = useMemo(
    () =>
      (page.data ?? []).map((r) =>
        toSampleListRow(r, projects.data ?? new Map(), context.user.id),
      ),
    [page.data, projects.data, context.user.id],
  )
  const visible = rows
  const hasProjectAccess = useHasProjectAccess()
  const recordsById = useMemo(
    () => new Map((page.data ?? []).map((r) => [r.id, r])),
    [page.data],
  )
  const addedFields = useBuiltInModelFields('sample')
  const printable = visible.flatMap((r) => recordsById.get(r.uuid) ?? [])
  const projectOptions = [...(projects.data ?? new Map()).entries()].map(
    ([id, title]) => ({ id, title }),
  )
  const locationsQuery = useStorageLocations()
  const locations = locationsQuery.data ?? []
  const sel = visible.find((r) => r.uuid === (selected ?? search.selected))

  // `?selected=<sample>` names a sample, not a tab: move to the tab that holds
  // it rather than selecting the first row of the wrong list. The sample may
  // sit past the loaded rows, so it is read by itself.
  const linkedQuery = useQuery({
    queryKey: ['ui-port', 'samples', 'linked', search.selected],
    queryFn: () => fetchSample(notebookDataClient, search.selected ?? ''),
    enabled: Boolean(search.selected),
    staleTime: 15_000,
  })
  const linked = linkedQuery.data
    ? toSampleListRow(
        linkedQuery.data,
        projects.data ?? new Map(),
        context.user.id,
      )
    : undefined
  const linkedTab =
    linked && !linked.tabs.includes(tab)
      ? tabs.find((item) => linked.tabs.includes(item))
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
        header: t('library.samples.list.id'),
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        id: 'name',
        header: t('library.samples.list.name'),
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
      {
        id: 'type',
        header: t('library.samples.list.type'),
        accessorFn: (s) => s.type,
      },
      {
        id: 'quantity',
        header: t('library.samples.list.quantity'),
        accessorFn: (s) => s.quantity,
        meta: rightAligned<SampleListRow>().meta,
      },
      {
        id: 'location',
        header: t('library.samples.list.location'),
        accessorFn: (s) => s.location,
      },
      ...addedFieldColumns<SampleListRow>(
        addedFields.data,
        (s) => recordsById.get(s.uuid)?.customFields,
      ),
      {
        id: 'status',
        header: t('library.samples.list.status'),
        cell: ({ row }) => (
          <Status tone={row.original.status.tone}>
            {row.original.status.label}
          </Status>
        ),
      },
    ],
    [sel?.uuid, openSample, addedFields.data, recordsById],
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
      place?: PlaceChoice | null
      customFields?: Record<string, unknown>
      typeKey?: string | null
      typeFields?: Record<string, unknown>
    }) => {
      let created = await createSample(notebookDataClient, {
        projectId: input.projectId,
        title: input.title,
        customFields: input.customFields,
        properties: {
          sampleType: input.sampleType,
          quantity: input.quantity ? Number(input.quantity) : undefined,
          quantityUnit: input.quantityUnit,
          storageLocation:
            input.place?.kind === 'text'
              ? input.place.text.trim() || undefined
              : undefined,
        },
      })
      if (input.place?.kind === 'position') {
        // A new tube goes straight into its position, so its first line of
        // history already says where it is.
        const placed = await moveSampleToPosition(notebookDataClient, {
          recordId: created.id,
          positionId: input.place.position.id,
          expectedMetadataVersion: created.metadataVersion,
        })
        created = { ...created, metadataVersion: placed.metadata_version }
      }
      if (input.typeKey) {
        // A subtype gives the sample its own ID, so the link below uses it.
        const typed = await saveNewObjectFields(
          notebookDataClient,
          SAMPLE_MODEL,
          created.id,
          input.typeKey,
          input.typeFields ?? {},
        )
        created = {
          ...created,
          identifier: typed.identifier ?? created.identifier,
        }
      }
      let linkError: string | null = null
      if (search.experiment) {
        try {
          await linkExperimentToSample(notebookDataClient, search.experiment, {
            identifier: created.identifier,
            recordId: created.id,
          })
        } catch (error) {
          linkError =
            error instanceof Error
              ? error.message
              : t('library.samples.list.theLinkWasRefused')
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
        linkError
          ? t('library.samples.list.sampleRegisteredNotLinked')
          : t('library.samples.list.sampleRegistered'),
        linkError
          ? {
              description: t('library.samples.list.itCouldNotBeLinked', {
                linkError,
              }),
            }
          : search.experiment
            ? {
                description: t('library.samples.list.isLinkedTo', {
                  identifier: created.identifier,
                  identifier2:
                    forExperiment.data?.identifier ??
                    t('library.samples.list.theExperiment'),
                }),
              }
            : undefined,
      )
      // Registered for an experiment: go back to its samples, where the new
      // sample now sits. Otherwise land on the new sample, not back on the
      // list it was registered from.
      if (search.experiment && !linkError) {
        void navigate({
          href:
            search.returnTo ??
            `/experiments/${encodeURIComponent(search.experiment)}/samples`,
        })
        return
      }
      void navigate({
        to: '/samples/$sampleId',
        params: { sampleId: created.id },
      })
    },
  })

  const registerFromList = () =>
    navigate({ to: '/samples', search: (s) => ({ ...s, bulk: true }) })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={t('library.samples.list.samples')}
          total={counts ? counts.instock + counts.consumed : undefined}
          actions={
            <>
              <Button
                icon="scan"
                nativeButton={false}
                render={<Link to="/scan" />}
              >
                {t('library.samples.list.scanLabel')}
              </Button>
              {/* A phone has room for two actions: the rest sit in More. */}
              <Button
                className="max-md:hidden"
                nativeButton={false}
                render={<Link to="/import" />}
              >
                {t('common.actions.import')}
              </Button>
              <Button
                className="max-md:hidden"
                disabled={visible.length === 0}
                onClick={() => setPrintOpen(true)}
              >
                {t('library.samples.list.printLabels')}
              </Button>
              <Button
                className="max-md:hidden"
                onClick={() => registerFromList()}
              >
                {t('library.samples.list.registerFromList')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon"
                      className="md:hidden"
                      icon="more"
                      aria-label={t('common.actions.more')}
                    />
                  }
                />
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLinkItem render={<Link to="/import" />}>
                    {t('common.actions.import')}
                  </DropdownMenuLinkItem>
                  <DropdownMenuItem
                    disabled={visible.length === 0}
                    onClick={() => setPrintOpen(true)}
                  >
                    {t('library.samples.list.printLabels')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => registerFromList()}>
                    {t('library.samples.list.registerFromList')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="primary"
                onClick={() =>
                  navigate({
                    to: '/samples',
                    search: (s) => ({ ...s, new: true }),
                  })
                }
              >
                {t('library.samples.list.registerSample')}
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.samples.list.sampleLists')}
              value={tab}
              items={tabs.map((item) => ({
                key: item,
                label: tabLabel[item],
                count: counts ? counts[item] : undefined,
                link: {
                  to: '/samples',
                  search: {
                    tab: item === 'instock' ? undefined : item,
                    q: search.q ?? '',
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label={t('library.samples.list.searchSamples')}
          placeholder={t('library.samples.list.searchByIdNameLocation')}
          views={{
            sorts: [
              t('library.samples.list.created'),
              'ID',
              t('library.samples.list.name'),
            ],
            fields: [
              'ID',
              t('library.samples.list.name'),
              t('library.samples.list.type'),
              t('library.samples.list.quantity'),
              t('library.samples.list.location'),
              t('library.samples.list.status'),
            ],
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
              label={t('library.samples.list.samples')}
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
            label={t('library.samples.list.samples')}
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
                      ? t('library.samples.list.noSamplesMatch', {
                          q: search.q ?? '',
                        })
                      : t('library.samples.list.noSamplesIn', {
                          toLowerCase: tabLabel[tab].toLowerCase(),
                        })
                }
                description={
                  hasProjectAccess === false
                    ? NO_PROJECT_ACCESS_BODY
                    : q
                      ? t('library.samples.list.searchLooksAtIdName')
                      : t('library.samples.list.registerASampleOrImport')
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
                    {q
                      ? t('library.samples.list.clearSearch')
                      : t('library.samples.list.backToInStock')}
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter
          loading={page.isPending}
          right={
            sel || (counts && visible.length < counts[tab]) ? (
              <>
                {sel ? t('library.samples.list.1Selected') : null}
                {counts && visible.length < counts[tab] ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={page.isFetching}
                    onClick={() =>
                      setLimit((current) => current + SAMPLE_LIST_PAGE_SIZE)
                    }
                  >
                    {t('library.samples.list.loadMore')}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        >
          {footerCount({
            shown: visible.length,
            total: counts?.[tab] ?? visible.length,
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
        canManageStorage={canManageSettings(context.workspace, 'storage')}
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
        scope={t('library.samples.list.theCountTablabelSamples', {
          count: printable.length,
          tabLabel: tabLabel[tab].toLowerCase(),
        })}
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
  canManageStorage,
  onRegister,
}: {
  open: boolean
  busy: boolean
  /** The project the sample is being registered for, when a page named one. */
  initialProjectId?: string
  locations: readonly string[]
  canManageStorage?: boolean
  projects: { id: string; title: string }[]
  onOpenChange: (open: boolean) => void
  onRegister: (input: {
    projectId: string
    title: string
    sampleType?: string
    quantity?: string
    quantityUnit?: string
    place?: PlaceChoice | null
    customFields?: Record<string, unknown>
    typeKey?: string | null
    typeFields?: Record<string, unknown>
  }) => void
}) {
  const addedFields = useAddedFieldDraft('sample')
  const [tried, setTried] = useState(false)
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
  const [place, setPlace] = useState<PlaceChoice | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('library.samples.list.registerSample')} />
        <DialogBody>
          <Field label={t('library.samples.list.project')} required>
            <PickerSelect
              noun="project"
              value={projectId}
              onChange={(id) => setProjectId(id)}
              options={projects.map((p) => projectOption(p))}
            />
          </Field>
          <Field label={t('library.samples.list.name')} required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('library.samples.list.type')}>
            <Input
              value={sampleType}
              onChange={(e) => setSampleType(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('library.samples.list.quantity')}>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label={t('library.samples.list.unit')}>
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
          <div className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t('library.samples.list.storageLocation')}
            </span>
            <PlaceField
              value={place}
              onChange={setPlace}
              title={t('library.samples.placeField.pickerTitleNew')}
              canManageStorage={canManageStorage}
              textLocations={locations}
            />
          </div>
          <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !projectId}
            onClick={() => {
              setTried(true)
              if (!addedFields.valid) return
              onRegister({
                projectId,
                title: title.trim(),
                sampleType: sampleType || undefined,
                quantity: quantity || undefined,
                quantityUnit,
                place,
                customFields: addedFields.rootPayload(),
                typeKey: addedFields.typeKey,
                typeFields: addedFields.payload(),
              })
            }}
          >
            {busy
              ? t('library.samples.list.registering')
              : t('library.samples.list.registerSample')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
