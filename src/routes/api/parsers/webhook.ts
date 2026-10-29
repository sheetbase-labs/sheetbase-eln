import { createFileRoute } from '@tanstack/react-router'

import { handleWebhookParserAdmin } from '#/lib/connectors/webhook-parser-admin.server'

export const Route = createFileRoute('/api/parsers/webhook')({
  server: {
    handlers: { POST: ({ request }) => handleWebhookParserAdmin(request) },
  },
})
