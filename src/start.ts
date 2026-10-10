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

// WORK-03.4: email outbox + daily digest sweep.
const emailSchedulerMiddleware = createMiddleware().server(async ({ next }) => {
  const { startEmailScheduler } = await import('#/lib/email-scheduler.server')
  startEmailScheduler()
  return next()
})

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

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next()
    const headers = result.response.headers
    const contentType = headers.get('content-type') ?? ''

    // Non-HTML responses (JSON/API, SSE, file bytes, health) keep the static
    // policy; there is no document script surface to protect.
    if (!contentType.includes('text/html')) {
      applySecurityHeaders(headers)
      return result
    }

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
    pipelineSchedulerMiddleware,
    emailSchedulerMiddleware,
    datasetRetentionSchedulerMiddleware,
    sampleHoldSchedulerMiddleware,
    reagentExpirySchedulerMiddleware,
    webhookDeliveryMiddleware,
    csrfMiddleware,
  ],
}))
