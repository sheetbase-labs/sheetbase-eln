/**
 * POST /api/plugins/<key>/<operation>: the API route every plugin operation
 * gets from its manifest declaration, so scripts and integrations can call it
 * like any other part of the API.
 *
 * Body `{ "input": { ... } }`, answer `{ "output": { ... } }`. The caller is
 * the signed-in person or a personal API token (never a service token, so
 * every call is attributed to a person): a `read` operation needs a scope that
 * ends in `:read`, a `write` operation needs `lab:write` and a role that can
 * write. Everything else is checked by the same gate as every other way in:
 * the plugin is installed, enabled, has the operation switched on and still
 * declares it, the input matches what it declared, and the call is audited.
 */
import { z } from 'zod'

import { getAppSession } from '#/lib/auth'
import { readBearerToken, verifyExternalCredential } from '#/lib/external-token'

import type { Scope } from '../api-credential-scopes'
import {
  EXTENSION_RUN_BODY_BYTES,
  defaultRouteDeps,
  failure,
  limiter,
  refuse,
  reply,
} from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'
import {
  ExtensionRunError,
  invokeExtension,
  openCallable,
} from './runtime.server'

export interface PluginApiCaller {
  workspaceId: string
  userId: string
  role: string
  /** Present for a token: what it may do. A session has none and relies on role. */
  scopes: readonly Scope[] | null
}

export interface PluginApiDeps extends ExtensionRunRouteDeps {
  authenticate: (
    headers: Headers,
  ) => Promise<PluginApiCaller | 'forbidden' | null>
}

const idPattern = /^[a-z][a-z0-9-]{0,48}$/
const bodySchema = z
  .object({ input: z.record(z.string(), z.unknown()) })
  .strict()

export async function handlePluginOperationApi(
  request: Request,
  params: { key: string; id: string },
  deps: PluginApiDeps = defaultApiDeps(),
): Promise<Response> {
  if (!idPattern.test(params.key) || !idPattern.test(params.id))
    return refuse(404, 'No such plugin operation.')
  const caller = await deps.authenticate(request.headers)
  if (caller === null)
    return refuse(401, 'Sign in or send a personal API token.')
  if (caller === 'forbidden')
    return refuse(
      403,
      'Plugin operations need a personal API token, not a service token.',
    )
  const decision = limiter.hit(`plugin-api:${caller.userId}`)
  if (!decision.allowed)
    return refuse(
      429,
      `Too many plugin calls. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  let raw: unknown
  try {
    const text = await request.text()
    if (text.length > EXTENSION_RUN_BODY_BYTES)
      return refuse(413, 'That is too much data to send to a plugin.')
    raw = JSON.parse(text)
  } catch {
    return refuse(400, 'Send a JSON body like { "input": { … } }.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success)
    return refuse(400, 'Send a JSON body like { "input": { … } }.')
  try {
    const { callable } = await openCallable(
      deps.runtime,
      caller.workspaceId,
      params.key,
      params.id,
    ).catch((error: unknown) => {
      if (error instanceof ExtensionRunError && error.code === 'not_declared')
        return { callable: undefined }
      throw error
    })
    const operation = callable?.declaration
    if (!operation) return refuse(404, 'That plugin doesn’t offer this.')
    if (operation.access === 'write') {
      if (caller.role === 'viewer')
        return refuse(403, 'Running this needs a workspace you can edit.')
      if (caller.scopes && !caller.scopes.includes('lab:write'))
        return refuse(
          403,
          'This token needs the lab:write scope for a plugin operation that writes.',
        )
    } else if (
      caller.scopes &&
      !caller.scopes.some((scope) => scope.endsWith(':read'))
    ) {
      return refuse(403, 'This token needs a read scope.')
    }
    const outcome = await invokeExtension(
      {
        workspaceId: caller.workspaceId,
        actorUserId: caller.userId,
        extensionKey: params.key,
        itemId: params.id,
        input: parsed.data.input,
      },
      deps.runtime,
    )
    return reply({ output: outcome.output, durationMs: outcome.durationMs })
  } catch (error) {
    return failure(error)
  }
}

function defaultApiDeps(): PluginApiDeps {
  const base = defaultRouteDeps()
  return {
    ...base,
    async authenticate(headers) {
      const session = await getAppSession(headers)
      if (session) {
        const member = await base.getMember(session.user.id)
        return member
          ? {
              workspaceId: member.workspaceId,
              userId: session.user.id,
              role: member.role,
              scopes: null,
            }
          : null
      }
      const token = readBearerToken(headers)
      if (!token) return null
      try {
        const [{ db }, { env }] = await Promise.all([
          import('#/db/client.server'),
          import('#/env.server'),
        ])
        const claims = await verifyExternalCredential(
          db,
          token,
          env.PGRST_JWT_SECRET,
        )
        if (claims.role !== 'authenticated') return 'forbidden'
        const member = await base.getMember(claims.sub)
        if (!member || member.workspaceId !== claims.workspace_id) return null
        return {
          workspaceId: claims.workspace_id,
          userId: claims.sub,
          role: member.role,
          scopes: claims.scopes,
        }
      } catch {
        return null
      }
    },
  }
}
