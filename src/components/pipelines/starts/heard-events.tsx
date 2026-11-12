import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type {
  PipelineScheduleActivityKind,
  PipelineScheduleActivityWire,
} from '#/lib/pipelines/types'

type Tone = 'ok' | 'stored' | 'warn' | 'bad'

/** What a start did with each thing it heard, in words and how serious it is. */
export const OUTCOMES: Record<
  PipelineScheduleActivityKind,
  { label: () => string; tone: Tone }
> = {
  started: {
    label: () => t('features.pipelineStarts.outcome.started'),
    tone: 'ok',
  },
  batched: {
    label: () => t('features.pipelineStarts.outcome.batched'),
    tone: 'stored',
  },
  skipped_unchanged: {
    label: () => t('features.pipelineStarts.outcome.skippedUnchanged'),
    tone: 'stored',
  },
  skipped_overlap: {
    label: () => t('features.pipelineStarts.outcome.skippedOverlap'),
    tone: 'warn',
  },
  skipped_condition: {
    label: () => t('features.pipelineStarts.outcome.skippedCondition'),
    tone: 'warn',
  },
  skipped_missed: {
    label: () => t('features.pipelineStarts.outcome.skippedMissed'),
    tone: 'warn',
  },
  skipped_no_version: {
    label: () => t('features.pipelineStarts.outcome.skippedNoVersion'),
    tone: 'warn',
  },
  input_unresolved: {
    label: () => t('features.pipelineStarts.outcome.inputUnresolved'),
    tone: 'warn',
  },
  start_failed: {
    label: () => t('features.pipelineStarts.outcome.startFailed'),
    tone: 'bad',
  },
}

const sourceLabel = (source: PipelineScheduleActivityWire['source']): string =>
  source === 'webhook'
    ? t('features.pipelineStarts.heard.webhook')
    : source === 'event'
      ? t('features.pipelineStarts.heard.event')
      : t('features.pipelineStarts.heard.schedule')

/** Everything the starts heard in the last 7 days and what each one did. */
export function HeardEvents({
  rows,
  pipelineId,
  numbers,
}: {
  rows: PipelineScheduleActivityWire[]
  pipelineId: string
  numbers: Map<string, number> | undefined
}) {
  const columns = useMemo<RegistryColumn<PipelineScheduleActivityWire>[]>(
    () => [
      {
        id: 'when',
        header: t('features.pipelineStarts.heard.when'),
        accessorFn: (row) => row.occurred_at,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="num">
            {formatNotebookDateTime(row.original.occurred_at, { zone: true })}
          </span>
        ),
      },
      {
        id: 'what',
        header: t('features.pipelineStarts.heard.what'),
        accessorFn: (row) => row.label ?? row.message,
        cell: ({ row }) => {
          const joined = Number(row.original.detail.joined ?? 0)

          return (
            <span>
              {row.original.label ?? row.original.message}
              {joined > 0 ? (
                <span className="ml-1.5 text-caption text-fg-muted">
                  {t('features.pipelineStarts.heard.joined', { count: joined })}
                </span>
              ) : null}
            </span>
          )
        },
      },
      {
        id: 'source',
        header: t('features.pipelineStarts.heard.source'),
        accessorFn: (row) => sourceLabel(row.source),
      },
      {
        id: 'outcome',
        header: t('features.pipelineStarts.heard.outcome'),
        accessorFn: (row) => OUTCOMES[row.kind].label(),
        cell: ({ row }) => {
          const outcome = OUTCOMES[row.original.kind]

          return <Status tone={outcome.tone}>{outcome.label()}</Status>
        },
      },
      {
        id: 'run',
        header: t('features.pipelineStarts.heard.run'),
        accessorFn: (row) => row.run_id ?? '',
        cell: ({ row }) =>
          row.original.run_id ? (
            <Link
              to="/pipelines/$pipelineId/runs/$runId"
              params={{ pipelineId, runId: row.original.run_id }}
              className="text-accent hover:underline"
            >
              {numbers?.has(row.original.run_id)
                ? `#${numbers.get(row.original.run_id)}`
                : t('features.pipelineStarts.heard.run')}
            </Link>
          ) : null,
      },
    ],
    [pipelineId, numbers],
  )

  return (
    <Section
      title={t('features.pipelineStarts.heard.title')}
      count={rows.length}
    >
      {rows.length === 0 ? (
        <Muted>{t('features.pipelineStarts.heard.none')}</Muted>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('features.pipelineStarts.heard.title')}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={false}
          />
        </TableBox>
      )}
    </Section>
  )
}
