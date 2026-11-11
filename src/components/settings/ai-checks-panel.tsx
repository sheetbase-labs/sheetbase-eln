/**
 * Settings > AI > Checks: run a fixed set of everyday tasks against a small
 * practice lab and see which pass. Without a model the tools are checked; with
 * a connected model it also checks what the model picks and proposes.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Muted, Section } from '#/components/ui/layout'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
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

const runSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  mode: z.enum(['tools', 'model']),
  trigger: z.enum(['manual', 'profile_change']),
  provider_profile: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['passed', 'failed', 'skipped']),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  score: z.union([z.number(), z.string()]).nullable(),
  message: z.string().nullable(),
  started_by_user_id: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string(),
}) satisfies z.ZodType<AiEvalRunRow>

async function startRun(toolsOnly: boolean): Promise<AiEvalRunRow> {
  const response = await fetch('/api/ai/evals', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolsOnly }),
  })

  if (!response.ok) {
    const body = z
      .object({ message: z.string().optional() })
      .safeParse(await response.json().catch(() => null)).data

    throw new Error(body?.message ?? t('agents.checks.couldNotRun'))
  }

  return runSchema.parse(await response.json())
}

/** The history table's columns: when, how, the result, and the detail toggle. */
function runColumnsFor(
  open: string | null,
  setOpen: (id: string | null) => void,
): RegistryColumn<AiEvalRunRow>[] {
  return [
    {
      id: 'when',
      header: t('agents.checks.when'),
      accessorFn: (row) => row.finished_at,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.finished_at, { time: true })}
        </span>
      ),
    },
    {
      id: 'mode',
      header: t('agents.checks.mode'),
      accessorFn: (row) => row.mode,
      cell: ({ row }) => (
        <>
          {row.original.mode === 'model'
            ? t('agents.checks.modeModel')
            : t('agents.checks.modeTools')}
          <span className="text-fg-muted">
            {' · '}
            {row.original.trigger === 'profile_change'
              ? t('agents.checks.afterChange')
              : t('agents.checks.manual')}
          </span>
        </>
      ),
    },
    {
      id: 'result',
      header: t('agents.checks.result'),
      accessorFn: (row) => row.passed,
      cell: ({ row }) => (
        <Status tone={TONE[row.original.status]}>
          {t('agents.checks.passedCount', {
            passed: row.original.passed,
            total: row.original.total,
          })}
          {row.original.skipped > 0
            ? ` · ${t('agents.checks.skippedCount', { count: row.original.skipped })}`
            : ''}
        </Status>
      ),
    },
    {
      id: 'detail',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => {
        const expanded = open === row.original.id

        return (
          <Button
            size="sm"
            aria-expanded={expanded}
            onClick={() => setOpen(expanded ? null : row.original.id)}
          >
            {expanded ? t('agents.checks.hide') : t('agents.checks.detail')}
          </Button>
        )
      },
    },
  ]
}

/** Run the tools alone, or the tools and the connected model. */
function RunButtons({
  aiOn,
  pending,
  onRun,
}: {
  aiOn: boolean
  pending: boolean
  onRun: (toolsOnly: boolean) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {aiOn ? (
        <Button disabled={pending} onClick={() => onRun(true)}>
          {t('agents.checks.runTools')}
        </Button>
      ) : null}
      <Button variant="primary" disabled={pending} onClick={() => onRun(false)}>
        {pending ? t('agents.checks.running') : t('agents.checks.run')}
      </Button>
    </div>
  )
}

/** Earlier runs, with the chosen run's results below. */
function RunHistory({
  runs,
  open,
  onToggle,
}: {
  runs: UseQueryResult<AiEvalRunRow[]>
  open: string | null
  onToggle: (id: string | null) => void
}) {
  const list = runs.data ?? []
  const openRun = list.find((row) => row.id === open)

  if (runs.error)
    return <Notice tone="bad">{t('agents.checks.loadError')}</Notice>

  if (runs.isLoading) return <Skeleton className="h-24 w-full" />

  if (list.length === 0) return <Muted>{t('agents.checks.none')}</Muted>

  return (
    <>
      <TableBox>
        <RegistryGrid
          label={t('agents.checks.historyLabel')}
          rows={list}
          columns={runColumnsFor(open, onToggle)}
          getRowId={(row) => row.id}
          selectable={false}
        />
      </TableBox>
      {openRun ? (
        <RunResults runId={openRun.id} message={openRun.message} />
      ) : null}
    </>
  )
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
          <RunButtons aiOn={aiOn} pending={run.isPending} onRun={run.mutate} />
        ) : null
      }
    >
      <Muted>{t('agents.checks.intro')}</Muted>
      {!canManage ? <Notice>{t('agents.checks.viewOnly')}</Notice> : null}
      <RunHistory runs={runs} open={open} onToggle={setOpen} />
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

  const resultColumns: RegistryColumn<AiEvalResultRow>[] = [
    {
      id: 'task',
      header: t('agents.checks.task'),
      accessorFn: (row) => row.title,
      cell: ({ row }) => (
        <>
          <span className="font-medium text-fg">{row.original.title}</span>
          <span className="text-fg-muted">
            {' · '}
            {EVAL_AREA_LABEL[row.original.area]}
          </span>
        </>
      ),
    },
    {
      id: 'result',
      header: t('agents.checks.result'),
      accessorFn: (row) => STATUS_LABEL[row.status],
      cell: ({ row }) => (
        <Status tone={TONE[row.original.status]}>
          {STATUS_LABEL[row.original.status]}
        </Status>
      ),
    },
    {
      id: 'expected',
      header: t('agents.checks.expected'),
      accessorFn: (row) => row.expected ?? '',
      cell: ({ row }) => (
        <span className="block max-w-[24rem] truncate text-fg-muted">
          {row.original.expected ?? ''}
        </span>
      ),
    },
    {
      id: 'actual',
      header: t('agents.checks.actual'),
      accessorFn: (row) => row.actual ?? row.detail ?? '',
      cell: ({ row }) => (
        <span className="block max-w-[24rem] truncate text-fg-muted">
          {row.original.actual ?? row.original.detail ?? ''}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      {message ? <Muted>{message}</Muted> : null}
      <TableBox>
        <RegistryGrid
          label={t('agents.checks.resultsLabel')}
          rows={results.data ?? []}
          columns={resultColumns}
          getRowId={(row) => row.id}
          selectable={false}
        />
      </TableBox>
    </div>
  )
}
