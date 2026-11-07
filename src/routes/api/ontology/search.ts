/**
 * Ontology term lookup (EBI OLS), for the term picker. Thin wrapper around the
 * testable handler in src/lib/ontology/routes.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleOntologySearch } from '#/lib/ontology/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({ request }: { request: Request }) =>
  handleOntologySearch(request, realSessionAuthDeps)

export const Route = createFileRoute('/api/ontology/search')({
  server: {
    handlers: { GET: handler },
  },
})
