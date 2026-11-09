import { randomBytes } from 'node:crypto'

import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

import {
  applySecurityHeaders,
  injectNonceIntoHtml,
} from '#/lib/security-headers'

// AUTO-02: background sweep for Pipeline schedules and event triggers.
// Started lazily by the first server request via a middleware (this module
// is also a client entry, so the server-only scheduler is imported
// dynamically and guarded per-process). The unref'd interval never keeps
// the process alive and never runs under test runners.
const pipelineSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startPipelineScheduler } =
      await import('#/lib/pipeline-scheduler.server')

    startPipelineScheduler()

    return next()
  },
)

// PIPE-EXEC: the pipeline run worker. Claims queued runs from the durable
// queue and executes them; every replica can run one. Set
// SHEETBASE_PIPELINE_WORKER=false on a replica that should only serve requests.
const pipelineWorkerMiddleware = createMiddleware().server(async ({ next }) => {
  const { startPipelineWorker } = await import('#/lib/pipeline-queue.server')
  startPipelineWorker()

  return next()
})

// WORK-03.4: email outbox + daily digest sweep.
const emailSchedulerMiddleware = createMiddleware().server(async ({ next }) => {
  const { startEmailScheduler } = await import('#/lib/email-scheduler.server')
  startEmailScheduler()

  return next()
})

// Phone alerts: Web Push sender, booking reminders and the server's push key.
const pushSchedulerMiddleware = createMiddleware().server(async ({ next }) => {
  const { startPushScheduler } = await import('#/lib/push-delivery.server')
  startPushScheduler()

  return next()
})

// Plugin notification channels: sends what the channel outbox holds (Slack and the like).
const channelSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startChannelScheduler } =
      await import('#/lib/extensions/channel-delivery.server')

    startChannelScheduler()

    return next()
  },
)

// DSET-04.2: Dataset snapshot retention sweep. Calls
// api.prune_dataset_versions on an interval with the privileged app
// connection; guarded like the pipeline scheduler and never started under
// test runners unless explicitly enabled.
const datasetRetentionSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startDatasetRetentionScheduler } =
      await import('#/lib/dataset-retention-scheduler.server')

    startDatasetRetentionScheduler()

    return next()
  },
)

// SRCH-01.3: read the text of files uploaded before their format was
// searchable. Runs once in the background after start; guarded like the
// schedulers and never started under test runners unless explicitly enabled.
const fileTextBackfillMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startFileTextBackfill } =
      await import('#/lib/file-text-backfill.server')

    startFileTextBackfill()

    return next()
  },
)

// Search by meaning: read new and changed text into vectors for workspaces
// that turned it on. Guarded like the other sweeps.
const embeddingIndexerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startEmbeddingIndexer } =
      await import('#/lib/embedding-index.server')

    startEmbeddingIndexer()

    return next()
  },
)

// LAB-02 step 1: sample hold-limit sweep. Calls
// api.sweep_sample_hold_limits on an interval with the privileged app
// connection; guarded like the pipeline/dataset schedulers and never started
// under test runners unless explicitly enabled.
const sampleHoldSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startSampleHoldScheduler } =
      await import('#/lib/sample-hold.server')

    startSampleHoldScheduler()

    return next()
  },
)

// Scheduled data-contract checks: runs the contracts whose time has come.
const contractSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startContractScheduler } =
      await import('#/lib/data-contracts/scheduler.server')

    startContractScheduler()

    return next()
  },
)

// WORK-03.2: reagent expiry sweep, the producer for the material_expiring
// notification. Writes one system change event per lot inside the warning
// window; guarded like the other schedulers and never started under test
// runners unless explicitly enabled.
const reagentExpirySchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startReagentExpiryScheduler } =
      await import('#/lib/reagent-expiry.server')

    startReagentExpiryScheduler()

    return next()
  },
)

// Repeating bookings and experiments: makes what has come due, as the person
// who set each repeat up. Guarded like the other schedulers.
const recurringWorkMiddleware = createMiddleware().server(async ({ next }) => {
  const { startRecurringWorkScheduler } =
    await import('#/lib/recurring-work.server')

  startRecurringWorkScheduler()

  return next()
})

// Out of office: starts and lifts a colleague's cover on reviews as absences
// begin and end. Guarded like the other schedulers.
const absenceCoverMiddleware = createMiddleware().server(async ({ next }) => {
  const { startAbsenceCoverScheduler } =
    await import('#/lib/absence-cover.server')

  startAbsenceCoverScheduler()

  return next()
})

// Lab watchers: scheduled reviews of the lab that leave findings in the Inbox.
// Guarded like the other schedulers.
const labWatcherMiddleware = createMiddleware().server(async ({ next }) => {
  const { startLabWatcherScheduler } =
    await import('#/lib/lab-watcher-scheduler.server')

  startLabWatcherScheduler()

  return next()
})

// Step timers: writes the bell notification for a timer that has ended, for
// people with no page open. Guarded like the other schedulers.
const stepTimerMiddleware = createMiddleware().server(async ({ next }) => {
  const { startStepTimerScheduler } = await import('#/lib/step-timers.server')
  startStepTimerScheduler()

  return next()
})

// REV-05.2: the audit trail and signature check. Verifies each workspace's
// hash chain and signed revisions once a day, so Settings and signed records
// can say when they were last found intact. Guarded like the other schedulers.
const auditVerificationMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startAuditVerificationScheduler } =
      await import('#/lib/audit-verification.server')

    startAuditVerificationScheduler()

    return next()
  },
)

// Trusted timestamps: asks each workspace's chosen time-stamping authority to
// timestamp new signatures. Does nothing until an admin turns it on. Guarded
// like the other schedulers.
const timestampMiddleware = createMiddleware().server(async ({ next }) => {
  const { startTimestampScheduler } =
    await import('#/lib/timestamps/stamper.server')

  startTimestampScheduler()

  return next()
})

// OpenLineage: sends runs, imports and worklists to each workspace's lineage
// endpoints. Does nothing until an admin adds one. Also picks up reproductions
// asked for by a pipeline step. Guarded like the schedulers.
const lineageMiddleware = createMiddleware().server(async ({ next }) => {
  const { startLineageScheduler } =
    await import('#/lib/provenance/lineage-emitter.server')

  startLineageScheduler()

  const { startReproductionScheduler } =
    await import('#/lib/provenance/reproduction-requests.server')

  startReproductionScheduler()

  return next()
})

// The lab scheduler: picks up plans asked for (from the app, the API, the
// assistant or a pipeline) and proposes where the parts of an experiment can go.
// Guarded like the other schedulers.
const scheduleMiddleware = createMiddleware().server(async ({ next }) => {
  const { startScheduleScheduler } =
    await import('#/lib/scheduler/plan-requests.server')

  startScheduleScheduler()

  return next()
})

// Open tables: keeps each enabled workspace's Parquet lake up to date. Does
// nothing until an admin turns it on. Guarded like the other schedulers.
const lakeMiddleware = createMiddleware().server(async ({ next }) => {
  const { startLakeScheduler } =
    await import('#/lib/lake/lake-scheduler.server')

  startLakeScheduler()

  return next()
})

// Publishing: sends queued experiments and dataset versions to the repository
// an admin set up, and makes a draft public once someone confirms. Does
// nothing until then. Guarded like the other schedulers.
const publisherMiddleware = createMiddleware().server(async ({ next }) => {
  const { startPublisher } = await import('#/lib/publishing/publisher.server')
  startPublisher()

  return next()
})

// Workspace backups: the same archive as the whole-workspace export, made on
// each workspace's schedule and kept to the newest few. Guarded like the other
// schedulers and never started under test runners unless explicitly enabled.
const backupSchedulerMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startBackupScheduler } =
      await import('#/lib/workspace-export/backup-scheduler.server')

    startBackupScheduler()

    return next()
  },
)

// API-06: webhook delivery engine. LISTENs for change events, matches
// active subscriptions, and attempts signed HTTP POST delivery with
// retries and auto-disablement. Started lazily per-process.
const webhookDeliveryMiddleware = createMiddleware().server(
  async ({ next }) => {
    const { startWebhookDeliveryEngine } =
      await import('#/lib/webhook-delivery')

    startWebhookDeliveryEngine()

    return next()
  },
)

// Preserve TanStack Start's default CSRF protection for server functions.
// Providing requestMiddleware replaces the framework default list, so CSRF
// must be declared here explicitly.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

// Failed API replies say why on the request's log event. Server-only, so the
// helper is imported dynamically like the schedulers above.
const failureContextMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const result = await next()

    const { annotateFailure, annotateSummary } =
      await import('#/lib/failure-context.server')

    annotateSummary(request, result.response)
    await annotateFailure(result.response)

    return result
  },
)

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next()
    const headers = result.response.headers
    const contentType = headers.get('content-type') ?? ''

    // A plugin's sandboxed frame arrives with its own, stricter policy (no
    // network, `sandbox` without `allow-same-origin`). Keep it, and leave its
    // scripts alone: a nonce added inside a bundle's strings would break it.
    const ownPolicy = headers.get('content-security-policy')

    if (ownPolicy && /(^|;)\s*sandbox\b/.test(ownPolicy)) {
      applySecurityHeaders(headers)
      headers.set('content-security-policy', ownPolicy)

      return result
    }

    // Non-HTML responses (JSON/API, SSE, file bytes, health) keep the static
    // policy; there is no document script surface to protect.
    if (!contentType.includes('text/html')) {
      applySecurityHeaders(headers)

      return result
    }

    // A document that brings its own policy (a plugin's sandboxed screen) keeps
    // it: the app's policy would replace the sandbox and its nonce rewriting
    // would change the plugin's own code.
    if (headers.get('content-security-policy')?.includes('sandbox'))
      return result

    // HTML documents get a per-request nonce: inline scripts emitted by the
    // app bootstrap and TanStack Start (history restore, stream barrier,
    // hydration completion) are allowlisted by nonce and `script-src`
    // drops 'unsafe-inline'. The body is buffered (pages are small; the
    // streaming TTFB trade-off is documented in docs/operations/security-headers.md).
    const nonce = randomBytes(16).toString('base64url')
    applySecurityHeaders(headers, undefined, nonce)
    const html = await result.response.text()
    const nonced = injectNonceIntoHtml(html, nonce)

    return {
      ...result,
      response: new Response(nonced, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers: result.response.headers,
      }),
    }
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeadersMiddleware,
    failureContextMiddleware,
    pipelineSchedulerMiddleware,
    pipelineWorkerMiddleware,
    emailSchedulerMiddleware,
    pushSchedulerMiddleware,
    channelSchedulerMiddleware,
    datasetRetentionSchedulerMiddleware,
    fileTextBackfillMiddleware,
    embeddingIndexerMiddleware,
    sampleHoldSchedulerMiddleware,
    contractSchedulerMiddleware,
    reagentExpirySchedulerMiddleware,
    recurringWorkMiddleware,
    absenceCoverMiddleware,
    labWatcherMiddleware,
    stepTimerMiddleware,
    auditVerificationMiddleware,
    timestampMiddleware,
    lineageMiddleware,
    scheduleMiddleware,
    lakeMiddleware,
    publisherMiddleware,
    backupSchedulerMiddleware,
    webhookDeliveryMiddleware,
    csrfMiddleware,
  ],
}))
