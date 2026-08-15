import { createFileRoute } from '@tanstack/react-router'

import { handleSheetCalculation } from '#/lib/sheet-calculation.server'

export const Route = createFileRoute('/api/sheet-calculations')({
  server: {
    handlers: { POST: ({ request }) => handleSheetCalculation(request) },
  },
})
