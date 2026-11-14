/**
 * The Registry page: every entry of every record model ticked as a registry,
 * with its number, a search, and a way in to register a new one. There are no
 * fixed registry types; a tab appears for each model that is a registry.
 */
import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { useListView } from '#/lib/list-views'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  STARTER_REGISTRIES,
  createStarterRegistry,
  fetchLineageLinks,
  fetchRegistryEntries,
  fetchRegistryModels,
  messageOf,
  registryKeys,
} from '#/lib/bio-registry'
import type { RegistryEntry, RegistryModel } from '#/lib/bio-registry'

import { COMPOUND_STARTER, createCompoundStarter } from '#/lib/compound-starter'
import { entryStatus, entrySummary, entryText } from './registry-shared'

const client = notebookDataClient

const STATUS_FILTERS = ['active', 'retired', 'all'] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]

/** Whether a `<select>` value is one of the status filters the list offers. */
function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_FILTERS.some((filter) => filter === value)
}

/** What a workspace with no registries yet sees: set up the starters it may have. */
function RegistryEmptyState({
  canEditModels,
  settingUp,
  settingUpCompounds,
  onSetUpAll,
  onSetUpOne,
  onSetUpCompounds,
}: {
  canEditModels: boolean
  settingUp: boolean
  settingUpCompounds: boolean
  onSetUpAll: () => void
  onSetUpOne: (key: string) => void
  onSetUpCompounds: () => void
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="tag"
        title={t('registry.empty.title')}
        description={
          canEditModels
            ? t('registry.empty.body')
            : t('registry.empty.notAllowed')
        }
        action={
          canEditModels ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="primary"
                disabled={settingUp}
                onClick={onSetUpAll}
              >
                {settingUp
                  ? t('registry.empty.settingUp')
                  : t('registry.empty.setUpAll')}
              </Button>
              <Button
                disabled={settingUp || settingUpCompounds}
                onClick={onSetUpCompounds}
              >
                {settingUpCompounds
                  ? t('registry.chemistry.starters.settingUp')
                  : t('registry.chemistry.starters.setUp')}
              </Button>
              {STARTER_REGISTRIES.map((starter) => (
                <Button
                  key={starter.key}
                  disabled={settingUp}
                  onClick={() => onSetUpOne(starter.key)}
                >
                  {t('registry.empty.setUp', { name: starter.name })}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
    </div>
  )
}

/** The one kind the ticked entries share, or none when they differ. */
function bulkKind(
  visible: RegistryEntry[],
  bulk: ReturnType<typeof useBulkSelection>,
): string | undefined {
  const kinds = new Set(
    visible.flatMap((entry) => (bulk.has(entry.id) ? [entry.kind] : [])),
  )

  return kinds.size === 1 ? [...kinds][0] : undefined
}

/** The table region: a load error, the starter set-up, the grid, or the empty list. */
function RegistryListTable({
  loadError,
  noRegistries,
  isEmpty,
  isPending,
  visible,
  columns,
  view,
  bulk,
  open,
  canEditModels,
  settingUp,
  settingUpCompounds,
  onSetUpAll,
  onSetUpOne,
  onSetUpCompounds,
  onRegister,
  canWrite,
}: {
  loadError: string | null
  noRegistries: boolean
  isEmpty: boolean
  isPending: boolean
  visible: RegistryEntry[]
  columns: RegistryColumn<RegistryEntry>[]
  view: ReturnType<typeof useListView>
  bulk: ReturnType<typeof useBulkSelection>
  open: (entry: RegistryEntry) => void
  canEditModels: boolean
  settingUp: boolean
  settingUpCompounds: boolean
  onSetUpAll: () => void
  onSetUpOne: (key: string) => void
  onSetUpCompounds: () => void
  onRegister: () => void
  canWrite: boolean
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {loadError !== null ? (
        <RegistryLoadError message={loadError} />
      ) : noRegistries ? (
        <RegistryEmptyState
          canEditModels={canEditModels}
          settingUp={settingUp}
          settingUpCompounds={settingUpCompounds}
          onSetUpAll={onSetUpAll}
          onSetUpOne={onSetUpOne}
          onSetUpCompounds={onSetUpCompounds}
        />
      ) : isPending || visible.length > 0 ? (
        <RegistryGrid
          label={t('registry.tableLabel')}
          view={view}
          rows={visible}
          columns={columns}
          getRowId={(entry) => entry.id}
          bulk={bulk}
          rowLabel={(entry) => entry.identifier}
          selectable
          onRowClick={open}
          isLoading={isPending}
        />
      ) : (
        <RegistryNoMatches
          isEmpty={isEmpty}
          canWrite={canWrite}
          onRegister={onRegister}
        />
      )}
    </div>
  )
}

/** What the list says when nothing matches the search or the status filter. */
function RegistryNoMatches({
  isEmpty,
  canWrite,
  onRegister,
}: {
  isEmpty: boolean
  canWrite: boolean
  onRegister: () => void
}) {
  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon="tag"
        title={
          isEmpty ? t('registry.empty.noEntries') : t('registry.empty.filtered')
        }
        description={isEmpty ? t('registry.empty.noEntriesBody') : undefined}
        action={
          isEmpty && canWrite ? (
            <Button variant="primary" onClick={onRegister}>
              {t('registry.register')}
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

/** What the list shows when its models or entries could not be read. */
function RegistryLoadError({ message }: { message: string }) {
  return (
    <div className="p-6">
      <Notice tone="bad" title={t('registry.loadError')}>
        {message}
      </Notice>
    </div>
  )
}

/** The header's register and compound-starter buttons, or nothing when neither applies. */
function RegistryHeaderActions({
  canWrite,
  canEditModels,
  hasRegistries,
  hasCompounds,
  settingUpCompounds,
  onRegister,
  onSetUpCompounds,
}: {
  canWrite: boolean
  canEditModels: boolean
  hasRegistries: boolean
  hasCompounds: boolean
  settingUpCompounds: boolean
  onRegister: () => void
  onSetUpCompounds: () => void
}) {
  if (!hasRegistries) return null

  return (
    <span className="flex flex-wrap items-center gap-2">
      {canEditModels && !hasCompounds ? (
        <Button disabled={settingUpCompounds} onClick={onSetUpCompounds}>
          {settingUpCompounds
            ? t('registry.chemistry.starters.settingUp')
            : t('registry.chemistry.starters.setUp')}
        </Button>
      ) : null}
      {canWrite ? (
        <Button variant="primary" onClick={onRegister}>
          {t('registry.register')}
        </Button>
      ) : null}
    </span>
  )
}

/** Opening a registry entry, and choosing which registry a new entry belongs to. */
function useRegistryNavigation(
  kind: string,
  registries: RegistryModel[],
  setChoosing: (choosing: boolean) => void,
) {
  const navigate = useNavigate()

  const open = (entry: RegistryEntry) =>
    void navigate({
      to: '/models/$modelId/records/$recordId',
      params: { modelId: entry.kind, recordId: entry.id },
    })

  function register() {
    const only =
      kind !== 'all' ? kind : registries.length === 1 ? registries[0].key : null

    if (only) {
      void navigate({
        to: '/models/$modelId/records/new',
        params: { modelId: only },
      })
    } else {
      setChoosing(true)
    }
  }

  return { open, register }
}

/** Creating the starter registries, as one ordered set-up the person triggers. */
function useRegistryStarters() {
  const queryClient = useQueryClient()

  const setUp = useMutation({
    mutationFn: async (starterKeys: string[]) => {
      const wanted = new Set(starterKeys)

      for (const starter of STARTER_REGISTRIES) {
        if (!wanted.has(starter.key)) continue

        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Starters are created in the declared order and a failure stops the rest, so the list never ends up half set up out of order.
        await createStarterRegistry(client, starter)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e) =>
      toast.error(messageOf(e, t('registry.empty.couldNotSetUp'))),
  })

  const setUpCompounds = useMutation({
    mutationFn: () => createCompoundStarter(client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e) =>
      toast.error(messageOf(e, t('registry.chemistry.starters.couldNotSetUp'))),
  })

  return { setUp, setUpCompounds }
}

/** The registry table columns: identity, type, status, lineage and provenance. */
function registryColumns(
  parentsOf: Map<string, string[]>,
  modelByKey: Map<string, RegistryModel>,
): RegistryColumn<RegistryEntry>[] {
  return [
    {
      id: 'number',
      header: t('registry.columns.number'),
      accessorFn: (e) => e.identifier,
      enableHiding: false,
      size: 110,
      cell: ({ row }) => (
        <span className="mono text-fg-muted">{row.original.identifier}</span>
      ),
    },
    {
      id: 'name',
      header: t('registry.columns.name'),
      accessorFn: (e) => e.title,
      size: 280,
      cell: ({ row }) => (
        <Link
          to="/models/$modelId/records/$recordId"
          params={{ modelId: row.original.kind, recordId: row.original.id }}
          className="truncate font-medium text-fg hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'kind',
      header: t('registry.columns.kind'),
      accessorFn: (e) => modelByKey.get(e.kind)?.name ?? e.kind,
      size: 130,
      cell: ({ row }) => (
        <span className="truncate">
          {modelByKey.get(row.original.kind)?.name ?? row.original.kind}
        </span>
      ),
    },
    {
      id: 'summary',
      header: t('registry.columns.summary'),
      accessorFn: (e) => entrySummary(e, modelByKey.get(e.kind)),
      cell: ({ row }) => (
        <span className="truncate text-fg-muted">
          {entrySummary(row.original, modelByKey.get(row.original.kind))}
        </span>
      ),
    },
    {
      id: 'madeFrom',
      header: t('registry.columns.madeFrom'),
      accessorFn: (e) => (parentsOf.get(e.id) ?? []).join(', '),
      size: 160,
      cell: ({ row }) => (
        <span className="mono truncate text-fg-muted">
          {(parentsOf.get(row.original.id) ?? []).join(', ')}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('registry.columns.status'),
      accessorFn: (e) => t(`registry.statuses.${entryStatus(e)}`),
      size: 110,
      cell: ({ row }) => {
        const s = entryStatus(row.original)

        return (
          <Status tone={s === 'active' ? 'ok' : 'none'}>
            {t(`registry.statuses.${s}`)}
          </Status>
        )
      },
    },
    {
      id: 'added',
      header: t('registry.columns.added'),
      accessorFn: (e) => e.created_at,
      size: 130,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ]
}

/** Whether the entry's searchable text carries the (lowercased) needle. */
function entryMatches(entry: RegistryEntry, needle: string): boolean {
  return needle === '' || entryText(entry).includes(needle)
}

export function RegistryList({
  canWrite,
  canEditModels,
}: {
  canWrite: boolean
  canEditModels: boolean
}) {
  const queryClient = useQueryClient()
  const bulk = useBulkSelection()
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [q, setQ] = useState('')
  const [choosing, setChoosing] = useState(false)

  const models = useQuery({
    queryKey: registryKeys.models,
    queryFn: () => fetchRegistryModels(client),
    staleTime: 10_000,
  })

  const registries = useMemo(() => models.data ?? [], [models.data])
  const keys = useMemo(() => registries.map((m) => m.key), [registries])

  const chemical = useMemo(
    () => registries.filter((m) => m.key === COMPOUND_STARTER.compound.key),
    [registries],
  )

  const modelByKey = useMemo(
    () => new Map(registries.map((m) => [m.key, m] as const)),
    [registries],
  )

  const entries = useQuery({
    queryKey: registryKeys.entries(keys),
    queryFn: () => fetchRegistryEntries(client, keys),
    enabled: models.isSuccess && keys.length > 0,
    staleTime: 10_000,
  })

  const all = useMemo(() => entries.data ?? [], [entries.data])
  const ids = useMemo(() => all.map((e) => e.id), [all])

  const links = useQuery({
    queryKey: [...registryKeys.lineage, ids.length],
    queryFn: () => fetchLineageLinks(client, ids),
    enabled: ids.length > 0,
    staleTime: 10_000,
  })

  const byId = useMemo(() => new Map(all.map((e) => [e.id, e] as const)), [all])

  const parentsOf = useMemo(() => {
    const map = new Map<string, string[]>()

    for (const link of links.data ?? []) {
      const parent = byId.get(link.parent_id)

      if (!parent) continue
      map.set(link.entry_id, [
        ...(map.get(link.entry_id) ?? []),
        parent.identifier,
      ])
    }

    return map
  }, [links.data, byId])

  const needle = q.trim().toLowerCase()

  const inStatus = all.filter(
    (e) => status === 'all' || entryStatus(e) === status,
  )

  const visible = inStatus.filter(
    (e) => (kind === 'all' || e.kind === kind) && entryMatches(e, needle),
  )

  const { setUp, setUpCompounds } = useRegistryStarters()

  const columns = useMemo(
    () => registryColumns(parentsOf, modelByKey),
    [parentsOf, modelByKey],
  )

  const view = useListView('registry')

  const { open, register } = useRegistryNavigation(
    kind,
    registries,
    setChoosing,
  )

  const noRegistries = models.isSuccess && registries.length === 0

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('registry.title')}
        subtitle={t('registry.subtitle')}
        total={entries.data ? inStatus.length : undefined}
        actions={
          <RegistryHeaderActions
            canWrite={canWrite}
            canEditModels={canEditModels}
            hasRegistries={registries.length > 0}
            hasCompounds={chemical.length > 0}
            settingUpCompounds={setUpCompounds.isPending}
            onRegister={register}
            onSetUpCompounds={() => setUpCompounds.mutate()}
          />
        }
        tabs={
          registries.length > 0 ? (
            <Tabs
              mode="state"
              variant="strip"
              label={t('registry.filterLabel')}
              value={kind}
              onValueChange={setKind}
              items={[
                {
                  key: 'all',
                  label: t('registry.all'),
                  count: entries.isPending ? undefined : inStatus.length,
                },
                ...registries.map((m) => ({
                  key: m.key,
                  label: m.name,
                  count: entries.isPending
                    ? undefined
                    : inStatus.filter((e) => e.kind === m.key).length,
                })),
              ]}
            />
          ) : undefined
        }
      />
      <>
        {noRegistries ? null : (
          <ListToolbar
            q={q}
            onSearch={setQ}
            placeholder={t('registry.searchPlaceholder')}
            label={t('registry.searchPlaceholder')}
            right={
              <Select
                size="sm"
                aria-label={t('registry.statusLabel')}
                value={status}
                onChange={(event) => {
                  if (isStatusFilter(event.target.value))
                    setStatus(event.target.value)
                }}
              >
                {STATUS_FILTERS.map((key) => (
                  <option key={key} value={key}>
                    {t(`registry.statusFilters.${key}`)}
                  </option>
                ))}
              </Select>
            }
          />
        )}
        <RecordBulkBar
          selection={bulk}
          // Setting a field needs one model: the ticked entries' kind, when
          // they all share one.
          kind={bulkKind(visible, bulk)}
          canWrite={canWrite}
          onChanged={() =>
            void queryClient.invalidateQueries({ queryKey: registryKeys.all })
          }
        />
        <RegistryListTable
          loadError={
            models.isError || entries.isError
              ? messageOf(models.error ?? entries.error, '')
              : null
          }
          noRegistries={noRegistries}
          isEmpty={all.length === 0}
          isPending={models.isPending || entries.isPending}
          visible={visible}
          columns={columns}
          view={view}
          bulk={bulk}
          open={open}
          canEditModels={canEditModels}
          settingUp={setUp.isPending}
          settingUpCompounds={setUpCompounds.isPending}
          onSetUpAll={() => setUp.mutate(STARTER_REGISTRIES.map((s) => s.key))}
          onSetUpOne={(key) => setUp.mutate([key])}
          onSetUpCompounds={() => setUpCompounds.mutate()}
          onRegister={register}
          canWrite={canWrite}
        />
        {!canWrite && !models.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('registry.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </>
      <ChooseRegistry
        open={choosing}
        onOpenChange={setChoosing}
        registries={registries}
      />
    </div>
  )
}

function ChooseRegistry({
  open,
  onOpenChange,
  registries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  registries: RegistryModel[]
}) {
  const navigate = useNavigate()
  const [choice, setChoice] = useState('')
  const selected = choice || registries[0]?.key || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={t('registry.registerChoose')} />
        <DialogBody>
          <Field label={t('registry.registerChooseLabel')}>
            <SearchableSelect
              noun="registry"
              value={selected}
              onValueChange={(value) => setChoice(value)}
            >
              {registries.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </SearchableSelect>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('registry.settings.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => {
              onOpenChange(false)
              void navigate({
                to: '/models/$modelId/records/new',
                params: { modelId: selected },
              })
            }}
          >
            {t('registry.register')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
