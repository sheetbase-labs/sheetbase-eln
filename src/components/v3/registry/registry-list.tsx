/**
 * The Registry page: every construct, cell line and antibody with its number,
 * a search, and the dialog that registers a new one.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/v3/inventory/list'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { Tabs } from '#/components/v3/ui/tabs'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  REGISTRY_KINDS,
  fetchEntries,
  fetchParents,
  messageOf,
  registryKeys,
} from '#/lib/bio-registry'
import type { RegistryEntry, RegistryKind } from '#/lib/bio-registry'

import { RegistryFormDialog } from './registry-form'
import {
  STATUS_TONE,
  entryText,
  kindLabel,
  statusLabel,
  summaryOf,
} from './registry-shared'

const client = notebookDataClient

type KindFilter = 'all' | RegistryKind
type StatusFilter = 'active' | 'retired' | 'all'
const KIND_FILTERS: KindFilter[] = ['all', ...REGISTRY_KINDS]

export function RegistryList({ canWrite }: { canWrite: boolean }) {
  const navigate = useNavigate()
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [q, setQ] = useState('')
  const [registering, setRegistering] = useState(false)

  const entries = useQuery({
    queryKey: registryKeys.list,
    queryFn: () => fetchEntries(client),
    staleTime: 10_000,
  })
  const links = useQuery({
    queryKey: [...registryKeys.list, 'parents'],
    queryFn: () => fetchParents(client),
    staleTime: 10_000,
  })

  const all = entries.data ?? []
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e] as const)), [all])
  const parentsOf = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of links.data ?? []) {
      const parent = byId.get(link.parent_id)
      if (!parent) continue
      map.set(link.entry_id, [
        ...(map.get(link.entry_id) ?? []),
        parent.registryId,
      ])
    }
    return map
  }, [links.data, byId])

  const needle = q.trim().toLowerCase()
  const inStatus = all.filter((e) => status === 'all' || e.status === status)
  const visible = inStatus.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (needle === '' || entryText(e).includes(needle)),
  )

  const columns = useMemo<RegistryColumn<RegistryEntry>[]>(
    () => [
      {
        id: 'number',
        header: t('registry.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">{row.original.registryId}</span>
        ),
      },
      {
        id: 'name',
        header: t('registry.columns.name'),
        size: 280,
        cell: ({ row }) => (
          <Link
            to="/registry/$entryId"
            params={{ entryId: row.original.id }}
            className="truncate font-medium text-fg hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'kind',
        header: t('registry.columns.kind'),
        size: 120,
        cell: ({ row }) => (
          <span className="truncate">{kindLabel(row.original.kind)}</span>
        ),
      },
      {
        id: 'summary',
        header: t('registry.columns.summary'),
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {summaryOf(row.original)}
          </span>
        ),
      },
      {
        id: 'madeFrom',
        header: t('registry.columns.madeFrom'),
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
        size: 110,
        cell: ({ row }) => (
          <Status tone={STATUS_TONE[row.original.status]}>
            {statusLabel(row.original.status)}
          </Status>
        ),
      },
      {
        id: 'added',
        header: t('registry.columns.added'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [parentsOf],
  )

  const open = (entry: RegistryEntry) =>
    void navigate({
      to: '/registry/$entryId',
      params: { entryId: entry.id },
    })

  const registerButton = canWrite ? (
    <Button variant="primary" onClick={() => setRegistering(true)}>
      {t('registry.register')}
    </Button>
  ) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('registry.title')}
        subtitle={t('registry.subtitle')}
        total={entries.data ? inStatus.length : undefined}
        actions={registerButton}
        tabs={
          <Tabs
            mode="state"
            variant="strip"
            label={t('registry.filterLabel')}
            value={kind}
            onValueChange={(value) => setKind(value as KindFilter)}
            items={KIND_FILTERS.map((key) => ({
              key,
              label: t(`registry.kinds.${key}`),
              count: entries.isPending
                ? undefined
                : inStatus.filter((e) => key === 'all' || e.kind === key)
                    .length,
            }))}
          />
        }
      />
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
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            {(['active', 'retired', 'all'] as const).map((key) => (
              <option key={key} value={key}>
                {t(`registry.statusFilters.${key}`)}
              </option>
            ))}
          </Select>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {entries.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('registry.loadError')}>
              {messageOf(entries.error, '')}
            </Notice>
          </div>
        ) : entries.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('registry.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(entry) => entry.id}
            selectable
            onRowClick={open}
            isLoading={entries.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="tag"
              title={
                all.length === 0
                  ? t('registry.empty.title')
                  : t('registry.empty.filtered')
              }
              description={
                all.length === 0 ? t('registry.empty.body') : undefined
              }
              action={
                all.length === 0 ? (registerButton ?? undefined) : undefined
              }
            />
          </div>
        )}
        {!canWrite && !entries.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('registry.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
      <RegistryFormDialog
        open={registering}
        onOpenChange={setRegistering}
        initialKind={kind === 'all' ? 'construct' : kind}
        entries={all.filter((e) => e.status === 'active')}
        onSaved={open}
      />
    </div>
  )
}
