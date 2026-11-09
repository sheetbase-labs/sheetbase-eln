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

export interface BuiltInRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
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
    const results = await ensureBuiltInPlugins(client, context)
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
