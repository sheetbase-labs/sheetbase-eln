import { createFileRoute } from '@tanstack/react-router'
import { handleCalculation } from '#/lib/calculation.server'

export const Route = createFileRoute('/api/calculations')({
  server: {
    handlers: { POST: ({ request }) => handleCalculation(request) },
  },
})
