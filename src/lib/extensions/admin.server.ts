/**
 * Administrator actions for extensions that need the server: making the key a
 * webhook runner is signed with, and saying which installs have one. Signed-in;
 * `api.extensions.manage` is checked by the database before anything is made,
 * exactly as for installing, enabling and removing.
 */
import { z } from 'zod'

import { createServerDataClient } from '../connectors/enterprise/execution.server'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { extensionsWithSecret, rotateExtensionSecret } from './runtime.server'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rotate'), extensionId: z.uuid() }).strict(),
  z.object({ action: z.literal('keys') }).strict(),
])

export async function handleExtensionAdmin(
  request: Request,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }
  const auth = await resolveSessionAuth(request.headers, deps)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return requestErrorResponse(
      400,
      'invalid_request',
      'The request could not be read.',
    )
  }
  const client = createServerDataClient(context.token)
  try {
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'extensions.manage',
    })
    if (parsed.data.action === 'keys') {
      const ids = await extensionsWithSecret(context.workspaceId)
      return Response.json({ extensionIds: [...ids] })
    }
    const owned = await client.list<{ id: string }>(
      'extensions',
      `?id=eq.${parsed.data.extensionId}&select=id&limit=1`,
    )
    if (!owned[0]) {
      return requestErrorResponse(404, 'not_found', 'No such extension.')
    }
    const secret = await rotateExtensionSecret({
      workspaceId: context.workspaceId,
      extensionId: parsed.data.extensionId,
      userId: context.userId,
    })
    return Response.json({ extensionId: parsed.data.extensionId, secret })
  } catch {
    return requestErrorResponse(
      403,
      'forbidden',
      'Only an administrator can manage extensions.',
    )
  }
}
