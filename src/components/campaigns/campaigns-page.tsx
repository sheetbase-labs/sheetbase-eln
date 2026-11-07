/**
 * The Campaigns page: every record of the record models ticked as a campaign
 * list. A lab with none yet can start from the ready-made Campaign model.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ListHeader,
  ListToolbar,
  ReadOnlyNote,
} from '#/components/inventory/list'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  campaignKeys,
  fetchCampaignList,
  fetchCampaignModels,
  setUpCampaignModel,
} from '#/lib/campaigns/data'
import type { CampaignListItem } from '#/lib/campaigns/data'
import type { CampaignStatus } from '#/lib/campaigns/campaign'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { messageOf } from '#/lib/result-quality'

const client = notebookDataClient

export const CAMPAIGN_TONE = {
  draft: 'draft',
  active: 'progress',
  paused: 'warn',
  finished: 'ok',
} as const satisfies Record<CampaignStatus, string>

export function CampaignsPage({
  canWrite,
  canEditModels,
}: {
  canWrite: boolean
  canEditModels: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')

  const models = useQuery({
    queryKey: campaignKeys.models,
    queryFn: () => fetchCampaignModels(client),
    staleTime: 10_000,
  })
  const ticked = useMemo(() => models.data ?? [], [models.data])
  const keys = useMemo(() => ticked.map((m) => m.key), [ticked])
  const list = useQuery({
    queryKey: campaignKeys.list(keys),
    queryFn: () => fetchCampaignList(client, keys),
    enabled: models.isSuccess && keys.length > 0,
    staleTime: 10_000,
  })
  const rounds = useQuery({
    queryKey: [...campaignKeys.all, 'round-counts'],
    queryFn: () =>
      client.list<{ campaign_record_id: string; status: string }>(
        'campaign_rounds',
        '?select=campaign_record_id,status&limit=5000',
      ),
    enabled: keys.length > 0,
    staleTime: 10_000,
  })
  const used = useMemo(() => {
    const out = new Map<string, number>()
    for (const r of rounds.data ?? [])
      if (r.status !== 'rejected' && r.status !== 'failed')
        out.set(r.campaign_record_id, (out.get(r.campaign_record_id) ?? 0) + 1)
    return out
  }, [rounds.data])

  const all = useMemo(
    () => (list.data ?? []).filter((c) => !c.archived_at),
    [list.data],
  )
  const needle = q.trim().toLowerCase()
  const visible = all.filter(
    (c) =>
      (kind === 'all' || c.kind === kind) &&
      (needle === '' ||
        `${c.identifier} ${c.title}`.toLowerCase().includes(needle)),
  )

  const setUp = useMutation({
    mutationFn: () => setUpCampaignModel(client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('planner.campaigns.empty.couldNotSetUp'))),
  })

  const columns = useMemo<RegistryColumn<CampaignListItem>[]>(
    () => [
      {
        id: 'number',
        header: t('planner.campaigns.columns.number'),
        size: 110,
        cell: ({ row }) => (
          <ObjectLink
            kind="record"
            id={row.original.id}
            identifier={row.original.identifier}
            className="text-fg-muted"
          />
        ),
      },
      {
        id: 'title',
        header: t('planner.campaigns.columns.title'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.title}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('planner.campaigns.columns.status'),
        size: 150,
        cell: ({ row }) =>
          row.original.campaign ? (
            <Status tone={CAMPAIGN_TONE[row.original.campaign.status]}>
              {t(`planner.campaigns.status.${row.original.campaign.status}`)}
            </Status>
          ) : (
            <Status tone="none">
              {t('planner.campaigns.status.notSetUp')}
            </Status>
          ),
      },
      {
        id: 'progress',
        header: t('planner.campaigns.columns.progress'),
        size: 110,
        cell: ({ row }) =>
          row.original.campaign ? (
            <span className="num text-fg-muted">
              {t('planner.campaigns.roundsOf', {
                used: used.get(row.original.id) ?? 0,
                max: row.original.campaign.max_rounds,
              })}
            </span>
          ) : null,
      },
      {
        id: 'updated',
        header: t('planner.campaigns.columns.updated'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.updated_at)}
          </span>
        ),
      },
    ],
    [used],
  )

  const open = (c: CampaignListItem) =>
    void navigate({
      to: '/campaigns/$campaignId',
      params: { campaignId: c.id },
    })

  function create() {
    const only =
      kind !== 'all' ? kind : ticked.length === 1 ? ticked[0].key : null
    void navigate({
      to: '/models/$modelId/records/new',
      params: { modelId: only ?? ticked[0].key },
    })
  }

  const newButton =
    canWrite && ticked.length > 0 ? (
      <Button variant="primary" icon="plus" onClick={create}>
        {t('planner.campaigns.newCampaign')}
      </Button>
    ) : null
  const noModels = models.isSuccess && ticked.length === 0

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('planner.campaigns.title')}
        subtitle={t('planner.campaigns.subtitle')}
        total={list.data ? all.length : undefined}
        actions={newButton}
        tabs={
          ticked.length > 1 ? (
            <Tabs
              mode="state"
              variant="strip"
              label={t('planner.campaigns.filterLabel')}
              value={kind}
              onValueChange={setKind}
              items={[
                {
                  key: 'all',
                  label: t('planner.campaigns.all'),
                  count: list.isPending ? undefined : all.length,
                },
                ...ticked.map((m) => ({
                  key: m.key,
                  label: m.name,
                  count: list.isPending
                    ? undefined
                    : all.filter((c) => c.kind === m.key).length,
                })),
              ]}
            />
          ) : undefined
        }
      />
      {noModels ? null : (
        <ListToolbar
          q={q}
          onSearch={setQ}
          placeholder={t('planner.campaigns.searchPlaceholder')}
          label={t('planner.campaigns.searchPlaceholder')}
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {models.isError || list.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('planner.campaigns.loadError')}>
              {messageOf(models.error ?? list.error, '')}
            </Notice>
          </div>
        ) : noModels ? (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="lineChart"
              title={t('planner.campaigns.empty.title')}
              description={
                canEditModels
                  ? t('planner.campaigns.empty.body')
                  : t('planner.campaigns.empty.notAllowed')
              }
              action={
                canEditModels ? (
                  <Button
                    variant="primary"
                    disabled={setUp.isPending}
                    onClick={() => setUp.mutate()}
                  >
                    {setUp.isPending
                      ? t('planner.campaigns.empty.settingUp')
                      : t('planner.campaigns.empty.setUp')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : models.isPending || list.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('planner.campaigns.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(c) => c.id}
            onRowClick={open}
            isLoading={models.isPending || list.isPending}
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="lineChart"
              title={
                all.length === 0
                  ? t('planner.campaigns.empty.none')
                  : t('planner.campaigns.empty.filtered')
              }
              description={
                all.length === 0
                  ? t('planner.campaigns.empty.noneBody')
                  : undefined
              }
              action={all.length === 0 ? (newButton ?? undefined) : undefined}
            />
          </div>
        )}
        {!canWrite && !models.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('planner.campaigns.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
    </div>
  )
}
