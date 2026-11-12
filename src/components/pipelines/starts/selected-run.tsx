import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  runDuration,
  runStatus,
  useRunPrompts,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { useReproduceRun } from '#/components/pipelines/run-reproduction'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import { z } from 'zod'

import { useRemindRun, useRunManifest } from './starts-data'

function becauseOf(run: PipelineRunWire): string {
  if (run.retry_of_run_id) return t('features.pipelineStarts.selected.byRetry')

  if (run.trigger_kind === 'event')
    return t('features.pipelineStarts.selected.byEvent')

  if (run.trigger_kind === 'scheduled')
    return t('features.pipelineStarts.selected.byScheduled')

  return t('features.pipelineStarts.selected.byManual')
}

const formTitle = z.object({ title: z.string() })

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-1.5 text-body">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  )
}

/** One run picked from the week: why it started, what it waits at, when that
 * expires, the manifest it kept, a reminder for the people it asked, and a
 * way to reproduce it. */
export function SelectedRun({
  run,
  number,
  pipelineId,
  workspaceId,
}: {
  run: PipelineRunWire
  number: number | undefined
  pipelineId: string
  workspaceId: string
}) {
  const status = runStatus(run.status)
  const prompts = useRunPrompts(run.id)
  const members = useWorkspaceMemberNames()
  const manifest = useRunManifest(run.id)
  const remind = useRemindRun(workspaceId)
  const reproduce = useReproduceRun(run.id)
  const waiting = run.status === 'waiting'
  const prompt = (prompts.data ?? []).find((p) => p.answered_at === null)
  const title = prompt ? formTitle.safeParse(prompt.form_schema) : null

  const asked = prompt
    ? prompt.asked_user_ids.map((id) => members.data?.[id] ?? id)
    : []

  return (
    <section
      aria-label={t('features.pipelineStarts.selected.title', {
        number: number ?? 0,
      })}
      className="rounded-md border border-line bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-label font-medium text-fg">
          {t('features.pipelineStarts.selected.title', { number: number ?? 0 })}
        </h3>
        <Status tone={status.tone}>{status.label}</Status>
        <Link
          to="/pipelines/$pipelineId/runs/$runId"
          params={{ pipelineId, runId: run.id }}
          className="ml-auto text-caption text-accent hover:underline"
        >
          {t('features.pipelineStarts.selected.open')}
        </Link>
      </div>
      <dl className="m-0 mt-1 divide-y divide-line">
        <Row label={t('features.pipelineStarts.selected.because')}>
          {becauseOf(run)}
        </Row>
        <Row label={t('features.pipelineStarts.selected.started')}>
          <span className="num">
            {formatNotebookDateTime(run.started_at, { zone: true })}
          </span>
          {run.finished_at ? (
            <span className="ml-2 text-fg-muted">
              {t('features.pipelineStarts.selected.took')} {runDuration(run)}
            </span>
          ) : null}
        </Row>
        {waiting ? (
          <>
            <Row label={t('features.pipelineStarts.selected.waitingAt')}>
              {title?.success
                ? title.data.title
                : t('features.pipelineStarts.selected.stepUnknown')}
              {asked.length > 0 ? (
                <span className="block text-caption text-fg-muted">
                  {asked.join(', ')}
                </span>
              ) : null}
            </Row>
            <Row label={t('features.pipelineStarts.selected.expires')}>
              {prompt?.expires_at ? (
                <span className="num">
                  {formatNotebookDateTime(prompt.expires_at, { zone: true })}
                </span>
              ) : (
                <span className="text-fg-muted">
                  {t('features.pipelineStarts.selected.noExpiry')}
                </span>
              )}
            </Row>
          </>
        ) : null}
        <Row label={t('features.pipelineStarts.selected.manifest')}>
          {manifest.data ? (
            <span className="num break-all text-caption">
              {manifest.data.digest.slice(0, 16)}…
            </span>
          ) : (
            <Muted>{t('features.pipelineStarts.selected.manifestNone')}</Muted>
          )}
        </Row>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {waiting ? (
          <Button
            size="sm"
            disabled={remind.isPending}
            onClick={() =>
              remind.mutate(run.id, {
                onSuccess: (count) =>
                  toast(
                    count > 0
                      ? t('features.pipelineStarts.selected.reminded', {
                          count,
                        })
                      : t('features.pipelineStarts.selected.nobodyToRemind'),
                  ),
                onError: () =>
                  toast(t('features.pipelineStarts.selected.remindFailed')),
              })
            }
          >
            {t('features.pipelineStarts.selected.remind')}
          </Button>
        ) : null}
        {manifest.data ? (
          <Button
            size="sm"
            disabled={reproduce.isPending}
            title={t('features.pipelineStarts.selected.reproduceHint')}
            onClick={() => reproduce.mutate()}
          >
            {t('features.pipelineStarts.selected.reproduce')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
