import { createFileRoute } from '@tanstack/react-router'
import { handleParserUpdateRequest } from '#/lib/import/parser-update.server'

export const Route = createFileRoute('/api/parsers/request-update')({
  server: {
    handlers: { POST: ({ request }) => handleParserUpdateRequest(request) },
  },
})
