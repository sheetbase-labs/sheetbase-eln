/**
 * Settings > AI > Checks: run a fixed set of everyday tasks against a small
 * practice lab and see which pass. Without a model the tools are checked; with
 * a connected model it also checks what the model picks and proposes.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Muted, Section } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import { aiEvalKeys, EVAL_AREA_LABEL } from '#/lib/ai-eval-tasks'
import type {
  AiEvalResultRow,
  AiEvalRunRow,
  EvalStatus,
} from '#/lib/ai-eval-tasks'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'

const client = notebookDataClient

const TONE: Record<EvalStatus, Tone> = {
  passed: 'ok',
  failed: 'bad',
  skipped: 'draft',
}

const STATUS_LABEL: Record<EvalStatus, string> = {
  passed: t('agents.checks.statusPassed'),
  failed: t('agents.checks.statusFailed'),
  skipped: t('agents.checks.statusSkipped'),
}

async function startRun(toolsOnly: boolean): Promise<AiEvalRunRow> {
  const response = await fetch('/api/ai/evals', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolsOnly }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string
    } | null

    throw new Error(body?.message ?? t('agents.checks.couldNotRun'))
  }

  return (await response.json()) as AiEvalRunRow
}

export function AiChecksPanel({
  workspaceId,
  canManage,
  aiOn,
}: {
  workspaceId: string
  canManage: boolean
  aiOn: boolean
}) {
  const queryClient = useQueryClient()

  const runs = useQuery({
    queryKey: aiEvalKeys.runs,
    queryFn: () =>
      client.list<AiEvalRunRow>(
        'ai_eval_runs',
        '?select=*&order=finished_at.desc&limit=20',
      ),
    enabled: Boolean(workspaceId),
  })

  const [open, setOpen] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: startRun,
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: aiEvalKeys.runs })
      setOpen(row.id)
      toast(
        t('agents.checks.started', { passed: row.passed, total: row.total }),
      )
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : t('agents.checks.couldNotRun'),
      ),
  })

  return (
    <Section
      title={t('agents.checks.title')}
      action={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            {aiOn ? (
              <Button disabled={run.isPending} onClick={() => run.mutate(true)}>
                {t('agents.checks.runTools')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate(false)}
            >
              {run.isPending
                ? t('agents.checks.running')
                : t('agents.checks.run')}
            </Button>
          </div>
        ) : null
      }
    >
      <Muted>{t('agents.checks.intro')}</Muted>
      {!canManage ? <Notice>{t('agents.checks.viewOnly')}</Notice> : null}
      {runs.error ? (
        <Notice tone="bad">{t('agents.checks.loadError')}</Notice>
      ) : runs.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (runs.data ?? []).length === 0 ? (
        <Muted>{t('agents.checks.none')}</Muted>
      ) : (
        <TableBox>
          <Table caption={t('agents.checks.historyLabel')}>
            <TableHeader>
              <tr>
                <TableHead>{t('agents.checks.when')}</TableHead>
                <TableHead>{t('agents.checks.mode')}</TableHead>
                <TableHead>{t('agents.checks.result')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('agents.checks.detail')}</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {(runs.data ?? []).flatMap((row) => {
                const expanded = open === row.id

                return [
                  <TableRow key={row.id}>
                    <TableCell className="text-fg-muted">
                      {formatDate(row.finished_at, { time: true })}
                    </TableCell>
                    <TableCell>
                      {row.mode === 'model'
                        ? t('agents.checks.modeModel')
                        : t('agents.checks.modeTools')}
                      <span className="text-fg-muted">
                        {' · '}
                        {row.trigger === 'profile_change'
                          ? t('agents.checks.afterChange')
                          : t('agents.checks.manual')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Status tone={TONE[row.status]}>
                        {t('agents.checks.passedCount', {
                          passed: row.passed,
                          total: row.total,
                        })}
                        {row.skipped > 0
                          ? ` · ${t('agents.checks.skippedCount', { count: row.skipped })}`
                          : ''}
                      </Status>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                      >
                        {expanded
                          ? t('agents.checks.hide')
                          : t('agents.checks.detail')}
                      </Button>
                    </TableCell>
                  </TableRow>,
                  expanded ? (
                    <TableRow key={`${row.id}-results`}>
                      <TableCell colSpan={4}>
                        <RunResults runId={row.id} message={row.message} />
                      </TableCell>
                    </TableRow>
                  ) : null,
                ]
              })}
            </TableBody>
          </Table>
        </TableBox>
      )}
    </Section>
  )
}

function RunResults({
  runId,
  message,
}: {
  runId: string
  message: string | null
}) {
  const results = useQuery({
    queryKey: aiEvalKeys.results(runId),
    queryFn: () =>
      client.list<AiEvalResultRow>(
        'ai_eval_results',
        `?select=*&run_id=eq.${encodeURIComponent(runId)}&order=area.asc,title.asc`,
      ),
  })

  if (results.isLoading) return <Skeleton className="h-16 w-full" />

  return (
    <div className="flex flex-col gap-2">
      {message ? <Muted>{message}</Muted> : null}
      <TableBox>
        <Table caption={t('agents.checks.resultsLabel')}>
          <TableHeader>
            <tr>
              <TableHead>{t('agents.checks.task')}</TableHead>
              <TableHead>{t('agents.checks.result')}</TableHead>
              <TableHead>{t('agents.checks.expected')}</TableHead>
              <TableHead>{t('agents.checks.actual')}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {(results.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="font-medium text-fg">{row.title}</span>
                  <span className="text-fg-muted">
                    {' · '}
                    {EVAL_AREA_LABEL[row.area]}
                  </span>
                </TableCell>
                <TableCell>
                  <Status tone={TONE[row.status]}>
                    {STATUS_LABEL[row.status]}
                  </Status>
                </TableCell>
                <TableCell className="text-fg-muted">
                  <span className="block max-w-[24rem] truncate">
                    {row.expected ?? ''}
                  </span>
                </TableCell>
                <TableCell className="text-fg-muted">
                  <span className="block max-w-[24rem] truncate">
                    {row.actual ?? row.detail ?? ''}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
    </div>
  )
}
