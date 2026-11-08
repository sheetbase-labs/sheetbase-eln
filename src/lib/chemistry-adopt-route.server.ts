/**
 * POST /api/plugins/adopt-chemistry: moves a lab's compound registries onto the
 * Chemistry plugin (see `chemistry-plugin.ts`). Owners and administrators only.
 * Safe to run again: a model already moved has nothing left to do.
 * Server-only.
 */
import { createServerDataClient } from './connectors/enterprise/execution.server'
import type { DataClient } from './data-client'
import { CHEMISTRY_PLUGIN_KEY, adoptChemistryPlugin } from './chemistry-plugin'
import { runExtensionSamenessKey } from './extensions/data-runtime.server'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from './request-auth'
import type { SessionAuthDeps } from './request-auth'

export interface AdoptChemistryRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  keyFor: (
    caller: { workspaceId: string; actorUserId: string },
    molfile: string,
  ) => Promise<string>
}

export async function handleAdoptChemistry(
  request: Request,
  deps: AdoptChemistryRouteDeps = defaultRouteDeps(),
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  const auth = await resolveSessionAuth(request.headers, deps.auth)
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
      'Only an owner or administrator can manage plugins.',
    )
  }
  try {
    const models = await adoptChemistryPlugin(client, (molfile) =>
      deps.keyFor(
        { workspaceId: context.workspaceId, actorUserId: context.userId },
        molfile,
      ),
    )
    return Response.json(
      { models },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return requestErrorResponse(
      409,
      'chemistry_plugin_not_ready',
      error instanceof Error
        ? error.message
        : 'The Chemistry plugin could not take over the compound registries.',
    )
  }
}

function defaultRouteDeps(): AdoptChemistryRouteDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    keyFor: (caller, molfile) =>
      runExtensionSamenessKey({
        ...caller,
        extensionKey: CHEMISTRY_PLUGIN_KEY,
        keyId: 'parent-structure',
        values: { structure: molfile },
      }),
  }
}
