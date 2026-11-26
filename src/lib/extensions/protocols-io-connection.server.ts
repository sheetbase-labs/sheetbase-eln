/**
 * POST /api/plugins/protocols-io/test-connection: asks protocols.io whether the token the
 * plugin would use is accepted, for the Test connection button in Settings →
 * Plugins. The token is the one an administrator saved there (sealed, never sent
 * back). Owners and administrators only. Server-only.
 */
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { listExtensions } from './client'
import {
  databaseSettingsStore,
  openSettings,
  settingsScope,
} from './plugin-settings.server'
import type { SettingsStore } from './plugin-settings.server'

export const PROTOCOLS_IO_KEY = 'protocols-io'
const SETTING = 'token'

const SEARCH_URL =
  'https://www.protocols.io/api/v3/protocols?filter=public&key=dna&page_size=1'

export interface ProtocolsIoRouteDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  store: SettingsStore
  /** Asks protocols.io whether a token is accepted. */
  check: (token: string) => Promise<{ works: boolean; message: string | null }>
}

/** One small public search: enough to learn whether the token is accepted. */
export async function checkProtocolsIoToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ works: boolean; message: string | null }> {
  try {
    const response = await fetchImpl(SEARCH_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // protocols.io sits behind Cloudflare, which refuses clients with no name.
        'User-Agent': 'Sheetbase/1.0 (+https://sheetbase.co.uk)',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (response.ok) return { works: true, message: null }

    if (response.status === 401 || response.status === 403)
      return {
        works: false,
        message: 'protocols.io did not accept that token.',
      }

    if (response.status === 429)
      return {
        works: false,
        message: 'protocols.io is limiting requests. Try again in a minute.',
      }

    return { works: false, message: 'protocols.io did not answer. Try again.' }
  } catch {
    return {
      works: false,
      message: 'protocols.io could not be reached. Try again in a moment.',
    }
  }
}

export async function handleProtocolsIoConnection(
  request: Request,
  deps: ProtocolsIoRouteDeps = defaultRouteDeps(),
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

  const install = (await listExtensions(client)).find(
    (entry) => entry.key === PROTOCOLS_IO_KEY,
  )

  if (!install)
    return requestErrorResponse(
      404,
      'not_found',
      'The protocols.io plugin is not installed.',
    )

  const stored = await openSettings(
    deps.store,
    context.workspaceId,
    install.id,
    settingsScope('operations', ''),
  )

  const mine = stored[SETTING] ?? ''

  if (!mine)
    return Response.json({
      works: false,
      message: 'No access token is saved yet.',
    })

  return Response.json(await deps.check(mine))
}

function defaultRouteDeps(): ProtocolsIoRouteDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    store: databaseSettingsStore(),
    check: (token) => checkProtocolsIoToken(token),
  }
}
