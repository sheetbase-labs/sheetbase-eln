/**
 * Ontology lookup route: `GET /api/ontology/search?q=...&ontology=obi,chebi`.
 *
 * Session-authenticated. The workspace has to have turned ontology lookup on
 * (Settings > Open data); until then nothing is sent to the ontology service
 * and the route says so.
 */
import {
  postgrestRpc,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { searchOntologyTerms } from './ols'
import type { OntologyTerm } from './ols'

interface OntologySettings {
  enabled: boolean
  ontologies: string[]
}

export async function handleOntologySearch(
  request: Request,
  deps: SessionAuthDeps,
  search: typeof searchOntologyTerms = searchOntologyTerms,
): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()

  if (query.length < 2) {
    return Response.json({ terms: [] satisfies OntologyTerm[] })
  }

  const settingsRes = await postgrestRpc<OntologySettings>(
    'ontology_settings',
    { p_workspace_id: context.workspaceId },
    context.token,
  )

  const settings = settingsRes.body

  if (
    settingsRes.status >= 400 ||
    !('enabled' in settings) ||
    !settings.enabled
  ) {
    return requestErrorResponse(
      409,
      'ontology_lookup_off',
      'Ontology lookup is off. An admin can turn it on in Settings > Open data.',
    )
  }

  const allowed = new Set<string>(settings.ontologies)

  const asked = (url.searchParams.get('ontology') ?? '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter((o) => allowed.has(o))

  const ontologies = asked.length > 0 ? asked : [...allowed]

  try {
    const terms = await search(query, ontologies)

    return Response.json({ terms })
  } catch (error) {
    return requestErrorResponse(
      502,
      'ontology_service_unavailable',
      error instanceof Error
        ? error.message
        : 'The ontology service did not answer.',
    )
  }
}
