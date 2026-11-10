import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

import { ObjectLink } from '#/components/ui/object-link'
import {
  FillFromText,
  addedFillFields,
} from '#/components/assist/fill-from-text'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { projectOption } from '#/components/record-picker/entity-options'
import { Select } from '#/components/ui/select'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
  useHasProjectAccess,
} from '#/components/projects/project-access'
import { Status } from '#/components/ui/status'
import { LocationPath, shortLocation } from '#/components/ui/location-path'
import { EmptyState } from '#/components/ui/empty-state'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { samplePath } from '#/lib/navigation'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Field, Input } from '#/components/ui/input'
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
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/inventory/list'
import { Tabs } from '#/components/ui/tabs'
import { BulkRegisterDialog } from '#/components/samples/bulk-register-dialog'
import { SampleInspector } from '#/components/samples/sample-inspector'
import { PlaceField } from '#/components/samples/place-field'
import { PrintLabelsDialog } from '#/components/samples/sample-label-sheet'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import {
  SAMPLE_LIST_PAGE_SIZE,
  sampleListQueryKeys,
  toSampleListRow,
  useProjectNames,
  useSampleList,
  useSampleTabCounts,
  useStorageLocations,
} from '#/components/samples/samples-data'
import type { SampleListRow } from '#/components/samples/samples-data'
import { parseCreateContext } from '#/lib/create-context-search'
import { linkExperimentToSample } from '#/lib/notebook-create'
import { hasCapability } from '#/lib/capability'
import { createSample, fetchSample } from '#/lib/samples'
import { moveSampleToPosition } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'
import { canManageSettings } from '#/lib/settings-access'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
} from '#/components/models/added-fields'
import { addedFieldColumns } from '#/components/models/added-field-columns'
import { useBuiltInModelFields } from '#/components/models/built-in-model-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { requireBuiltInModel } from '#/lib/built-in-models'
import type { ModelFieldRecordValues } from '#/lib/model-fields'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { useListView } from '#/lib/list-views'
import { t } from '#/copy'

const SAMPLE_MODEL = requireBuiltInModel('sample')

const tabs = [
  'instock',
  'mine',
  'awaiting',
  'quarantine',
  'consumed',
  'archived',
] as const

type SampleTab = (typeof tabs)[number]

const tabLabel: Record<SampleTab, string> = {
  instock: t('library.samples.list.inStock'),
  mine: t('library.samples.list.mine'),
  awaiting: t('library.samples.list.reserved'),
  quarantine: t('library.samples.list.quarantine'),
  consumed: t('library.samples.list.consumed'),
  archived: t('library.samples.list.archived'),
}

/** What the samples list reads from the URL. */
interface SamplesSearch {
  q?: string
  tab?: SampleTab
  new?: boolean
  bulk?: boolean
  selected?: string
  project?: string
  experiment?: string
  returnTo?: string
}

/** A URL value as it arrives: any text, or nothing. */
const textParam = z.string().optional().catch(undefined)

/** A URL value that names something: non-empty text, or nothing. */
const namedParam = z.string().min(1).optional().catch(undefined)

function pickSampleContext(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values; parseCreateContext decodes every one it reads.
  search: Record<string, unknown>,
) {
  const { project, experiment, returnTo } = parseCreateContext(search)

  return { project, experiment, returnTo }
}

/** UI port (roadmap-4/ui-app3): the sample registry list, wired to real sample
 * records. The detail route and the custody dialogs follow. */
export const Route = createFileRoute('/samples')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; every value is decoded by the schemas below or by parseCreateContext before use.
  validateSearch: (search: Record<string, unknown>): SamplesSearch => ({
    // The shared create-context params: the project or experiment the sample
    // is registered for, and where closing the dialog goes back to.
    ...pickSampleContext(search),
    q: textParam.parse(search.q),
    // The project in view travels in, so a registration starts on it.
    project: namedParam.parse(search.project),
    selected: textParam.parse(search.selected),
    tab:
      search.tab === 'mine' ||
      search.tab === 'awaiting' ||
      search.tab === 'quarantine' ||
      search.tab === 'consumed' ||
      search.tab === 'archived' ||
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

/** What the register dialog hands over: the fields the person filled in. */
interface RegisterSampleInput {
  projectId: string
  title: string
  sampleType?: string
  quantity?: string
  quantityUnit?: string
  place?: PlaceChoice | null
  customFields?: ModelFieldRecordValues['customFields']
  typeKey?: string | null
  typeFields?: ModelFieldRecordValues['customFields']
}

/**
 * Register one sample, then put it where the person asked and link it to the
 * experiment it was registered for. A refused link is reported back rather
 * than thrown: the sample itself was created and must not be lost.
 */
async function registerSample(
  input: RegisterSampleInput,
  experimentId: string | undefined,
) {
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

  if (experimentId) {
    try {
      await linkExperimentToSample(notebookDataClient, experimentId, {
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
}

/** The sample list's columns: identity, quantity, status and the workspace's own fields. */
function sampleColumns({
  selectedUuid,
  openSample,
  addedFields,
  recordsById,
}: {
  selectedUuid: string | undefined
  openSample: (row: SampleListRow, event: React.MouseEvent) => void
  addedFields: Parameters<typeof addedFieldColumns<SampleListRow>>[0]
  recordsById: Map<string, SampleRecordValue>
}): RegistryColumn<SampleListRow>[] {
  return [
    {
      id: 'identifier',
      header: t('library.samples.list.id'),
      accessorFn: (s) => s.id,
      enableHiding: false,
      cell: ({ row }) => (
        <ObjectLink kind="sample" identifier={row.original.id} />
      ),
    },
    {
      id: 'name',
      header: t('library.samples.list.name'),
      accessorFn: (s) => s.name,
      cell: ({ row }) => (
        <Link
          to="/samples/$sampleId"
          params={{ sampleId: row.original.uuid }}
          onClick={(event) => openSample(row.original, event)}
          className={
            row.original.uuid === selectedUuid ? 'font-medium' : undefined
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
      // "15 mL" and "12.5 mg" have no common order.
      enableSorting: false,
      meta: rightAligned<SampleListRow>().meta,
    },
    {
      id: 'location',
      header: t('library.samples.list.location'),
      accessorFn: (s) => s.location,
      cell: ({ row }) => <LocationPath path={row.original.location} />,
    },
    ...addedFieldColumns<SampleListRow>(
      addedFields,
      (s) => recordsById.get(s.uuid)?.customFields,
    ),
    {
      id: 'status',
      header: t('library.samples.list.status'),
      accessorFn: (s) => s.status.label,
      cell: ({ row }) => (
        <Status tone={row.original.status.tone}>
          {row.original.status.label}
        </Status>
      ),
    },
  ]
}

/** The list's empty state: why nothing is listed, and the way back to In stock. */
function SamplesEmpty({
  query,
  searchQuery,
  tab,
  tabName,
  hasProjectAccess,
}: {
  query: string
  searchQuery: string
  tab: SampleTab
  tabName: string
  hasProjectAccess: boolean | undefined
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon={query ? 'search' : 'tube'}
        title={
          hasProjectAccess === false
            ? noProjectAccessTitle('samples')
            : query
              ? t('library.samples.list.noSamplesMatch', { q: searchQuery })
              : tab === 'archived'
                ? t('library.samples.list.noArchivedSamples')
                : t('library.samples.list.noSamplesIn', {
                    toLowerCase: tabName.toLowerCase(),
                  })
        }
        description={
          hasProjectAccess === false
            ? NO_PROJECT_ACCESS_BODY
            : query
              ? t('library.samples.list.searchLooksAtIdName')
              : tab === 'archived'
                ? t('library.samples.list.archivedStayHere')
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
            {query
              ? t('library.samples.list.clearSearch')
              : t('library.samples.list.backToInStock')}
          </Button>
        }
      />
    </div>
  )
}

/** The list's header actions: scan, import, print, register and the phone's More menu. */
function SamplesListActions({
  canWrite,
  hasRows,
  onPrint,
  onRegisterFromList,
  onRegisterSample,
}: {
  canWrite: boolean
  hasRows: boolean
  onPrint: () => void
  onRegisterFromList: () => void
  onRegisterSample: () => void
}) {
  return (
    <>
      <IconButton
        variant="secondary"
        icon="scan"
        label={t('library.samples.list.scanLabel')}
        nativeButton={false}
        render={<Link to="/scan" />}
      />
      {/* A phone has room for two actions: the rest sit in More. */}
      {canWrite ? (
        <Button
          className="max-md:hidden"
          nativeButton={false}
          render={<Link to="/import" />}
        >
          {t('common.actions.import')}
        </Button>
      ) : null}
      <Button className="max-md:hidden" disabled={!hasRows} onClick={onPrint}>
        {t('library.samples.list.printLabels')}
      </Button>
      {canWrite ? (
        <Button className="max-md:hidden" onClick={onRegisterFromList}>
          {t('library.samples.list.registerFromList')}
        </Button>
      ) : null}
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
          {canWrite ? (
            <DropdownMenuLinkItem render={<Link to="/import" />}>
              {t('common.actions.import')}
            </DropdownMenuLinkItem>
          ) : null}
          <DropdownMenuItem disabled={!hasRows} onClick={onPrint}>
            {t('library.samples.list.printLabels')}
          </DropdownMenuItem>
          {canWrite ? (
            <DropdownMenuItem onClick={onRegisterFromList}>
              {t('library.samples.list.registerFromList')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canWrite ? (
        <Button variant="primary" onClick={onRegisterSample}>
          {t('library.samples.list.registerSample')}
        </Button>
      ) : null}
    </>
  )
}

/** What a finished registration tells the person, and where it leaves them. */
function reportRegisteredSample(
  {
    created,
    linkError,
  }: { created: SampleRecordValue; linkError: string | null },
  {
    queryClient,
    navigate,
    experimentId,
    experimentLabel,
    returnTo,
  }: {
    queryClient: QueryClient
    navigate: SamplesNavigate
    experimentId: string | undefined
    experimentLabel: string | undefined
    returnTo: string | undefined
  },
) {
  void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })

  if (experimentId) {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'experiment-links', experimentId],
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
      : experimentId
        ? {
            description: t('library.samples.list.isLinkedTo', {
              identifier: created.identifier,
              identifier2:
                experimentLabel ?? t('library.samples.list.theExperiment'),
            }),
          }
        : undefined,
  )

  // Registered for an experiment: go back to its samples, where the new
  // sample now sits. Otherwise land on the new sample, not back on the
  // list it was registered from.
  if (experimentId && !linkError) {
    // react-doctor-disable-next-line react-doctor/tanstack-start-no-navigate-in-render -- This runs from the create mutation's own callback, never while the page renders.
    void navigate({
      href:
        returnTo ?? `/experiments/${encodeURIComponent(experimentId)}/samples`,
    })

    return
  }

  // react-doctor-disable-next-line react-doctor/tanstack-start-no-navigate-in-render -- This runs from the create mutation's own callback, never while the page renders.
  void navigate({
    to: '/samples/$sampleId',
    params: { sampleId: created.id },
  })
}

/** Follow `?selected=<sample>`: switch to the tab that holds it, even when it sits past the loaded rows. */
function useLinkedSampleTab({
  selectedId,
  tab,
  projects,
  userId,
  navigate,
}: {
  selectedId: string | undefined
  tab: SampleTab
  projects: ProjectNames | undefined
  userId: string
  navigate: SamplesNavigate
}) {
  // `?selected=<sample>` names a sample, not a tab: move to the tab that holds
  // it rather than selecting the first row of the wrong list. The sample may
  // sit past the loaded rows, so it is read by itself.
  const linkedQuery = useQuery({
    queryKey: ['ui-port', 'samples', 'linked', selectedId],
    queryFn: () => fetchSample(notebookDataClient, selectedId ?? ''),
    enabled: Boolean(selectedId),
    staleTime: 15_000,
  })

  const linked = linkedQuery.data
    ? toSampleListRow(linkedQuery.data, projects ?? new Map(), userId)
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
}

/**
 * The list header's counts, its phone-friendly actions, and the tabs the whole
 * list is filtered by. `counts` is undefined until the tab totals answer.
 */
function SamplesListHeader({
  counts,
  tab,
  searchQuery,
  canWrite,
  hasRows,
  onPrint,
  onRegisterFromList,
  onRegisterSample,
}: {
  counts: ReturnType<typeof useSampleTabCounts>['data']
  tab: SampleTab
  searchQuery: string
  canWrite: boolean
  hasRows: boolean
  onPrint: () => void
  onRegisterFromList: () => void
  onRegisterSample: () => void
}) {
  return (
    <ListHeader
      title={t('library.samples.list.samples')}
      total={counts ? counts.instock + counts.consumed : undefined}
      actions={
        <SamplesListActions
          canWrite={canWrite}
          hasRows={hasRows}
          onPrint={onPrint}
          onRegisterFromList={onRegisterFromList}
          onRegisterSample={onRegisterSample}
        />
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
                q: searchQuery,
              },
            },
          }))}
        />
      }
    />
  )
}

/** The list footer: the tab's totals, the selected count and the way to load more. */
function SamplesListFooter({
  hasSelection,
  counts,
  tab,
  tabName,
  visibleCount,
  loading,
  loadingMore,
  onLoadMore,
}: {
  hasSelection: boolean
  counts: ReturnType<typeof useSampleTabCounts>['data']
  tab: SampleTab
  tabName: string
  visibleCount: number
  loading: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  const canLoadMore = Boolean(counts && visibleCount < counts[tab])

  return (
    <ListFooter
      loading={loading}
      right={
        hasSelection || canLoadMore ? (
          <>
            {hasSelection ? t('library.samples.list.1Selected') : null}
            {canLoadMore ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {t('library.samples.list.loadMore')}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {footerCount({
        shown: visibleCount,
        total: counts?.[tab] ?? visibleCount,
        one: 'sample',
        tab: tabName,
      })}
    </ListFooter>
  )
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
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const tab: SampleTab = search.tab ?? 'instock'
  const [selected, setSelected] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const bulk = useBulkSelection()
  const [limit, setLimit] = useState(SAMPLE_LIST_PAGE_SIZE)
  const q = (search.q ?? '').trim()
  // The database applies the open tab and the search, so the list and the tab
  // numbers cover every sample, not just the ones loaded.
  const view = useListView('samples')

  const page = useSampleList(
    tab,
    context.user.id,
    q || undefined,
    limit,
    undefined,
    view.sorting,
  )

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

  useLinkedSampleTab({
    selectedId: search.selected,
    tab,
    projects: projects.data,
    userId: context.user.id,
    navigate,
  })

  const columns = useMemo<RegistryColumn<SampleListRow>[]>(
    () =>
      sampleColumns({
        selectedUuid: sel?.uuid,
        openSample,
        addedFields: addedFields.data,
        recordsById,
      }),
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
    mutationFn: (input: RegisterSampleInput) =>
      registerSample(input, search.experiment),
    onSuccess: (result) =>
      reportRegisteredSample(result, {
        queryClient,
        navigate,
        experimentId: search.experiment,
        experimentLabel: forExperiment.data?.identifier,
        returnTo: search.returnTo,
      }),
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <SamplesListHeader
          counts={counts}
          tab={tab}
          searchQuery={q}
          canWrite={canWrite}
          hasRows={visible.length > 0}
          onPrint={() => setPrintOpen(true)}
          onRegisterFromList={() =>
            navigate({ to: '/samples', search: (s) => ({ ...s, bulk: true }) })
          }
          onRegisterSample={() =>
            navigate({
              to: '/samples',
              search: (s) => ({ ...s, new: true }),
            })
          }
        />
        <SamplesListBody
          page={page}
          visible={visible}
          view={view}
          columns={columns}
          bulk={bulk}
          rowSelection={rowSelection}
          onRowSelectionChange={onRowSelectionChange}
          openSample={openSample}
          selectedUuid={sel?.uuid}
          query={q}
          searchQuery={search.q ?? ''}
          tab={tab}
          tabName={tabLabel[tab]}
          hasProjectAccess={hasProjectAccess}
          onSearch={(next) =>
            void navigate({
              to: '/samples',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
          onChanged={() =>
            void queryClient.invalidateQueries({
              queryKey: sampleListQueryKeys.page,
            })
          }
          canWrite={canWrite}
        />
        <SamplesListFooter
          hasSelection={Boolean(sel)}
          counts={counts}
          tab={tab}
          tabName={tabLabel[tab]}
          visibleCount={visible.length}
          loading={page.isPending}
          loadingMore={page.isFetching}
          onLoadMore={() =>
            setLimit((current) => current + SAMPLE_LIST_PAGE_SIZE)
          }
        />
      </div>

      <SamplesOverlays
        selectedSample={sel ? recordsById.get(sel.uuid) : undefined}
        search={search}
        navigate={navigate}
        projects={projects.data}
        projectOptions={projectOptions}
        defaultProjectId={defaultProjectId}
        locations={locations}
        workspace={context.workspace}
        busy={create.isPending}
        onRegister={create.mutate}
        printOpen={printOpen}
        onPrintOpenChange={setPrintOpen}
        printable={printable}
        tabName={tabLabel[tab]}
        queryClient={queryClient}
      />
    </div>
  )
}

/** The list itself: the search box, the bulk bar, the grid and its phone rows. */
function SamplesListBody({
  page,
  visible,
  view,
  columns,
  bulk,
  rowSelection,
  onRowSelectionChange,
  openSample,
  selectedUuid,
  query,
  searchQuery,
  tab,
  tabName,
  hasProjectAccess,
  onSearch,
  onChanged,
  canWrite,
}: {
  page: ReturnType<typeof useSampleList>
  visible: SampleListRow[]
  view: ReturnType<typeof useListView>
  columns: RegistryColumn<SampleListRow>[]
  bulk: ReturnType<typeof useBulkSelection>
  rowSelection: ReturnType<typeof useRowFocus>['rowSelection']
  onRowSelectionChange: ReturnType<typeof useRowFocus>['onRowSelectionChange']
  openSample: ReturnType<typeof useOpenRow<SampleListRow>>
  selectedUuid: string | undefined
  query: string
  searchQuery: string
  tab: SampleTab
  tabName: string
  hasProjectAccess: boolean | undefined
  onSearch: (next: string) => void
  onChanged: () => void
  canWrite: boolean
}) {
  return (
    <>
      <ListToolbar
        q={searchQuery}
        label={t('library.samples.list.searchSamples')}
        placeholder={t('library.samples.list.searchByIdNameLocation')}
        onSearch={onSearch}
      />
      <RecordBulkBar
        selection={bulk}
        kind="sample"
        move="location"
        restore={tab === 'archived'}
        canWrite={canWrite}
        onChanged={onChanged}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {page.isPending || visible.length > 0 ? (
          <RegistryGrid
            className="max-md:hidden"
            bulk={bulk}
            rowLabel={(s) => s.id}
            label={t('library.samples.list.samples')}
            view={view}
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
            // A phone row has room for the box and position, not the rack.
            sub: `${s.quantity} · ${shortLocation(s.location, 2)}`,
            status: <Status tone={s.status.tone}>{s.status.label}</Status>,
            link: {
              to: '/samples/$sampleId',
              params: { sampleId: s.uuid },
              onClick: (event: React.MouseEvent) => openSample(s, event),
            },
            selected: s.uuid === selectedUuid,
          }))}
        />
        {!page.isPending && visible.length === 0 ? (
          <SamplesEmpty
            query={query}
            searchQuery={searchQuery}
            tab={tab}
            tabName={tabName}
            hasProjectAccess={hasProjectAccess}
          />
        ) : null}
      </div>
    </>
  )
}

/** The route's own search, as the overlays read it. */
type SamplesSearchValue = ReturnType<typeof Route.useSearch>

/** Where the overlays send the page. */
type SamplesNavigate = ReturnType<typeof Route.useNavigate>

/** The registered sample the inspector shows. */
type SampleRecordValue = Parameters<typeof SampleInspector>[0]['sample']

/** The project names the register dialog offers. */
type ProjectNames = NonNullable<ReturnType<typeof useProjectNames>['data']>

/** The workspace the samples belong to. */
type CurrentWorkspace = ReturnType<
  typeof Route.useRouteContext
>['context']['workspace']

/** What registering a sample hands over. */
type RegisterSampleInputHandler = (input: RegisterSampleInput) => void

/** The pane's overlays: the selected sample's inspector and the three dialogs the search opens. */
function SamplesOverlays({
  selectedSample,
  search,
  navigate,
  projects,
  projectOptions,
  defaultProjectId,
  locations,
  workspace,
  busy,
  onRegister,
  printOpen,
  onPrintOpenChange,
  printable,
  tabName,
  queryClient,
}: {
  selectedSample: SampleRecordValue | undefined
  search: SamplesSearchValue
  navigate: SamplesNavigate
  projects: ProjectNames | undefined
  projectOptions: { id: string; title: string }[]
  defaultProjectId: string | undefined
  locations: readonly string[]
  workspace: CurrentWorkspace
  busy: boolean
  onRegister: RegisterSampleInputHandler
  printOpen: boolean
  onPrintOpenChange: (open: boolean) => void
  printable: SampleRecordValue[]
  tabName: string
  queryClient: QueryClient
}) {
  return (
    <>
      {selectedSample ? <SampleInspector sample={selectedSample} /> : null}

      <RegisterSampleDialog
        open={Boolean(search.new)}
        busy={busy}
        projects={[...(projects ?? new Map()).entries()].map(([id, title]) => ({
          id,
          title,
        }))}
        initialProjectId={defaultProjectId}
        locations={locations}
        canManageStorage={canManageSettings(workspace, 'storage')}
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
        onRegister={onRegister}
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
        onOpenChange={onPrintOpenChange}
        records={printable}
        scope={t('library.samples.list.theCountTablabelSamples', {
          count: printable.length,
          tabLabel: tabName.toLowerCase(),
        })}
        onPrinted={() =>
          void queryClient.invalidateQueries({
            queryKey: sampleListQueryKeys.page,
          })
        }
      />
    </>
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
    customFields?: ModelFieldRecordValues['customFields']
    typeKey?: string | null
    typeFields?: ModelFieldRecordValues['customFields']
  }) => void
}) {
  const addedFields = useAddedFieldDraft('sample')
  const [tried, setTried] = useState(false)
  const [projectId, setProjectId] = useState(initialProjectId ?? '')
  // The project can arrive after the dialog opens (an experiment's project is
  // read from the experiment); never overwrite a choice the person made. The
  // adjustment is made while rendering, so the dialog never paints the old
  // project first.
  const [lastProjectId, setLastProjectId] = useState(initialProjectId)

  if (initialProjectId !== lastProjectId) {
    setLastProjectId(initialProjectId)

    if (initialProjectId) setProjectId((current) => current || initialProjectId)

    // A state adjustment made while rendering: React re-renders this dialog
    // before it paints, so no effect and no stale project.
  }

  const [title, setTitle] = useState('')
  const [sampleType, setSampleType] = useState('')
  const [quantity, setQuantity] = useState('')
  const [quantityUnit, setQuantityUnit] = useState('mL')
  const [place, setPlace] = useState<PlaceChoice | null>(null)

  const fillFields = [
    { key: 'name', label: t('library.samples.list.name') },
    { key: 'type', label: t('library.samples.list.type') },
    {
      key: 'quantity',
      label: t('library.samples.list.quantity'),
      hint: t('library.fill.hintNumber'),
    },
    {
      key: 'unit',
      label: t('library.samples.list.unit'),
      hint: t('library.fill.hintSampleUnit'),
    },
    ...addedFillFields(addedFields.fields),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('library.samples.list.registerSample')} />
        <DialogBody>
          <FillFromText
            fields={fillFields}
            onFill={(values) => {
              if (values.name) setTitle(values.name)

              if (values.type) setSampleType(values.type)

              if (values.quantity && Number.isFinite(Number(values.quantity)))
                setQuantity(values.quantity)

              if (
                values.unit &&
                ['mL', 'µL', 'mg', 'µg', 'vial'].includes(values.unit)
              )
                setQuantityUnit(values.unit)

              for (const [key, value] of Object.entries(values)) {
                if (key.startsWith('field:'))
                  addedFields.setValue(key.slice(6), value)
              }
            }}
          />
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
