import { useMemo } from 'react'

import { t } from '#/copy'
import { RegistryGrid } from '#/components/inventory/registry-grid'
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
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { previewStarts } from '#/lib/pipelines/starts-view'
import type { PreviewRow } from '#/lib/pipelines/starts-view'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { useStartEvents } from './starts-data'

interface PreviewOutcome {
  tone: 'ok' | 'stored' | 'warn'
  label: string
}

function outcomeOf(row: PreviewRow): PreviewOutcome {
  if (row.outcome === 'start')
    return { tone: 'ok', label: t('features.pipelineStarts.test.wouldStart') }

  if (row.outcome === 'batched')
    return {
      tone: 'stored',
      label: t('features.pipelineStarts.test.wouldBatch'),
    }

  return {
    tone: 'warn',
    label:
      row.reason === 'rows'
        ? t('features.pipelineStarts.test.wouldSkipRows')
        : t('features.pipelineStarts.test.wouldSkipWindow'),
  }
}

/** The draft rules held up against the last 7 days: every schedule tick and
 * snapshot, and what the rules would have done with each. Starts nothing. */
export function TestStartsDialog({
  rules,
  schedules,
  workspaceId,
  pipelineId,
  now,
  onClose,
}: {
  rules: StartRules
  schedules: PipelineScheduleWire[]
  workspaceId: string
  pipelineId: string
  now: Date
  onClose: () => void
}) {
  const events = useStartEvents(workspaceId, pipelineId, true)

  const result = useMemo(
    () =>
      events.data
        ? previewStarts({ schedules, events: events.data, rules, now, days: 7 })
        : null,
    [events.data, schedules, rules, now],
  )

  const columns = useMemo<RegistryColumn<PreviewRow>[]>(
    () => [
      {
        id: 'when',
        header: t('features.pipelineStarts.heard.when'),
        accessorFn: (row) => row.at.toISOString(),
        enableHiding: false,
        cell: ({ row }) => (
          <span className="num">
            {formatNotebookDateTime(row.original.at.toISOString(), {
              zone: true,
            })}
          </span>
        ),
      },
      {
        id: 'what',
        header: t('features.pipelineStarts.heard.what'),
        accessorFn: (row) =>
          row.label ?? t('features.pipelineStarts.test.schedule'),
        cell: ({ row }) => (
          <span>
            {row.original.label ?? t('features.pipelineStarts.test.schedule')}
            {row.original.joined > 0 ? (
              <span className="ml-1.5 text-caption text-fg-muted">
                {t('features.pipelineStarts.heard.joined', {
                  count: row.original.joined,
                })}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'outcome',
        header: t('features.pipelineStarts.heard.outcome'),
        accessorFn: (row) => outcomeOf(row).label,
        cell: ({ row }) => {
          const outcome = outcomeOf(row.original)

          return <Status tone={outcome.tone}>{outcome.label}</Status>
        },
      },
    ],
    [],
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader
          title={t('features.pipelineStarts.test.title')}
          description={t('features.pipelineStarts.test.description')}
        />
        <DialogBody>
          {events.isLoading || !result ? (
            <Muted>{t('features.pipelineStarts.test.loading')}</Muted>
          ) : result.rows.length === 0 ? (
            <Muted>{t('features.pipelineStarts.test.none')}</Muted>
          ) : (
            <>
              <p className="m-0 text-body" data-testid="test-summary">
                {[
                  t('features.pipelineStarts.test.summary', {
                    count: result.wouldStart,
                  }),
                  t('features.pipelineStarts.test.skipped', {
                    count: result.wouldSkip,
                  }),
                  result.batched > 0
                    ? t('features.pipelineStarts.test.batched', {
                        count: result.batched,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
              <TableBox>
                <RegistryGrid
                  label={t('features.pipelineStarts.test.title')}
                  rows={result.rows}
                  columns={columns}
                  getRowId={(row) =>
                    `${row.at.toISOString()}-${row.label ?? ''}`
                  }
                  selectable={false}
                />
              </TableBox>
              <Muted>{t('features.pipelineStarts.test.caveat')}</Muted>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('features.pipelineStarts.test.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
