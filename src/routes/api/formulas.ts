import { createFileRoute } from '@tanstack/react-router'
import { handleFormulaWrite } from '#/lib/formula-write.server'

export const Route = createFileRoute('/api/formulas')({
  server: { handlers: { POST: ({ request }) => handleFormulaWrite(request) } },
})
