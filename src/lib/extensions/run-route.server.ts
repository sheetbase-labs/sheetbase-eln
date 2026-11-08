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

import {
  ExtensionRunError,
  invokeExtension,
  openExtensionPoint,
  runExtensionAnalysis,
  runExtensionHook,
  defaultDeps,
} from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'

export const EXTENSION_RUN_BODY_BYTES = 8 * 1024 * 1024

const idPattern = /^[a-z][a-z0-9-]{0,48}$/

const rowsSchema = z.array(z.record(z.string(), z.unknown())).min(1).max(5000)

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
    })
    .strict(),
  z
    .object({
      kind: z.literal('analysis'),
      extensionKey: z.string().regex(idPattern),
      kindId: z.string().regex(idPattern),
      rows: z.array(z.record(z.string(), z.unknown())).max(100_000),
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
}

export const limiter = createRateLimiter({ maxRequests: 60, windowSeconds: 60 })

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
  const decision = limiter.hit(`extension-run:${session.user.id}`)
  if (!decision.allowed)
    return refuse(
      429,
      `Too many plugin calls. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    )
  let raw: unknown
  try {
    const text = await request.text()
    if (text.length > EXTENSION_RUN_BODY_BYTES) {
      return refuse(413, 'That is too much data to send to a plugin.')
    }
    raw = JSON.parse(text)
  } catch {
    return refuse(400, 'Send a JSON body.')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return refuse(400, 'The request could not be read.')
  const body = parsed.data
  try {
    if (body.kind === 'operation') {
      const { manifest } = await openExtensionPoint(
        deps.runtime,
        member.workspaceId,
        body.extensionKey,
        'operations',
      )
      const operation = manifest.contributions.operations?.find(
        (entry) => entry.id === body.operationId,
      )
      if (!operation)
        return refuse(404, 'That plugin doesn’t offer this any more.')
      // The writer set: anyone but the read-only viewer.
      if (operation.access === 'write' && member.role === 'viewer')
        return refuse(403, 'Running this needs a workspace you can edit.')
      const outcome = await invokeExtension(
        {
          workspaceId: member.workspaceId,
          actorUserId: session.user.id,
          extensionKey: body.extensionKey,
          point: 'operations',
          itemId: body.operationId,
          input: body.input,
        },
        deps.runtime,
      )
      return reply({ output: outcome.output, durationMs: outcome.durationMs })
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
