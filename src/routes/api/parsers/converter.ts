import { createFileRoute } from '@tanstack/react-router'

import { handleConverterAdmin } from '#/lib/connectors/converter-admin.server'

export const Route = createFileRoute('/api/parsers/converter')({
  server: {
    handlers: {
      GET: ({ request }) => handleConverterAdmin(request),
      POST: ({ request }) => handleConverterAdmin(request),
    },
  },
})
