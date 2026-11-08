/**
 * POST /api/plugins/run: run a plugin operation (after a person
 * presses its card, or approves an agent's request) or one of its analysis
 * kinds on rows the person already reads.
 *
 * The server checks everything again: who is asking, that the extension is
 * installed, enabled and has the point switched on, that it still declares the
 * item, and that a write tool is run by someone who can write. Pipeline actions
 * are not run from here: they only run inside a published pipeline.
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { pickActiveMembership } from '#/lib/active-membership'
import { getAppSession } from '#/lib/auth'
import { createRateLimiter } from '#/lib/rate-limit'
import type { RateLimiter } from '#/lib/rate-limit'

import {
  ExtensionRunError,
  invokeExtension,
  openCallable,
  pluginLimits,
  runExtensionAnalysis,
  runExtensionHook,
  defaultDeps,
} from './runtime.server'
import type { ExtensionRuntimeDeps, HostAnswer } from './runtime.server'
import { resolveLimits } from './runtime-config'
import type { HostCall, PluginHostRouteDeps } from './host-route.server'

const idPattern = /^[a-z][a-z0-9-]{0,48}$/

const rowsSchema = z.array(z.record(z.string(), z.unknown())).min(1)

const bodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('screen'),
      extensionKey: z.string().regex(idPattern),
      point: z.enum(['blocks', 'panels']),
      itemId: z.string().regex(idPattern),
      context: z.record(z.string(), z.unknown()),
      state: z.unknown().optional(),
      event: z
        .object({
          action: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
          values: z.record(z.string(), z.unknown()),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('column'),
      extensionKey: z.string().regex(idPattern),
      itemId: z.string().regex(idPattern),
      rows: rowsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('column-action'),
      extensionKey: z.string().regex(idPattern),
      itemId: z.string().regex(idPattern),
      actionId: z.string().regex(idPattern),
      rows: rowsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('row-action'),
      extensionKey: z.string().regex(idPattern),
      itemId: z.string().regex(idPattern),
      rows: rowsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('operation'),
      extensionKey: z.string().regex(idPattern),
      operationId: z.string().regex(idPattern),
      input: z.record(z.string(), z.unknown()),
      /** Answers to the calls the operation made into the app so far, handed back by the screen that was told to ask the person. */
      hostResults: z
        .array(
          z
            .object({
              ok: z.boolean(),
              result: z.unknown().optional(),
              error: z.string().optional(),
              code: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
      /** Which calls (by position) the person said yes to. */
      approved: z.array(z.number().int().nonnegative()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('analysis'),
      extensionKey: z.string().regex(idPattern),
      kindId: z.string().regex(idPattern),
      // How many rows a plugin takes is that plugin's own setting, checked below.
      rows: z.array(z.record(z.string(), z.unknown())),
    })
    .strict(),
])

export interface ExtensionRunRouteDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  /** The person's active workspace and role, or null when they have none or are suspended. */
  getMember: (
    userId: string,
  ) => Promise<{ workspaceId: string; role: string } | null>
  runtime: ExtensionRuntimeDeps
  /** What an operation needs to call into the app as the person; the real ones by default. */
  host?: (
    request: Request,
    workspaceId: string,
    extensionKey: string,
  ) => Promise<{
    deps: Pick<PluginHostRouteDeps, 'runtime'>
    call: Pick<HostCall, 'workspaceId' | 'userId' | 'client' | 'install'>
  } | null>
}

/** A guard against an operation that never stops asking, not a limit on what one may do. */
const MAX_HOST_ROUNDS = 500

async function defaultHostDeps(
  request: Request,
  workspaceId: string,
  extensionKey: string,
) {
  // Loaded when an operation first calls into the app, so running one that
  // does not never pulls these in.
  const [{ realSessionAuthDeps, resolveSessionAuth }, execution, client_] =
    await Promise.all([
      import('../request-auth'),
      import('../connectors/enterprise/execution.server'),
      import('./client'),
    ])
  const auth = await resolveSessionAuth(request.headers, realSessionAuthDeps)
  if (!auth.ok) return null
  const client = execution.createServerDataClient(auth.context.token)
  const install = (await client_.listExtensions(client)).find(
    (row) => row.key === extensionKey,
  )
  if (!install) return null
  return {
    deps: { runtime: defaultDeps() },
    call: { workspaceId, userId: auth.context.userId, client, install },
  }
}

/**
 * Calls per person per minute are a per-plugin setting (none by default), so a
 * limiter exists only for plugins whose administrator set one.
 */
const limiters = new Map<number, RateLimiter>()

export function rateDecision(
  perMinute: number | null,
  key: string,
): ReturnType<RateLimiter['hit']> {
  if (perMinute === null) return { allowed: true }
  let limiter = limiters.get(perMinute)
  if (!limiter) {
    limiter = createRateLimiter({ maxRequests: perMinute, windowSeconds: 60 })
    limiters.set(perMinute, limiter)
  }
  return limiter.hit(key)
}

export const tooMuchData = (limitMb: number) =>
  `That is more data than this plugin is set up to take (${limitMb} MB). An administrator can raise this in Settings → Plugins.`

/** The largest data limit among the workspace's plugins: the most any one request may carry. */
export async function largestDataLimitBytes(
  deps: ExtensionRuntimeDeps,
  workspaceId: string,
): Promise<number> {
  const rows = (await deps.listRuntime?.(workspaceId)) ?? []
  const mb = rows.reduce(
    (largest, row) =>
      Math.max(largest, resolveLimits(row.limitOverrides).dataMb),
    resolveLimits(undefined).dataMb,
  )
  return Math.round(mb * 1024 * 1024)
}

export const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export const refuse = (status: number, message: string) =>
  reply({ error: message }, status)

/** How a failed run reaches the person: a plain message and a fitting status. */
export function failure(error: unknown): Response {
  if (error instanceof ExtensionRunError) {
    const status =
      error.code === 'not_installed' || error.code === 'not_declared'
        ? 404
        : error.code === 'not_enabled' || error.code === 'point_off'
          ? 409
          : error.code === 'bad_input'
            ? 400
            : error.code === 'environment_not_ready'
              ? 503
              : 502
    return refuse(status, error.message)
  }
  return refuse(500, 'The plugin could not do that.')
}

export async function handleExtensionRun(
  request: Request,
  deps: ExtensionRunRouteDeps = defaultRouteDeps(),
): Promise<Response> {
  const session = await deps.getSession(request.headers)
  if (!session) return refuse(401, 'Sign in to use plugins.')
  const member = await deps.getMember(session.user.id)
  if (!member) return refuse(403, 'You need a workspace to use plugins.')
  let raw: unknown
  let size = 0
  try {
    const text = await request.text()
    size = text.length
    // The most any plugin here takes; the plugin's own limit is checked once we know which.
    if (size > (await largestDataLimitBytes(deps.runtime, member.workspaceId)))
      return refuse(413, 'That is too much data to send to a plugin.')
    raw = JSON.parse(text)
  } catch {
    return refuse(400, 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return refuse(400, 'The request could not be read.')
  const body = parsed.data
  try {
    // Which plugin it is decides the limits; whether it may do this is checked by the run itself.
    const install = await deps.runtime.loadInstall(
      member.workspaceId,
      body.extensionKey,
    )
    const limits = await pluginLimits(
      deps.runtime,
      member.workspaceId,
      install?.id ?? '',
    )
    const decision = rateDecision(
      limits.callsPerMinute,
      `extension-run:${body.extensionKey}:${session.user.id}`,
    )
    if (!decision.allowed)
      return refuse(
        429,
        `Too many calls to this plugin. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
      )
    if (size > limits.dataMb * 1024 * 1024)
      return refuse(413, tooMuchData(limits.dataMb))
    if (body.kind === 'analysis' && body.rows.length > limits.rows)
      return refuse(
        413,
        `That dataset has more rows than this plugin is set up to take (${limits.rows}). An administrator can raise this in Settings → Plugins.`,
      )
    if (body.kind === 'operation') {
      const { callable } = await openCallable(
        deps.runtime,
        member.workspaceId,
        body.extensionKey,
        body.operationId,
      )
      const operation = callable.declaration
      // The writer set: anyone but the read-only viewer.
      if (operation.access === 'write' && member.role === 'viewer')
        return refuse(403, 'Running this needs a workspace you can edit.')
      // An operation may call into the app (see `sheetbase_plugin.host_call`):
      // it stops, the calls are made here as the person, and it runs again
      // with the answers. A call that changes something waits for the person.
      const results: HostAnswer[] = [...(body.hostResults ?? [])]
      const approved = new Set(body.approved ?? [])
      for (let round = 0; round < MAX_HOST_ROUNDS; round++) {
        const outcome = await invokeExtension(
          {
            workspaceId: member.workspaceId,
            actorUserId: session.user.id,
            extensionKey: body.extensionKey,
            itemId: body.operationId,
            input: body.input,
            hostResults: results,
          },
          deps.runtime,
        )
        if (!outcome.hostCalls)
          return reply({
            output: outcome.output,
            durationMs: outcome.durationMs,
          })
        const host = await (deps.host ?? defaultHostDeps)(
          request,
          member.workspaceId,
          body.extensionKey,
        )
        if (!host) return refuse(403, 'Sign in to use plugins.')
        const { performHostCall } = await import('./host-route.server')
        for (const call of outcome.hostCalls) {
          const index = results.length
          const done = await performHostCall(host.deps, {
            ...host.call,
            point: 'operations',
            name: call.name,
            arguments: call.arguments,
            confirmed: approved.has(index),
          })
          if (!done.ok && done.code === 'confirmation_needed')
            return reply(
              {
                confirm: {
                  index,
                  name: call.name,
                  action:
                    typeof call.arguments.action === 'string'
                      ? call.arguments.action
                      : null,
                  summary: done.summary ?? null,
                },
                hostResults: results,
              },
              409,
            )
          results.push(
            done.ok
              ? { ok: true, result: done.result }
              : { ok: false, error: done.message, code: done.code },
          )
        }
      }
      return refuse(
        502,
        'This operation kept asking for more from Sheetbase and was stopped.',
      )
    }
    if (
      body.kind === 'screen' ||
      body.kind === 'column' ||
      body.kind === 'column-action' ||
      body.kind === 'row-action'
    ) {
      const base = {
        workspaceId: member.workspaceId,
        actorUserId: session.user.id,
        extensionKey: body.extensionKey,
      }
      const outcome = await runExtensionHook(
        body.kind === 'screen'
          ? {
              ...base,
              kind: 'screen',
              point: body.point,
              itemId: body.itemId,
              context: body.context,
              state: body.state,
              event: body.event ?? null,
            }
          : body.kind === 'column'
            ? { ...base, kind: 'column', itemId: body.itemId, rows: body.rows }
            : body.kind === 'column-action'
              ? {
                  ...base,
                  kind: 'column-action',
                  itemId: body.itemId,
                  actionId: body.actionId,
                  rows: body.rows,
                }
              : {
                  ...base,
                  kind: 'row-action',
                  itemId: body.itemId,
                  rows: body.rows,
                },
        deps.runtime,
      )
      return reply(outcome)
    }
    const outcome = await runExtensionAnalysis(
      {
        workspaceId: member.workspaceId,
        actorUserId: session.user.id,
        extensionKey: body.extensionKey,
        kindId: body.kindId,
        rows: body.rows,
      },
      deps.runtime,
    )
    return reply(outcome)
  } catch (error) {
    return failure(error)
  }
}

export function defaultRouteDeps(): ExtensionRunRouteDeps {
  return {
    getSession: getAppSession,
    runtime: defaultDeps(),
    async getMember(userId) {
      const [{ db }, schema] = await Promise.all([
        import('#/db/client.server'),
        import('#/db/schema'),
      ])
      const [preference, memberships] = await Promise.all([
        db.query.userPreferences.findFirst({
          where: eq(schema.userPreferences.userId, userId),
        }),
        db.query.workspaceMemberships.findMany({
          where: eq(schema.workspaceMemberships.userId, userId),
        }),
      ])
      const membership = pickActiveMembership(
        memberships,
        preference?.activeWorkspaceId,
      )
      return membership && !membership.suspendedAt
        ? { workspaceId: membership.workspaceId, role: membership.role }
        : null
    },
  }
}
