/**
 * A generated report as a Word document, a PDF or the stored HTML
 * (`?format=docx|pdf|html`).
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleReportGenerationExport } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/export/report-generation/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleReportGenerationExport(request, params.id, realSessionAuthDeps),
    },
  },
})
