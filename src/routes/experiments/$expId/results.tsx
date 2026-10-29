import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { useExperimentLinks } from '../$expId'
import { notebookDataClient } from '#/lib/notebook-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import { ResultsWorkspace } from '#/components/v3/experiments/results-workspace'
import { t } from '#/copy'

/** UI port (RM-118): an experiment's results — the datasets it produced, the
 * analyses it cites, and the recorded decision. */
export const Route = createFileRoute('/experiments/$expId/results')({
  component: ResultsTab,
})

interface DatasetSummaryWire {
  id: string
  display_id: string | null
  name: string
  model: string | null
  row_count: number | string
  issue_count: number | string
}

type AnalysisSummaryWire = AnalysisViewWire

const DECISIONS = [
  { value: 'supported', label: t('projects.expResults.decisions.supported') },
  { value: 'refuted', label: t('projects.expResults.decisions.refuted') },
  {
    value: 'inconclusive',
    label: t('projects.expResults.decisions.inconclusive'),
  },
] as const

function ResultsTab() {
  const { expId } = Route.useParams()
  const queryClient = useQueryClient()
  const links = useExperimentLinks(expId)
  const all = links.data ?? []

  const datasetIds = all
    .filter((l) => l.target_kind === 'dataset')
    .map((l) => l.target_identifier)
  // A cited analysis is a `record_links` row with `link_type` and `target_kind`
  // 'analysis' — the exact predicate `internal.analysis_view_citations` reads.
  const analysisIds = all
    .filter((l) => l.link_type === 'analysis' && l.target_kind === 'analysis')
    .map((l) => l.target_identifier)

  const record = useQuery({
    queryKey: ['ui-port', 'experiment', 'decision', expId],
    queryFn: async () => {
      const rows = await notebookDataClient.list<{
        decision: string | null
        decision_notes: string | null
      }>(
        'records',
        `?id=eq.${encodeURIComponent(expId)}&select=decision,decision_notes`,
      )
      return rows.at(0) ?? null
    },
  })

  const datasets = useQuery({
    queryKey: [
      'ui-port',
      'experiment',
      'result-datasets',
      datasetIds.join(','),
    ],
    enabled: datasetIds.length > 0,
    queryFn: () =>
      notebookDataClient.list<DatasetSummaryWire>(
        'rpc/dataset_list_summary',
        `?display_id=in.(${datasetIds
          .map(encodeURIComponent)
          .join(',')})&select=id,display_id,name,model,row_count,issue_count`,
      ),
  })

  const analyses = useQuery({
    queryKey: [
      'ui-port',
      'experiment',
      'result-analyses',
      analysisIds.join(','),
    ],
    enabled: analysisIds.length > 0,
    queryFn: () =>
      notebookDataClient.list<AnalysisSummaryWire>(
        'analysis_views',
        `?display_id=in.(${analysisIds.map(encodeURIComponent).join(',')})&order=display_id.asc`,
      ),
  })

  const [open, setOpen] = useState(false)
  const datasetColumns: RegistryColumn<DatasetSummaryWire>[] = [
    {
      id: 'id',
      header: t('projects.expResults.id'),
      cell: ({ row }) => (
        <ObjectLink
          kind="dataset"
          id={row.original.id}
          identifier={row.original.display_id}
        />
      ),
    },
    {
      id: 'dataset',
      header: t('projects.expResults.dataset'),
      cell: ({ row }) => (
        <ObjectLink kind="dataset" id={row.original.id} mono={false}>
          <span className="font-medium">{row.original.name}</span>
        </ObjectLink>
      ),
    },
    {
      id: 'model',
      header: t('projects.expResults.model'),
      cell: ({ row }) => row.original.model ?? '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'rows',
      header: t('projects.expResults.rows'),
      cell: ({ row }) => String(row.original.row_count),
      meta: {
        ...rightAligned<DatasetSummaryWire>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'validation',
      header: t('projects.expResults.validation'),
      cell: ({ row }) => {
        const issues = Number(row.original.issue_count)
        return issues === 0 ? (
          <Status tone="ok">{t('projects.expResults.valid')}</Status>
        ) : (
          <Status tone="bad">
            {t('projects.expResults.issues', { count: issues })}
          </Status>
        )
      },
    },
    {
      id: 'analyse',
      header: '',
      cell: ({ row }) => (
        <Link
          to="/analysis/new"
          search={{
            mode: 'chart',
            dataset: row.original.id,
            experiment: expId,
            returnTo: `/experiments/${expId}/results`,
          }}
          className="text-link"
        >
          {t('projects.expDatasets.analyse')}
        </Link>
      ),
      meta: { cellClassName: 'text-right' },
    },
  ]
  const decision = record.data?.decision ?? null
  const decisionLabel = decision
    ? (DECISIONS.find((d) => d.value === decision)?.label ?? decision)
    : t('projects.expResults.notRecorded')

  const decisionDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(440px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.expResults.record')} />
        <DecisionForm
          expId={expId}
          current={decision}
          notes={record.data?.decision_notes ?? ''}
          onDone={() => {
            setOpen(false)
            void queryClient.invalidateQueries({
              queryKey: ['ui-port', 'experiment', 'decision', expId],
            })
          }}
        />
      </DialogContent>
    </Dialog>
  )

  if (analyses.data?.length && analyses.data.every((view) => view.charts[0])) {
    return (
      <>
        <ResultsWorkspace
          expId={expId}
          views={analyses.data}
          decision={{
            label: decisionLabel,
            notes: record.data?.decision_notes ?? null,
            action: (
              <Button onClick={() => setOpen(true)}>
                {decision
                  ? t('projects.expResults.change')
                  : t('projects.expResults.record')}
              </Button>
            ),
          }}
        />
        {decisionDialog}
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section
        title={t('projects.expResults.analyses')}
        count={analyses.data?.length ?? 0}
      >
        {analyses.data?.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {analyses.data.map((a) => (
              <li key={a.id}>
                <ObjectLink kind="analysis" id={a.id} mono={false}>
                  <span className="mono text-fg-muted">{a.display_id}</span>{' '}
                  {a.name}
                </ObjectLink>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            className="py-2"
            title={t('projects.expResults.noAnalyses.title')}
            description={t('projects.expResults.noAnalyses.body')}
            action={
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/analysis/new"
                    search={{
                      mode: 'chart',
                      experiment: expId,
                      returnTo: `/experiments/${expId}/results`,
                    }}
                  />
                }
              >
                {t('projects.expResults.newAnalysis')}
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title={t('projects.expResults.datasets')}
        count={datasets.data?.length ?? 0}
        action={
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/import" search={{ experiment: expId }} />}
          >
            {t('projects.expDatasets.import')}
          </Button>
        }
      >
        {datasets.data?.length ? (
          <TableBox>
            <RegistryGrid
              label={t('projects.expResults.resultDatasets')}
              rows={datasets.data}
              columns={datasetColumns}
              getRowId={(d) => d.name}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            title={t('projects.expResults.noDatasets.title')}
            description={t('projects.expResults.noDatasets.body')}
          />
        )}
      </Section>

      <Section
        title={t('projects.expResults.decision')}
        action={
          <Button onClick={() => setOpen(true)}>
            {decision
              ? t('projects.expResults.change')
              : t('projects.expResults.record')}
          </Button>
        }
      >
        <p className="m-0 text-body">
          <span className="font-medium">{decisionLabel}</span>
          {record.data?.decision_notes ? (
            <span className="text-fg-muted">
              {' '}
              · {record.data.decision_notes}
            </span>
          ) : null}
        </p>
      </Section>

      {decisionDialog}
    </div>
  )
}

function DecisionForm({
  expId,
  current,
  notes,
  onDone,
}: {
  expId: string
  current: string | null
  notes: string
  onDone: () => void
}) {
  const [decision, setDecision] = useState(current ?? 'supported')
  const [note, setNote] = useState(notes)
  const save = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('set_experiment_decision', {
        p_record_id: expId,
        p_decision: decision,
        p_notes: note.trim() || null,
      }),
    onSuccess: () => {
      toast(t('projects.expResults.recorded'))
      onDone()
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t('projects.expResults.recordFailed'),
      )
    },
  })
  return (
    <>
      <DialogBody>
        {/* A group, not a Field: a label around three buttons would name the
            first one after all of them. */}
        <div className="flex flex-col gap-1.5">
          <span id="decision-label" className="text-label font-medium">
            {t('projects.expResults.decision')}
          </span>
          <div
            role="radiogroup"
            aria-labelledby="decision-label"
            className="flex gap-1.5"
          >
            {DECISIONS.map((d) => (
              <Button
                key={d.value}
                role="radio"
                aria-checked={decision === d.value}
                variant={decision === d.value ? 'primary' : 'secondary'}
                onClick={() => setDecision(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
        <Field
          label={t('projects.expResults.note')}
          hint={t('projects.expResults.optional')}
        >
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <span className="flex-1" />
        <Button onClick={onDone}>{t('common.actions.cancel')}</Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending
            ? t('common.states.saving')
            : t('common.actions.save')}
        </Button>
      </DialogFooter>
    </>
  )
}
