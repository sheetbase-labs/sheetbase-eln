/**
 * PLAT-02 — Prometheus-compatible metrics endpoint. Never public: in
 * staging/production a bearer token (SHEETBASE_METRICS_TOKEN from the secret
 * manager) is required and the app container binds to loopback, so scraping
 * runs over the private network. See docs/operations/observability.md.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from '#/env.server'
import { handleMetricsRequest } from '#/lib/metrics-endpoint'

const handler = ({ request }: { request: Request }) =>
  handleMetricsRequest(request, {
    token: env.SHEETBASE_METRICS_TOKEN,
    environment: env.SHEETBASE_ENV,
  })

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: { GET: handler },
  },
})
