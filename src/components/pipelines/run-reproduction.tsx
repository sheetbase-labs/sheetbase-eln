import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { z } from 'zod'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { reproducePipelineRun } from '#/lib/pipelines/data'
import type {
  PipelineReproductionStatus,
  PipelineReproductionSummary,
  PipelineReproductionWire,
} from '#/lib/pipelines/types'
import { explainRunError } from '#/lib/pipelines/run-errors'
import type { DiffCell, DiffRow } from '#/lib/pipelines/reproduce-diff'
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

const COMPARED = {
  dataset_version: t('data.reproduce.comparedVersion'),
  preview: t('data.reproduce.comparedPreview'),
  digest: t('data.reproduce.comparedDigest'),
}

function summaryOf(
  reproduction: PipelineReproductionWire,
): Partial<PipelineReproductionSummary> {
  return reproduction.summary
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
    onError: (error) =>
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

  return (
    <div className="flex flex-col gap-3">
      <ReproductionVerdict reproduction={reproduction} />
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
      <ReproductionChanges reproduction={reproduction} />
    </div>
  )
}

function ReproductionVerdict({
  reproduction,
}: {
  reproduction: PipelineReproductionWire
}) {
  const summary = summaryOf(reproduction)
  const rows = summary.reproducedRows ?? 0

  return (
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
  )
}

type ChangeLine = {
  key: string
  kind: 'changed' | 'added' | 'removed'
  row: string
  column: string
  recorded: string
  now: string
}

/** Every changed cell is a line; an added or removed row is one line of its values. */
function changeLines(
  changes: {
    change: PipelineReproductionWire['changes'][number]
    key: string
  }[],
): ChangeLine[] {
  return changes.flatMap(({ change, key }): ChangeLine[] =>
    change.kind === 'changed'
      ? change.cells.map((cell) => ({
          key: `${key}-${cell.column}`,
          kind: 'changed',
          row: rowLabel(
            change.row,
            change.cells.map((c) => c.column),
          ),
          column: cell.column,
          recorded: formatCell(cell.before),
          now: formatCell(cell.after),
        }))
      : [
          {
            key,
            kind: change.kind,
            row: Object.entries(change.row)
              .slice(0, 6)
              .map(([k, v]) => `${k}: ${formatCell(v)}`)
              .join(' · '),
            column: '',
            recorded: '',
            now: '',
          },
        ],
  )
}

function ChangesGrid({
  changes,
}: {
  changes: {
    change: PipelineReproductionWire['changes'][number]
    key: string
  }[]
}) {
  const lines = useMemo(() => changeLines(changes), [changes])

  const columns = useMemo<RegistryColumn<ChangeLine>[]>(
    () => [
      {
        id: 'kind',
        header: t('data.reproduce.kind'),
        accessorFn: (line) => line.kind,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.kind === 'changed' ? (
            <Status tone="warn">{t('data.reproduce.kindChanged')}</Status>
          ) : (
            <Status tone={row.original.kind === 'added' ? 'ok' : 'bad'}>
              {row.original.kind === 'added'
                ? t('data.reproduce.kindAdded')
                : t('data.reproduce.kindRemoved')}
            </Status>
          ),
      },
      {
        id: 'row',
        header: t('data.reproduce.row'),
        accessorFn: (line) => line.row,
        cell: ({ row }) => row.original.row,
      },
      {
        id: 'column',
        header: t('data.reproduce.column'),
        accessorFn: (line) => line.column,
        cell: ({ row }) => row.original.column,
      },
      {
        id: 'recorded',
        header: t('data.reproduce.recorded'),
        accessorFn: (line) => line.recorded,
        cell: ({ row }) => <span className="num">{row.original.recorded}</span>,
      },
      {
        id: 'now',
        header: t('data.reproduce.now'),
        accessorFn: (line) => line.now,
        cell: ({ row }) => <span className="num">{row.original.now}</span>,
      },
    ],
    [],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.reproduce.changesTitle')}
        rows={lines}
        columns={columns}
        getRowId={(line) => line.key}
        selectable={false}
      />
    </TableBox>
  )
}

function HistoryGrid({
  entries,
  nameOf,
}: {
  entries: PipelineReproductionWire[]
  nameOf: (userId: string) => string
}) {
  const columns = useMemo<RegistryColumn<PipelineReproductionWire>[]>(
    () => [
      {
        id: 'when',
        header: t('data.reproduce.when'),
        accessorFn: (entry) => entry.created_at,
        enableHiding: false,
        cell: ({ row }) =>
          formatNotebookDateTime(row.original.created_at, { zone: true }),
      },
      {
        id: 'result',
        header: t('data.reproduce.result'),
        accessorFn: (entry) => entry.status,
        cell: ({ row }) => <ReproductionBadge status={row.original.status} />,
      },
      {
        id: 'rowsChecked',
        header: t('data.reproduce.rowsChecked'),
        accessorFn: (entry) => summaryOf(entry).reproducedRows ?? 0,
        cell: ({ row }) => (
          <span className="num">
            {summaryOf(row.original).reproducedRows ?? '—'}
          </span>
        ),
      },
      {
        id: 'comparedBy',
        header: t('data.reproduce.comparedBy'),
        accessorFn: (entry) => (entry.compared ? COMPARED[entry.compared] : ''),
        cell: ({ row }) =>
          row.original.compared ? COMPARED[row.original.compared] : '—',
      },
      {
        id: 'checkedBy',
        header: t('data.reproduce.checkedBy'),
        accessorFn: (entry) =>
          entry.requested_by_user_id ? nameOf(entry.requested_by_user_id) : '',
        cell: ({ row }) =>
          row.original.requested_by_user_id
            ? nameOf(row.original.requested_by_user_id)
            : '—',
      },
    ],
    [nameOf],
  )

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.reproduce.historyTitle')}
        rows={entries}
        columns={columns}
        getRowId={(entry) => entry.id}
        selectable={false}
      />
    </TableBox>
  )
}

function ReproductionChanges({
  reproduction,
}: {
  reproduction: PipelineReproductionWire
}) {
  const summary = summaryOf(reproduction)
  const occurrences = new Map<string, number>()

  const changes = reproduction.changes.map((change) => {
    const content = JSON.stringify(change)
    const occurrence = occurrences.get(content) ?? 0
    occurrences.set(content, occurrence + 1)

    return { change, key: `${content}:${occurrence}` }
  })

  return changes.length > 0 ? (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 font-sans text-label font-semibold">
        {t('data.reproduce.changesTitle')}
      </h3>
      <ChangesGrid changes={changes} />
      {summary.truncated ? (
        <Muted>{t('data.reproduce.moreChanges')}</Muted>
      ) : null}
    </section>
  ) : null
}

/** Which row a change is in: the values that did not change, since rows have no number. */
function rowLabel(row: DiffRow, changed: string[]): string {
  const changedColumns = new Set(changed)

  const parts = Object.entries(row)
    .filter(([column, value]) => !changedColumns.has(column) && value !== null)
    .slice(0, 3)
    .map(([column, value]) => `${column}: ${formatCell(value)}`)

  return parts.length > 0 ? parts.join(' · ') : '—'
}

function formatCell(value: DiffCell | undefined): string {
  if (value === null || value === undefined) return '—'

  const numeric = z.number().safeParse(value)

  if (numeric.success) {
    return Number.isInteger(numeric.data)
      ? String(numeric.data)
      : String(Number(numeric.data.toPrecision(10)))
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
  const latest: PipelineReproductionWire | undefined = list.at(0)
  const earlier = list.slice(1)

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
          <HistoryGrid entries={earlier} nameOf={nameOf} />
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
  pipelineName,
  runNumber,
  canReproduce,
}: {
  runId: string
  pipelineId: string
  pipelineName: string
  runNumber: number | null
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
        {t('data.reproduce.producedByRun', {
          pipeline: pipelineName,
          run: runNumber ?? '',
        })}
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
