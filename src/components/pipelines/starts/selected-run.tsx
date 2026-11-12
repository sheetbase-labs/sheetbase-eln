import { Link } from '@tanstack/react-router'
import { z } from 'zod'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button, buttonVariants } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  runStatus,
  useRunPrompts,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { useReproduceRun } from '#/components/pipelines/run-reproduction'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type {
  PipelineRunPromptWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

import { useRemindRun, useRunManifest } from './starts-data'
import type { RunManifestInfo } from './starts-data'

function becauseOf(run: PipelineRunWire, heard: string | null): string {
  if (run.retry_of_run_id) return t('features.pipelineStarts.selected.byRetry')

  if (run.trigger_kind === 'event')
    return heard ?? t('features.pipelineStarts.selected.byEvent')

  if (run.trigger_kind === 'scheduled')
    return t('features.pipelineStarts.selected.byScheduled')

  return t('features.pipelineStarts.selected.byManual')
}

const formTitle = z.object({ title: z.string() })

function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[82px_minmax(0,1fr)] gap-x-2 gap-y-[5px] text-caption">
      {children}
    </dl>
  )
}

const Fact = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <>
    <dt className="text-fg-muted">{label}</dt>
    <dd className="m-0 min-w-0">{children}</dd>
  </>
)

function RunFacts({
  run,
  version,
  heard,
  prompt,
}: {
  run: PipelineRunWire
  version: string
  heard: string | null
  prompt: PipelineRunPromptWire | undefined
}) {
  const waiting = run.status === 'waiting'
  const title = prompt ? formTitle.safeParse(prompt.form_schema) : null

  return (
    <Facts>
      <Fact label={t('features.pipelineStarts.selected.started')}>
        <span className="num">
          {formatNotebookDateTime(run.started_at, { zone: true })} · {version}
        </span>
      </Fact>
      <Fact label={t('features.pipelineStarts.selected.because')}>
        {becauseOf(run, heard)}
      </Fact>
      {waiting ? (
        <>
          <Fact label={t('features.pipelineStarts.selected.waitingAt')}>
            {title?.success
              ? title.data.title
              : t('features.pipelineStarts.selected.stepUnknown')}
          </Fact>
          <Fact label={t('features.pipelineStarts.selected.expires')}>
            {prompt?.expires_at ? (
              <span className="num">
                {formatNotebookDateTime(prompt.expires_at, { zone: true })},{' '}
                {t('features.pipelineStarts.selected.afterwards')}
              </span>
            ) : (
              t('features.pipelineStarts.selected.noExpiry')
            )}
          </Fact>
        </>
      ) : null}
    </Facts>
  )
}

function ManifestPanel({
  manifest,
  version,
  pinned,
}: {
  manifest: RunManifestInfo | null | undefined
  version: string
  pinned: number
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-body font-semibold">
        {manifest ? (
          <>
            <Icon name="check" size={14} />
            {manifest.signed
              ? t('features.pipelineStarts.selected.manifestSigned')
              : t('features.pipelineStarts.selected.manifestKept')}
          </>
        ) : (
          t('features.pipelineStarts.selected.manifestNone')
        )}
      </h3>
      {manifest ? (
        <Facts>
          <Fact label={t('features.pipelineStarts.selected.inputs')}>
            {t('features.pipelineStarts.selected.inputsPinned', {
              count: pinned,
            })}
          </Fact>
          <Fact label={t('features.pipelineStarts.selected.version')}>
            <span className="num">
              {version} · {manifest.digest.slice(0, 4)}…
              {manifest.digest.slice(-3)}
            </span>
          </Fact>
          <Fact label={t('features.pipelineStarts.selected.chain')}>
            {t('features.pipelineStarts.selected.chained', {
              number: manifest.sequence,
            })}
          </Fact>
        </Facts>
      ) : (
        <span className="text-caption text-fg-muted">
          {t('features.pipelineStarts.selected.manifestNoneHint')}
        </span>
      )}
    </div>
  )
}

function RemindButton({
  runId,
  workspaceId,
  asked,
}: {
  runId: string
  workspaceId: string
  asked: string[]
}) {
  const remind = useRemindRun(workspaceId)

  return (
    <Button
      icon="bell"
      disabled={remind.isPending}
      onClick={() =>
        remind.mutate(runId, {
          onSuccess: (count) =>
            toast(
              count > 0
                ? t('features.pipelineStarts.selected.reminded', { count })
                : t('features.pipelineStarts.selected.nobodyToRemind'),
            ),
          onError: () =>
            toast(t('features.pipelineStarts.selected.remindFailed')),
        })
      }
    >
      {asked.length === 1
        ? t('features.pipelineStarts.selected.remind', { person: asked[0] })
        : t('features.pipelineStarts.selected.remindThem')}
    </Button>
  )
}

function ReproduceButton({ runId }: { runId: string }) {
  const reproduce = useReproduceRun(runId)

  return (
    <>
      <Button
        icon="play"
        disabled={reproduce.isPending}
        onClick={() => reproduce.mutate()}
      >
        {t('features.pipelineStarts.selected.reproduce')}
      </Button>
      <span className="max-w-[190px] text-[11px] text-fg-muted max-lg:max-w-none">
        {t('features.pipelineStarts.selected.reproduceHint')}
      </span>
    </>
  )
}

/** One run picked from the week: why it started, what it waits at, when that
 * expires, the manifest it kept, a reminder for the people it asked, and a
 * way to reproduce it. */
export function SelectedRun({
  run,
  number,
  version,
  heard,
  pipelineId,
  workspaceId,
}: {
  run: PipelineRunWire
  number: number | undefined
  /** `v4`, the version the run used. */
  version: string
  /** What the start heard that began it, when it was a snapshot. */
  heard: string | null
  pipelineId: string
  workspaceId: string
}) {
  const status = runStatus(run.status)
  const prompts = useRunPrompts(run.id)
  const members = useWorkspaceMemberNames()
  const manifest = useRunManifest(run.id)
  const waiting = run.status === 'waiting'
  const prompt = (prompts.data ?? []).find((p) => p.answered_at === null)

  const asked = prompt
    ? prompt.asked_user_ids.map((id) => members.data?.[id] ?? id)
    : []

  const heading = t('features.pipelineStarts.selected.title', {
    number: number ?? 0,
  })

  return (
    <section
      aria-label={heading}
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-6 gap-y-3 rounded-lg border border-border px-3.5 py-3 max-lg:grid-cols-1"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2">
          <h3 className="text-section">{heading}</h3>
          <Status tone={status.tone}>
            {waiting && asked.length > 0
              ? t('features.pipelineStarts.selected.waitingFor', {
                  people: asked.join(', '),
                })
              : status.label}
          </Status>
        </div>
        <RunFacts run={run} version={version} heard={heard} prompt={prompt} />
      </div>

      <ManifestPanel
        manifest={manifest.data}
        version={version}
        pinned={Object.keys(run.input_versions).length}
      />

      <div className="flex min-w-0 flex-col items-start gap-1.5 max-lg:flex-row max-lg:flex-wrap">
        <Link
          to="/pipelines/$pipelineId/runs/$runId"
          params={{ pipelineId, runId: run.id }}
          className={buttonVariants()}
        >
          {t('features.pipelineStarts.selected.open')}
        </Link>
        {waiting ? (
          <RemindButton
            runId={run.id}
            workspaceId={workspaceId}
            asked={asked}
          />
        ) : null}
        {manifest.data ? <ReproduceButton runId={run.id} /> : null}
      </div>
    </section>
  )
}
