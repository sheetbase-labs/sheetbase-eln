import { Link } from '@tanstack/react-router'

import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import {
  useDefinitionRuns,
  usePipelineVersions,
} from '#/components/pipelines/pipelines-data'
import { words } from '#/lib/pipelines/simple/words'
import { formatDate, formatTime } from '#/lib/format-date'

const l = words('runs')

/** The newest runs of the pipeline, and which version new runs use. */
export function LastRuns({
  pipelineId,
  published,
  draft,
}: {
  pipelineId: string
  published: number | null
  draft: number | null
}) {
  const versions = usePipelineVersions(pipelineId)
  const runs = useDefinitionRuns(versions.data ?? [])
  const latest = (runs.data ?? []).slice(0, 4)

  return (
    <section aria-labelledby="simple-runs" className="flex flex-col gap-2">
      <h2 id="simple-runs" className="m-0 font-sans text-body font-semibold">
        {l('title')}
      </h2>
      {latest.length === 0 ? <Muted>{l('none')}</Muted> : null}
      <div className="flex flex-col gap-1.5 text-caption">
        {latest.map((run) => (
          <Link
            key={run.id}
            to="/pipelines/$pipelineId/runs/$runId"
            params={{ pipelineId, runId: run.id }}
            className="flex items-center gap-2 text-fg no-underline"
          >
            <Status
              tone={
                run.status === 'succeeded'
                  ? 'ok'
                  : run.status === 'failed'
                    ? 'bad'
                    : 'progress'
              }
            >
              {run.status}
            </Status>
            <span className="ml-auto whitespace-nowrap text-fg-muted">
              {formatDate(run.created_at)} {formatTime(run.created_at)}
            </span>
          </Link>
        ))}
      </div>
      {published !== null && draft !== null ? (
        <Muted>{l('approval', { published })}</Muted>
      ) : published !== null ? (
        <Muted>{l('publishedUse', { published })}</Muted>
      ) : null}
    </section>
  )
}
