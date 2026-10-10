import { createFileRoute } from '@tanstack/react-router'
import { handleParserValidation } from '#/lib/import/parser-validation.server'

export const Route = createFileRoute('/api/parsers/validate')({
  server: {
    handlers: { POST: ({ request }) => handleParserValidation(request) },
  },
})
