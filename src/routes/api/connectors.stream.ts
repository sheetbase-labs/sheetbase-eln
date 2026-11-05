/**
 * Live readings from an instrument.
 *
 * POST /api/connectors/stream with a JSON batch of readings and a personal API
 * token as `Authorization: Bearer`. See src/lib/connectors/stream.server.ts and
 * scripts/instrument-agent.mjs.
 */
import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { verifyExternalCredential } from '#/lib/external-token'
import { createServerDataClient } from '#/lib/connectors/enterprise/execution.server'
import { handleStream } from '#/lib/connectors/stream.server'

const handler = ({ request }: { request: Request }) =>
  handleStream(request, {
    verifyCredential: (token) =>
      verifyExternalCredential(db, token, env.PGRST_JWT_SECRET),
    createClient: createServerDataClient,
  })

export const Route = createFileRoute('/api/connectors/stream')({
  server: {
    handlers: { POST: handler },
  },
})
