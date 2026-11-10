/**
 * POST /api/plugins/built-in: an owner or administrator installs or updates the
 * plugins that ship with Sheetbase. Safe to repeat. The database checks
 * `extensions.manage` before anything is written.
 */
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolvePersonalAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { ensureBuiltInPlugins } from './built-in.server'
import type { BuiltInResult } from './built-in.server'

export interface BuiltInRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  /** Installs the built-in plugins; the route's own tests supply this seam. */
  ensureBuiltIn?: (
    client: DataClient,
    context: { workspaceId: string; userId: string },
  ) => Promise<BuiltInResult[]>
}

export async function handleBuiltInPlugins(
  request: Request,
  deps: BuiltInRouteDeps = {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
  },
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')

  const auth = await resolvePersonalAuth(
    request.headers,
    'admin:write',
    deps.auth,
  )

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const client = deps.makeClient(context.token)

  try {
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'extensions.manage',
    })
  } catch {
    return requestErrorResponse(
      403,
      'forbidden',
      'Only an owner or administrator can install plugins.',
    )
  }

  try {
    const ensure = deps.ensureBuiltIn ?? ensureBuiltInPlugins
    const results = await ensure(client, context)

    return Response.json({ plugins: results })
  } catch (error) {
    return requestErrorResponse(
      409,
      'install_refused',
      error instanceof Error
        ? error.message
        : 'The built-in plugins could not be installed.',
    )
  }
}
