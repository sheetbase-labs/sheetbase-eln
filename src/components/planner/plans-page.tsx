/** The Plans page: every plan the planner, the assistant or the API has drawn up. */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

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
import type { Tone } from '#/components/ui/status'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchPlans, planKeys } from '#/lib/planner/data'
import type { ExperimentPlanRow, PlanStatus } from '#/lib/planner/data'
import { planReference } from '#/lib/planner/plan'
import { usePageAi } from '#/lib/use-page-ai'

import { PlanDialog } from './plan-dialog'

const client = notebookDataClient

export const PLAN_TONE: Record<PlanStatus, Tone> = {
  proposed: 'review',
  applied: 'ok',
  dismissed: 'draft',
  superseded: 'draft',
}

export function PlansPage({ canWrite }: { canWrite: boolean }) {
  const navigate = useNavigate()
  const ai = usePageAi()
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const plans = useQuery({
    queryKey: planKeys.list,
    queryFn: () => fetchPlans(client),
    staleTime: 10_000,
  })
  const all = useMemo(() => plans.data ?? [], [plans.data])
  const needle = q.trim().toLowerCase()
  const visible = all.filter(
    (p) =>
      needle === '' ||
      `${planReference(p.number)} ${p.goal} ${p.summary}`
        .toLowerCase()
        .includes(needle),
  )

  const columns = useMemo<RegistryColumn<ExperimentPlanRow>[]>(
    () => [
      {
        id: 'plan',
        header: t('planner.plans.columns.plan'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {planReference(row.original.number)}
          </span>
        ),
      },
      {
        id: 'goal',
        header: t('planner.plans.columns.goal'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.goal}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('planner.plans.columns.status'),
        size: 150,
        cell: ({ row }) => (
          <Status tone={PLAN_TONE[row.original.status]}>
            {t(`planner.plans.status.${row.original.status}`)}
          </Status>
        ),
      },
      {
        id: 'experiment',
        header: t('planner.plans.columns.experiment'),
        size: 130,
        cell: ({ row }) =>
          row.original.result ? (
            <ObjectLink
              kind="record"
              id={row.original.result.recordId}
              identifier={row.original.result.identifier}
            />
          ) : null,
      },
      {
        id: 'created',
        header: t('planner.plans.columns.created'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
    ],
    [],
  )

  const planButton =
    canWrite && ai.live ? (
      <Button variant="primary" icon="spark" onClick={() => setAsking(true)}>
        {t('planner.plans.planWithAi')}
      </Button>
    ) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        title={t('planner.plans.title')}
        subtitle={t('planner.plans.subtitle')}
        total={plans.data ? all.length : undefined}
        actions={planButton}
      />
      <ListToolbar
        q={q}
        onSearch={setQ}
        placeholder={t('planner.plans.searchPlaceholder')}
        label={t('planner.plans.searchPlaceholder')}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {plans.isError ? (
          <div className="p-6">
            <Notice tone="bad" title={t('planner.plans.loadError')} />
          </div>
        ) : plans.isPending || visible.length > 0 ? (
          <RegistryGrid
            label={t('planner.plans.tableLabel')}
            rows={visible}
            columns={columns}
            getRowId={(p) => p.id}
            isLoading={plans.isPending}
            onRowClick={(p) =>
              void navigate({ to: '/plans/$planId', params: { planId: p.id } })
            }
          />
        ) : (
          <div role="status" className="flex justify-center px-6">
            <EmptyState
              className="items-center py-14 text-center"
              icon="spark"
              title={
                all.length === 0
                  ? t('planner.plans.empty.title')
                  : t('planner.plans.empty.filtered')
              }
              description={
                all.length === 0
                  ? ai.live
                    ? t('planner.plans.empty.body')
                    : t('planner.plans.empty.aiOff')
                  : undefined
              }
              action={all.length === 0 ? (planButton ?? undefined) : undefined}
            />
          </div>
        )}
        {!canWrite && !plans.isPending ? (
          <div className="px-6 pb-4">
            <ReadOnlyNote>{t('planner.plans.readOnly')}</ReadOnlyNote>
          </div>
        ) : null}
      </div>
      <PlanDialog open={asking} onOpenChange={setAsking} />
    </div>
  )
}
