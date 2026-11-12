import { Link } from '@tanstack/react-router'
import { z } from 'zod'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { BoardButton, BoardStatus } from '#/features/pipelines/board/board'
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

import './starts-board.css'
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
  return <dl className="mf num">{children}</dl>
}

const Fact = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
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
    <div>
      <h3 className="mh">
        {manifest ? (
          <>
            <Icon name="check" size={12} />
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
            <>
              {version} ·{' '}
              <span className="mono" style={{ fontSize: 11 }}>
                {manifest.digest.slice(0, 4)}…{manifest.digest.slice(-3)}
              </span>
            </>
          </Fact>
          <Fact label={t('features.pipelineStarts.selected.chain')}>
            {t('features.pipelineStarts.selected.chained', {
              number: manifest.sequence,
            })}
          </Fact>
        </Facts>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
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
    <BoardButton
      size="sm"
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
    </BoardButton>
  )
}

function ReproduceButton({ runId }: { runId: string }) {
  const reproduce = useReproduceRun(runId)

  return (
    <>
      <BoardButton
        size="sm"
        icon="play"
        disabled={reproduce.isPending}
        onClick={() => reproduce.mutate()}
      >
        {t('features.pipelineStarts.selected.reproduce')}
      </BoardButton>
      <div className="muted" style={{ fontSize: 11, lineHeight: '16px' }}>
        {t('features.pipelineStarts.selected.reproduceHint')}
      </div>
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
    <section className="rp" aria-label={heading}>
      <div className="rp-grid">
        <div>
          <div className="rp-head">
            <h2 className="sh">{heading}</h2>
            <BoardStatus tone={status.tone}>
              {waiting && asked.length > 0
                ? t('features.pipelineStarts.selected.waitingFor', {
                    people: asked.join(', '),
                  })
                : status.label}
            </BoardStatus>
          </div>
          <RunFacts run={run} version={version} heard={heard} prompt={prompt} />
        </div>

        <ManifestPanel
          manifest={manifest.data}
          version={version}
          pinned={Object.keys(run.input_versions).length}
        />

        <div className="rp-actions">
          <Link
            to="/pipelines/$pipelineId/runs/$runId"
            params={{ pipelineId, runId: run.id }}
            className="btn btn-s"
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
      </div>
    </section>
  )
}
