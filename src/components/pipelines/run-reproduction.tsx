import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { reproducePipelineRun } from '#/lib/pipelines/data'
import type {
  PipelineReproductionStatus,
  PipelineReproductionSummary,
  PipelineReproductionWire,
} from '#/lib/pipelines/types'
import { explainRunError } from '#/lib/pipelines/run-errors'
import {
  pipelineDataQueryKeys,
  useRunReproductions,
} from '#/components/pipelines/pipelines-data'

const STATUS: Record<
  PipelineReproductionStatus,
  { tone: Tone; label: string }
> = {
  matches: { tone: 'ok', label: t('data.reproduce.stillMatches') },
  differs: { tone: 'warn', label: t('data.reproduce.differs') },
  failed: { tone: 'bad', label: t('data.reproduce.failed') },
}

/** Matches, Differs or Could not re-run, as a status dot and word. */
export function ReproductionBadge({
  status,
}: {
  status: PipelineReproductionStatus
}) {
  const view = STATUS[status]
  return <Status tone={view.tone}>{view.label}</Status>
}

const COMPARED: Record<string, string> = {
  dataset_version: t('data.reproduce.comparedVersion'),
  preview: t('data.reproduce.comparedPreview'),
  digest: t('data.reproduce.comparedDigest'),
}

function summaryOf(
  reproduction: PipelineReproductionWire,
): Partial<PipelineReproductionSummary> {
  return reproduction.summary as Partial<PipelineReproductionSummary>
}

/** Reproduce a run, then refresh what the page shows about it. */
export function useReproduceRun(
  runId: string,
  onDone?: (reproduction: PipelineReproductionWire) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => reproducePipelineRun({ runId }),
    onSuccess: (reproduction) => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.reproductions(runId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'pipelines', 'reproductions-latest'],
      })
      toast(
        reproduction.status === 'matches'
          ? t('data.reproduce.stillMatches')
          : reproduction.status === 'differs'
            ? t('data.reproduce.differs')
            : t('data.reproduce.failed'),
      )
      onDone?.(reproduction)
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.reproduce.couldNotReproduce'),
      ),
  })
}

/** One result: the verdict in words, then what changed. */
export function ReproductionResult({
  reproduction,
}: {
  reproduction: PipelineReproductionWire
}) {
  const summary = summaryOf(reproduction)
  const changes = reproduction.changes
  const inputChanged = (summary.inputs ?? []).some(
    (input) => input.unchanged === false,
  )
  if (reproduction.status === 'failed') {
    const guidance = explainRunError(reproduction.error_code)
    return (
      <Notice tone="bad" title={guidance.title}>
        <p className="m-0 whitespace-pre-wrap">
          {reproduction.error_message ?? t('data.reproduce.failed')}
        </p>
      </Notice>
    )
  }
  const rows = summary.reproducedRows ?? 0
  return (
    <div className="flex flex-col gap-3">
      <Notice
        tone={reproduction.status === 'matches' ? 'info' : 'warn'}
        icon={reproduction.status === 'matches' ? 'check' : 'warn'}
        title={STATUS[reproduction.status].label}
      >
        {reproduction.status === 'matches'
          ? summary.identical
            ? t('data.reproduce.matchesDetail', { count: rows })
            : t('data.reproduce.matchesToleranceDetail', { count: rows })
          : t('data.reproduce.differsDetail', {
              changed: summary.changedRows ?? 0,
              added: summary.addedRows ?? 0,
              removed: summary.removedRows ?? 0,
            })}
        {summary.note ? <> {summary.note}</> : null}
      </Notice>
      {inputChanged ? (
        <Notice tone="warn">{t('data.reproduce.inputChanged')}</Notice>
      ) : null}
      {summary.columnsAdded?.length ? (
        <Muted>
          {t('data.reproduce.columnsAdded', {
            names: summary.columnsAdded.join(', '),
          })}
        </Muted>
      ) : null}
      {summary.columnsRemoved?.length ? (
        <Muted>
          {t('data.reproduce.columnsRemoved', {
            names: summary.columnsRemoved.join(', '),
          })}
        </Muted>
      ) : null}
      {changes.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 font-sans text-label font-semibold">
            {t('data.reproduce.changesTitle')}
          </h3>
          <TableBox>
            <Table aria-label={t('data.reproduce.changesTitle')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('data.reproduce.kind')}</TableHead>
                  <TableHead>{t('data.reproduce.row')}</TableHead>
                  <TableHead>{t('data.reproduce.column')}</TableHead>
                  <TableHead>{t('data.reproduce.recorded')}</TableHead>
                  <TableHead>{t('data.reproduce.now')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.flatMap((change, index) =>
                  change.kind === 'changed'
                    ? change.cells.map((cell) => (
                        <TableRow key={`${index}-${cell.column}`}>
                          <TableCell>
                            <Status tone="warn">
                              {t('data.reproduce.kindChanged')}
                            </Status>
                          </TableCell>
                          <TableCell>
                            {rowLabel(
                              change.row,
                              change.cells.map((c) => c.column),
                            )}
                          </TableCell>
                          <TableCell>{cell.column}</TableCell>
                          <TableCell className="num">
                            {formatCell(cell.before)}
                          </TableCell>
                          <TableCell className="num">
                            {formatCell(cell.after)}
                          </TableCell>
                        </TableRow>
                      ))
                    : [
                        <TableRow key={index}>
                          <TableCell>
                            <Status
                              tone={change.kind === 'added' ? 'ok' : 'bad'}
                            >
                              {change.kind === 'added'
                                ? t('data.reproduce.kindAdded')
                                : t('data.reproduce.kindRemoved')}
                            </Status>
                          </TableCell>
                          <TableCell colSpan={4}>
                            {Object.entries(change.row)
                              .slice(0, 6)
                              .map(([k, v]) => `${k}: ${formatCell(v)}`)
                              .join(' · ')}
                          </TableCell>
                        </TableRow>,
                      ],
                )}
              </TableBody>
            </Table>
          </TableBox>
          {summary.truncated ? (
            <Muted>{t('data.reproduce.moreChanges')}</Muted>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

/** Which row a change is in: the values that did not change, since rows have no number. */
function rowLabel(row: Record<string, unknown>, changed: string[]): string {
  const parts = Object.entries(row)
    .filter(([column, value]) => !changed.includes(column) && value !== null)
    .slice(0, 3)
    .map(([column, value]) => `${column}: ${formatCell(value)}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toPrecision(10)))
  }
  return String(value)
}

/**
 * The Reproduce section of a run: the button, the newest result with what
 * changed, and the earlier checks.
 */
export function RunReproductions({
  runId,
  canReproduce,
  nameOf,
}: {
  runId: string
  canReproduce: boolean
  nameOf: (userId: string) => string
}) {
  const reproductions = useRunReproductions(runId)
  const reproduce = useReproduceRun(runId)
  const list = reproductions.data ?? []
  const [latest, ...earlier] = list
  return (
    <section
      id="reproduce"
      aria-label={t('data.reproduce.title')}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 font-sans text-label font-semibold">
          {t('data.reproduce.title')}
        </h2>
        {latest ? <ReproductionBadge status={latest.status} /> : null}
        <span className="flex-1" />
        {canReproduce ? (
          <Button
            size="sm"
            icon="refresh"
            disabled={reproduce.isPending}
            onClick={() => reproduce.mutate()}
          >
            {reproduce.isPending
              ? t('data.reproduce.running')
              : t('data.reproduce.action')}
          </Button>
        ) : null}
      </div>
      <Muted>{t('data.reproduce.intro')}</Muted>
      {latest ? (
        <ReproductionResult reproduction={latest} />
      ) : reproductions.isLoading ? null : (
        <Muted>{t('data.reproduce.noneYet')}</Muted>
      )}
      {earlier.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 font-sans text-label font-semibold">
            {t('data.reproduce.historyTitle')}
          </h3>
          <TableBox>
            <Table aria-label={t('data.reproduce.historyTitle')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('data.reproduce.when')}</TableHead>
                  <TableHead>{t('data.reproduce.result')}</TableHead>
                  <TableHead>{t('data.reproduce.rowsChecked')}</TableHead>
                  <TableHead>{t('data.reproduce.comparedBy')}</TableHead>
                  <TableHead>{t('data.reproduce.checkedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {earlier.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {formatNotebookDateTime(entry.created_at, { zone: true })}
                    </TableCell>
                    <TableCell>
                      <ReproductionBadge status={entry.status} />
                    </TableCell>
                    <TableCell className="num">
                      {summaryOf(entry).reproducedRows ?? '—'}
                    </TableCell>
                    <TableCell>
                      {entry.compared ? COMPARED[entry.compared] : '—'}
                    </TableCell>
                    <TableCell>
                      {entry.requested_by_user_id
                        ? nameOf(entry.requested_by_user_id)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        </section>
      ) : null}
    </section>
  )
}

/**
 * On a dataset snapshot a pipeline made: where it came from, and a button to
 * check it can be made again. The result is shown in place, with a way into the
 * run for what changed.
 */
export function SnapshotReproduce({
  runId,
  pipelineId,
  canReproduce,
}: {
  runId: string
  pipelineId: string
  canReproduce: boolean
}) {
  const [verdict, setVerdict] = useState<PipelineReproductionWire | null>(null)
  const reproduce = useReproduceRun(runId, setVerdict)
  return (
    <div className="flex flex-col gap-1.5">
      <Link
        to="/pipelines/$pipelineId/runs/$runId"
        params={{ pipelineId, runId }}
        className="underline"
      >
        {t('data.reproduce.producedByRun', { run: runId.slice(0, 8) })}
      </Link>
      <Muted>{t('data.reproduce.reproduceVersion')}</Muted>
      {canReproduce ? (
        <Button
          size="sm"
          icon="refresh"
          disabled={reproduce.isPending}
          onClick={() => reproduce.mutate()}
        >
          {reproduce.isPending
            ? t('data.reproduce.running')
            : t('data.reproduce.action')}
        </Button>
      ) : null}
      {verdict ? (
        <div className="flex flex-wrap items-center gap-2">
          <ReproductionBadge status={verdict.status} />
          <Link
            to="/pipelines/$pipelineId/runs/$runId"
            params={{ pipelineId, runId }}
            hash="reproduce"
            className="underline"
          >
            {t('data.reproduce.viewDetails')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
