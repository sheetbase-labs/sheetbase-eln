/**
 * The folder agent as a download, and whether it is running.
 *
 * Someone setting up an instrument gets one zip: the agent, a settings file
 * that already names this Sheetbase, the instrument and its results folder,
 * an access token made for the download, and a start file for the computer's
 * system. Nothing is typed in afterwards. Downloading again replaces the
 * token, so an old copy stops working.
 *
 * "Running" is read from the token: the agent signs in again whenever its
 * short-lived sign-in is about to lapse, even when no files arrive, and each
 * sign-in stamps the token's last-used time.
 */
import { zipSync, strToU8 } from 'fflate'
import { z } from 'zod'

import { emitCredentialAuditEvent } from '../credential-audit'
import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import type * as ApiCredentials from '../api-credentials'
import type { Db } from '../api-credentials'
import { boundedErrorMessage } from './enterprise/errors'
import { createServerDataClient } from './enterprise/execution.server'
import type { ConnectorWire } from './types'
import {
  agentFiles,
  agentTokenName,
  AGENT_SCOPES,
  AGENT_SEEN_MINUTES,
} from './agent-package'
import type { AgentSystem } from './agent-package'

type Credentials = Pick<
  typeof ApiCredentials,
  'createCredential' | 'listCredentials' | 'revokeCredential'
>

export interface AgentPackageDeps extends SessionAuthDeps {
  loadDb: () => Promise<Db>
  loadCredentials: () => Promise<Credentials>
  agentSource: () => Promise<string>
  createClient?: (token: string) => DataClient
  emitAudit?: typeof emitCredentialAuditEvent
  now?: () => Date
}

const downloadBody = z
  .object({
    connectorId: z.uuid(),
    system: z.enum(['windows', 'mac', 'linux']),
    folder: z.string().trim().min(1).max(500),
  })
  .strict()

async function realDb(): Promise<Db> {
  return (await import('#/db/client.server')).db
}

async function realAgentSource(): Promise<string> {
  return (await import('../../../scripts/instrument-agent.mjs?raw')).default
}

export const realAgentPackageDeps: AgentPackageDeps = {
  ...realSessionAuthDeps,
  loadDb: realDb,
  loadCredentials: () => import('../api-credentials'),
  agentSource: realAgentSource,
}

/** The connector, only if the signed-in person can see it. */
async function findConnector(
  client: DataClient,
  workspaceId: string,
  connectorId: string,
): Promise<ConnectorWire | null> {
  const rows = await client.list<ConnectorWire>(
    'connectors',
    `?id=eq.${connectorId}&workspace_id=eq.${workspaceId}&select=*&limit=1`,
  )
  const connector = rows.at(0)
  return connector?.connector_type === 'instrument' ? connector : null
}

function origin(request: Request): string {
  const url = new URL(request.url)
  const proto =
    request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    url.host
  return `${proto}://${host}`
}

/**
 * `GET ?connector=<id>`: is the agent for this instrument running?
 * `POST {connectorId, system, folder}`: the download.
 */
export async function handleAgentPackage(
  request: Request,
  deps: AgentPackageDeps = realAgentPackageDeps,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET or POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok) {
    return requestErrorResponse(auth.status, auth.code, auth.message)
  }
  const { context } = auth
  const db = await deps.loadDb()
  const credentials = await deps.loadCredentials()
  const audit = deps.emitAudit ?? emitCredentialAuditEvent
  const client = (deps.createClient ?? createServerDataClient)(context.token)
  const now = deps.now?.() ?? new Date()

  try {
    if (request.method === 'GET') {
      const id = new URL(request.url).searchParams.get('connector') ?? ''
      if (!z.uuid().safeParse(id).success) {
        return requestErrorResponse(
          400,
          'invalid_request',
          'Name the instrument connector.',
        )
      }
      const connector = await findConnector(client, context.workspaceId, id)
      if (!connector)
        return requestErrorResponse(
          404,
          'not_found',
          'No such instrument connector.',
        )
      const name = agentTokenName(connector.key)
      const live = (
        await credentials.listCredentials(db, context.workspaceId)
      ).filter(
        (row) => row.name === name && row.kind === 'personal' && !row.revokedAt,
      )
      const seen = live
        .map((row) => row.lastUsedAt)
        .filter((at): at is Date => at !== null)
        .sort((a, b) => b.getTime() - a.getTime())
        .at(0)
      return Response.json({
        downloaded: live.length > 0,
        lastSeenAt: seen?.toISOString() ?? null,
        running: seen
          ? now.getTime() - seen.getTime() <= AGENT_SEEN_MINUTES * 60_000
          : false,
      })
    }

    const parsed = downloadBody.safeParse(
      await request.json().catch(() => null),
    )
    if (!parsed.success) {
      return requestErrorResponse(
        400,
        'invalid_request',
        'Choose the instrument computer’s system and the results folder.',
      )
    }
    const body = parsed.data
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'integrations.manage',
    })
    const connector = await findConnector(
      client,
      context.workspaceId,
      body.connectorId,
    )
    if (!connector)
      return requestErrorResponse(
        404,
        'not_found',
        'No such instrument connector.',
      )
    if (!connector.config['pickup']) {
      return requestErrorResponse(
        422,
        'pickup_not_configured',
        'Choose where this instrument’s files go before downloading the agent.',
      )
    }

    const name = agentTokenName(connector.key)
    // Replacing the token: copies made earlier stop signing in.
    const earlier = (
      await credentials.listCredentials(db, context.workspaceId)
    ).filter((row) => row.name === name && !row.revokedAt)
    const minted = await db.transaction(async (tx) => {
      for (const row of earlier) {
        await credentials.revokeCredential(tx, {
          workspaceId: context.workspaceId,
          credentialId: row.id,
        })
        await audit(tx, {
          actorUserId: context.userId,
          workspaceId: context.workspaceId,
          credentialId: row.id,
          operation: 'revoke',
          payload: {},
        })
      }
      const created = await credentials.createCredential(tx, {
        workspaceId: context.workspaceId,
        createdByUserId: context.userId,
        name,
        scopes: [...AGENT_SCOPES],
        kind: 'personal',
      })
      await audit(tx, {
        actorUserId: context.userId,
        workspaceId: context.workspaceId,
        credentialId: created.id,
        operation: 'create',
        payload: {
          name,
          displayPrefix: created.displayPrefix,
          kind: 'personal',
        },
      })
      return created
    })

    const files = agentFiles({
      agentSource: await deps.agentSource(),
      url: origin(request),
      connectorKey: connector.key,
      instrumentName: connector.name,
      folder: body.folder,
      credential: minted.secret,
      system: body.system satisfies AgentSystem,
    })
    const zip = zipSync(
      Object.fromEntries(
        files.map((file) => [
          file.path,
          [
            strToU8(file.content),
            {
              mtime: now,
              os: 3,
              attrs: file.executable ? 0o100755 << 16 : 0o100644 << 16,
            },
          ],
        ]),
      ),
    )
    return new Response(zip as BlobPart, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="sheetbase-agent-${connector.key}.zip"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = boundedErrorMessage(error)
    if (/capability required|not permitted|42501/i.test(message)) {
      return requestErrorResponse(
        403,
        'not_permitted',
        'You need access to Integrations to download the agent.',
      )
    }
    return requestErrorResponse(502, 'agent_package_failed', message)
  }
}
