/**
 * The folder agent for an instrument: `GET ?connector=<id>` says whether it is
 * running, `POST` downloads it with its settings and a new token. See
 * src/lib/connectors/agent-package.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleAgentPackage } from '#/lib/connectors/agent-package.server'

const handler = ({ request }: { request: Request }) =>
  handleAgentPackage(request)

export const Route = createFileRoute('/api/connectors/agent')({
  server: {
    handlers: { GET: handler, POST: handler },
  },
})
