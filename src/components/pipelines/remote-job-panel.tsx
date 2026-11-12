import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { BoardStatus } from '#/features/pipelines/board/board'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import {
  fetchRunRemoteJobs,
  openRemoteJob,
} from '#/lib/pipelines/remote/client'
import type { RunRemoteJob } from '#/lib/pipelines/remote/client'
import { formatLimit } from '#/lib/pipelines/remote/settings'

const STATE_WORDS: Record<
  RunRemoteJob['state'],
  { tone: 'ok' | 'warn' | 'bad' | 'draft'; label: string }
> = {
  submitted: {
    tone: 'warn',
    label: t('features.pipelineRemote.runPanel.submittedState'),
  },
  running: {
    tone: 'warn',
    label: t('features.pipelineRemote.runPanel.runningState'),
  },
  succeeded: {
    tone: 'ok',
    label: t('features.pipelineRemote.runPanel.succeededState'),
  },
  failed: {
    tone: 'bad',
    label: t('features.pipelineRemote.runPanel.failedState'),
  },
  cancelled: {
    tone: 'draft',
    label: t('features.pipelineRemote.runPanel.cancelledState'),
  },
}

/** The jobs a run sent to a cluster. Polls while one is going. */
export function useRunRemoteJobs(runId: string) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'run-remote-jobs', runId],
    queryFn: () => fetchRunRemoteJobs(notebookDataClient, runId),
    refetchInterval: (query) =>
      openRemoteJob(query.state.data ?? []) ? 15_000 : false,
  })
}

/** What a run that waits for a cluster job shows where a prompt would be. */
export function RemoteJobPanel({ jobs }: { jobs: RunRemoteJob[] }) {
  const job = openRemoteJob(jobs) ?? jobs.at(-1)

  if (!job) return null
  const words = STATE_WORDS[job.state]

  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
      data-testid="remote-job-panel"
    >
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-section">
          {t('features.pipelineRemote.runPanel.title')}
        </h2>
        <BoardStatus tone={words.tone}>{words.label}</BoardStatus>
      </div>
      <p className="m-0 text-label text-fg-muted">
        {t('features.pipelineRemote.runPanel.cancelNote')}
      </p>
      <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-label">
        <dt className="text-fg-muted">
          {t('features.pipelineRemote.runPanel.queue')}
        </dt>
        <dd className="m-0 mono">
          {job.queue} · {job.connection_key}
        </dd>
        {job.external_job_id ? (
          <>
            <dt className="text-fg-muted">
              {t('features.pipelineRemote.runPanel.jobId')}
            </dt>
            <dd className="m-0 mono">{job.external_job_id}</dd>
          </>
        ) : null}
        <dt className="text-fg-muted">
          {t('features.pipelineRemote.runPanel.submitted')}
        </dt>
        <dd className="m-0">
          {formatNotebookDateTime(job.submitted_at, { zone: false })}
          {' · '}
          {formatLimit(job.limit_minutes)}
        </dd>
        <dt className="text-fg-muted">
          {t('features.pipelineRemote.runPanel.deadline')}
        </dt>
        <dd className="m-0">
          {formatNotebookDateTime(job.deadline_at, { zone: false })}
        </dd>
        {job.result_rows !== null ? (
          <>
            <dt className="text-fg-muted">
              {t('features.pipelineRemote.runPanel.rows')}
            </dt>
            <dd className="m-0 num">{job.result_rows}</dd>
          </>
        ) : null}
      </dl>
    </section>
  )
}
