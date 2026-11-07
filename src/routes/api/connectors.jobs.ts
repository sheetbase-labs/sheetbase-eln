/**
 * Robot jobs for the folder agent.
 *
 * POST /api/connectors/jobs with `{ action: 'list' | 'report', ... }` and a
 * personal API token as `Authorization: Bearer`. See
 * src/lib/connectors/jobs.server.ts and scripts/instrument-agent.mjs.
 */
import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { verifyExternalCredential } from '#/lib/external-token'
import { createServerDataClient } from '#/lib/connectors/enterprise/execution.server'
import { handleJobs } from '#/lib/connectors/jobs.server'

const handler = ({ request }: { request: Request }) =>
  handleJobs(request, {
    verifyCredential: (token) =>
      verifyExternalCredential(db, token, env.PGRST_JWT_SECRET),
    createClient: createServerDataClient,
  })

export const Route = createFileRoute('/api/connectors/jobs')({
  server: {
    handlers: { POST: handler },
  },
})
