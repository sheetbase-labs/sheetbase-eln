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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { useExperimentLinks } from '../$expId'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (RM-118): an experiment's results — the datasets it produced, the
 * analyses it cites, and the recorded decision. */
export const Route = createFileRoute('/experiments/$expId/results')({
  component: ResultsTab,
})

interface DatasetSummaryWire {
  display_id: string | null
  name: string
  model: string | null
  row_count: number | string
  issue_count: number | string
}

interface AnalysisSummaryWire {
  id: string
  display_id: string | null
  name: string
}

const DECISIONS = [
  { value: 'supported', label: 'Supported' },
  { value: 'refuted', label: 'Refuted' },
  { value: 'inconclusive', label: 'Inconclusive' },
] as const

function ResultsTab() {
  const { expId } = Route.useParams()
  const queryClient = useQueryClient()
  const links = useExperimentLinks(expId)
  const all = links.data ?? []

  const datasetIds = all
    .filter((l) => l.target_kind === 'dataset')
    .map((l) => l.target_identifier)
  const analysisIds = all
    .filter((l) => l.target_kind === 'analysis' || l.link_type === 'analysis')
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
    queryFn: async () => {
      const rows = await notebookDataClient.rpc<DatasetSummaryWire[]>(
        'dataset_list_summary',
        {},
      )
      return rows.filter(
        (d) => d.display_id && datasetIds.includes(d.display_id),
      )
    },
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
        `?display_id=in.(${analysisIds.map(encodeURIComponent).join(',')})&select=id,display_id,name`,
      ),
  })

  const [open, setOpen] = useState(false)
  const decision = record.data?.decision ?? null
  const decisionLabel = decision
    ? (DECISIONS.find((d) => d.value === decision)?.label ?? decision)
    : 'Not recorded'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] px-4 py-[22px] md:px-8">
      <Section title="Figure" count={analyses.data?.length ?? 0}>
        {analyses.data?.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {analyses.data.map((a) => (
              <li key={a.id}>
                <Link to="/analysis/$analysisId" params={{ analysisId: a.id }}>
                  <span className="mono text-fg-muted">{a.display_id}</span>{' '}
                  {a.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            className="py-2"
            title="No cited analyses"
            body="Analyses saved and cited into this experiment’s notebook appear here."
          />
        )}
      </Section>

      <Section title="Table" count={datasets.data?.length ?? 0}>
        {datasets.data?.length ? (
          <TableBox>
            <Table aria-label="Result datasets">
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead align="right">Rows</TableHead>
                  <TableHead>Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.data.map((d) => {
                  const issues = Number(d.issue_count)
                  return (
                    <TableRow key={d.display_id}>
                      <TableCell className="mono">{d.display_id}</TableCell>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-fg-muted">
                        {d.model ?? '—'}
                      </TableCell>
                      <TableCell align="right" className="num">
                        {String(d.row_count)}
                      </TableCell>
                      <TableCell>
                        {issues === 0 ? (
                          <Status tone="ok">Valid</Status>
                        ) : (
                          <Status tone="bad">
                            {issues} issue{issues === 1 ? '' : 's'}
                          </Status>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            title="No datasets"
            body="Datasets this experiment produced appear here when they are linked."
          />
        )}
      </Section>

      <Section
        title="Decision"
        action={
          <Button onClick={() => setOpen(true)}>
            {decision ? 'Change decision' : 'Record decision'}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader title="Record decision" />
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
      toast('Decision recorded')
      onDone()
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t record it.',
      )
    },
  })
  return (
    <>
      <DialogBody>
        <Field label="Decision">
          <div className="flex gap-1.5">
            {DECISIONS.map((d) => (
              <Button
                key={d.value}
                variant={decision === d.value ? 'primary' : 'secondary'}
                onClick={() => setDecision(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Note" hint="Optional.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <span className="flex-1" />
        <Button onClick={onDone}>Cancel</Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
