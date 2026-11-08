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
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { CHEMISTRY_PLUGIN_KEY, adoptChemistryPlugin } from '../chemistry-plugin'
import type { AdoptedModel } from '../chemistry-plugin'
import { runExtensionSamenessKey } from './data-runtime.server'
import { reindexPlugin } from './reindex.server'
import { ensureBuiltInPlugins } from './built-in.server'

export interface BuiltInRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  /** Moves existing compound registries onto the chemistry plugin after it is installed or updated. */
  adoptChemistry?: (
    client: DataClient,
    caller: { workspaceId: string; actorUserId: string },
  ) => Promise<AdoptedModel[]>
}

const adoptChemistryDefault: NonNullable<
  BuiltInRouteDeps['adoptChemistry']
> = async (client, caller) => {
  const adopted = await adoptChemistryPlugin(client, (molfile) =>
    runExtensionSamenessKey({
      ...caller,
      extensionKey: CHEMISTRY_PLUGIN_KEY,
      keyId: 'parent-structure',
      values: { structure: molfile },
    }),
  )
  // Compounds saved before the plugin get their entry in its search index.
  await reindexPlugin(client, caller, CHEMISTRY_PLUGIN_KEY)
  return adopted
}

export async function handleBuiltInPlugins(
  request: Request,
  deps: BuiltInRouteDeps = {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    adoptChemistry: adoptChemistryDefault,
  },
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
      'Only an owner or administrator can install plugins.',
    )
  }
  try {
    const results = await ensureBuiltInPlugins(client, context)
    // Compounds registered before the plugin keep working: their structure
    // field becomes the plugin's and each one gets its same-thing key. A
    // problem here does not undo the install; the administrator can run it
    // again from the adopt route.
    let adopted: AdoptedModel[] = []
    let adoptError: string | undefined
    const chemistry = results.find((r) => r.key === CHEMISTRY_PLUGIN_KEY)
    if (chemistry && chemistry.action !== 'unchanged' && deps.adoptChemistry) {
      try {
        adopted = await deps.adoptChemistry(client, {
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
        })
      } catch (error) {
        adoptError =
          error instanceof Error ? error.message : 'Adopting compounds failed.'
      }
    }
    return Response.json({
      plugins: results,
      adopted,
      ...(adoptError ? { adoptError } : {}),
    })
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
