/**
 * Webhook, live feed and pipeline events for remote jobs and the lakehouse SQL
 * switch. A remote job is a row of `pipeline_remote_jobs`: it is created when
 * the run sends it, and its `state` says how it ended.
 */
import { WEBHOOK_SSE_PIPELINE } from '../define'
import type { EventCatalogueEntry } from '#/lib/event-catalogue'

const job = (
  name: string,
  summary: string,
  producer: EventCatalogueEntry['producer'],
  notes: string,
): EventCatalogueEntry => ({
  name,
  family: 'pipeline',
  summary,
  producer,
  wireName: name,
  status: 'stable',
  introducedIn: 'pipelines-h',
  consumers: WEBHOOK_SSE_PIPELINE,
  notes,
})

export const PIPELINE_REMOTE_EVENTS: readonly EventCatalogueEntry[] =
  Object.freeze([
    job(
      'pipeline.remote_job.submitted',
      'A pipeline run sent a job to an HPC queue.',
      { entityType: 'pipeline_remote_job', operation: 'create' },
      'Payload is the job row: runId, stepName, connectionKey, queue, limitMinutes and deadlineAt. Read it on pipeline_remote_jobs.',
    ),
    job(
      'pipeline.remote_job.succeeded',
      'A job on an HPC queue finished and gave its table back.',
      {
        entityType: 'pipeline_remote_job',
        operation: 'update',
        when: { key: 'state', equals: 'succeeded' },
      },
      'The run carries on from the step after it. `resultRows` is how many rows came back.',
    ),
    job(
      'pipeline.remote_job.failed',
      'A job on an HPC queue failed, ran out of time or was cancelled.',
      {
        entityType: 'pipeline_remote_job',
        operation: 'update',
        when: { key: 'state', notEquals: 'succeeded' },
      },
      '`state` is failed or cancelled, and `reason` says why: job_failed, timed_out, no_result, cancelled or submit_failed. The run fails with the same reason.',
    ),
    {
      name: 'pipeline.lakehouse_sql.updated',
      family: 'administration',
      summary:
        'Pipelines were allowed, or no longer allowed, to read open tables with SQL.',
      producer: {
        entityType: 'lake_table',
        operation: 'update',
        when: { key: 'action', equals: 'pipeline-lakehouse-sql' },
      },
      wireName: 'pipeline.lakehouse_sql.updated',
      status: 'stable',
      introducedIn: 'pipelines-h',
      consumers: { webhook: true, sse: true, pipeline: false },
      notes: '`enabled` is true when lakehouse SQL steps may run.',
    },
  ])

/** What the event pickers call each event. */
export const PIPELINE_REMOTE_EVENT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    'pipeline.remote_job.submitted': 'A job is sent to the cluster',
    'pipeline.remote_job.succeeded': 'A cluster job finishes',
    'pipeline.remote_job.failed': 'A cluster job fails',
    'pipeline.lakehouse_sql.updated': 'Lakehouse SQL is switched',
  })
