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
  defaultRouteDeps,
  failure,
  rateDecision,
  refuse,
  reply,
  tooMuchData,
} from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'
import { invokeWithHostCalls } from './operation-host.server'
import { openCallable, pluginLimits } from './runtime.server'
import type { DataClient } from '../data-client'

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
  /** The caller's own data access, for an operation that calls into the app. */
  clientFor?: (headers: Headers) => Promise<DataClient | null>
}

/** A session's own token, or the personal API token that was sent: either is the person's access. */
async function defaultClientFor(headers: Headers): Promise<DataClient | null> {
  const [{ realSessionAuthDeps, resolveSessionAuth }, execution] =
    await Promise.all([
      import('../request-auth'),
      import('../connectors/enterprise/execution.server'),
    ])

  const auth = await resolveSessionAuth(headers, realSessionAuthDeps)

  if (auth.ok) return execution.createServerDataClient(auth.context.token)
  const token = readBearerToken(headers)

  return token ? execution.createServerDataClient(token) : null
}

const idPattern = /^[a-z][a-z0-9-]{0,48}$/
const bodySchema = z.strictObject({ input: z.record(z.string(), z.unknown()) })

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

  try {
    const { install, callable } = await openCallable(
      deps.runtime,
      caller.workspaceId,
      params.key,
      params.id,
    )

    // How many calls a person may make, and how much data one may carry, are
    // this plugin's own settings. By default neither is limited.
    const limits = await pluginLimits(
      deps.runtime,
      caller.workspaceId,
      install.id,
    )

    const decision = rateDecision(
      limits.callsPerMinute,
      `plugin-api:${params.key}:${caller.userId}`,
    )

    if (!decision.allowed)
      return refuse(
        429,
        `Too many calls to this plugin. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
      )
    let raw: unknown

    try {
      const text = await request.text()

      if (text.length > limits.dataMb * 1024 * 1024)
        return refuse(413, tooMuchData(limits.dataMb))
      raw = JSON.parse(text)
    } catch {
      return refuse(400, 'Send a JSON body like { "input": { … } }.')
    }

    const parsed = bodySchema.safeParse(raw)

    if (!parsed.success)
      return refuse(400, 'Send a JSON body like { "input": { … } }.')
    const operation = callable.declaration

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

    // An operation may call into the app as the person (`host_call`), changes
    // included, like the API itself. A token can only change what its own
    // scopes allow: one without `lab:write` has its operation's changes refused.
    const outcome = await invokeWithHostCalls(
      {
        workspaceId: caller.workspaceId,
        actorUserId: caller.userId,
        extensionKey: params.key,
        itemId: params.id,
        input: parsed.data.input,
      },
      {
        workspaceId: caller.workspaceId,
        userId: caller.userId,
        approve:
          !caller.scopes || caller.scopes.includes('lab:write')
            ? 'all'
            : 'none',
        client: async () => {
          const client = await (deps.clientFor ?? defaultClientFor)(
            request.headers,
          )

          if (!client) throw new Error('Sign in to use plugins.')

          return client
        },
      },
      deps.runtime,
    )

    if (outcome.kind === 'confirm')
      return refuse(
        403,
        `${outcome.confirm.summary ?? 'This operation'} changes something, which this token's scopes do not allow. It needs the lab:write scope.`,
      )

    return reply({
      output: outcome.result.output,
      durationMs: outcome.result.durationMs,
    })
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
