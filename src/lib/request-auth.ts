/**
 * Shared session auth + workspace resolution for byte/multipart API routes
 * that do not proxy through `/api/db` (today: `/api/files/*`). These routes
 * are session-authenticated; they resolve the Better Auth session, the
 * caller's workspace, and a short-lived PostgREST JWT so every metadata
 * mutation goes through the same RLS + change-event + audit path as the rest
 * of the application.
 */
import { pickActiveMembership } from '#/lib/active-membership'
import { db } from '#/db/client.server'
import { verifyExternalCredential, readBearerToken } from '#/lib/external-token'
import type { Scope } from '#/lib/api-credential-scopes'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { annotateRequest } from '#/lib/request-log'

export interface SessionAuthContext {
  userId: string
  workspaceId: string
  sessionId: string
  token: string
}

export type SessionAuthResult =
  | { ok: true; context: SessionAuthContext }
  | { ok: false; status: number; code: string; message: string }

export interface SessionAuthDeps {
  getSession: (headers: Headers) => Promise<{
    user: { id: string }
    session: { id: string }
  } | null>
  getWorkspaceForUser: (userId: string) => Promise<{ id: string } | null>
  mintToken: (input: {
    userId: string
    workspaceId: string
    sessionId: string
    clientId?: string | null
  }) => Promise<string>
  /**
   * Checks a personal API token for the file routes: live, a person's own, and
   * holding `scope`. Absent in tests that only use sessions.
   */
  verifyBearer?: (
    token: string,
    scope: Scope,
  ) => Promise<{
    userId: string
    workspaceId: string
    credentialId: string
  } | null>
}

/**
 * Server-side audit receipt writer for the DATA-02 export routes. Receipts
 * never flow through /api/db: request roles hold no INSERT grant on
 * api.data_exports, and workspace/actor are taken from the verified session
 * (resolveSessionAuth), never from arguments a browser could craft.
 */
export async function recordDataExportReceipt(input: {
  workspaceId: string
  actorUserId: string
  objectType:
    'dataset' | 'dataset_version' | 'sheet_instance' | 'record' | 'revision'
  objectId: string
  format: string
  rowCount?: number | null
  byteSize?: number | null
}): Promise<void> {
  await db.insert(schema.dataExports).values({
    workspaceId: input.workspaceId,
    objectType: input.objectType,
    objectId: input.objectId,
    format: input.format,
    rowCount: input.rowCount ?? null,
    byteSize:
      input.byteSize === null || input.byteSize === undefined
        ? null
        : BigInt(input.byteSize),
    actorUserId: input.actorUserId,
  })
}

/** Real production deps: Better Auth session + DB workspace + JWT mint. */
export const realSessionAuthDeps: SessionAuthDeps = {
  getSession: getAppSession,
  getWorkspaceForUser: async (userId) => {
    const [preference, memberships] = await Promise.all([
      db.query.userPreferences.findFirst({
        where: eq(schema.userPreferences.userId, userId),
      }),
      db.query.workspaceMemberships.findMany({
        where: eq(schema.workspaceMemberships.userId, userId),
      }),
    ])

    // SHELL-01.4: prefer the chosen workspace while the user is a member.
    const membership = pickActiveMembership(
      memberships,
      preference?.activeWorkspaceId,
    )

    return membership && !membership.suspendedAt
      ? { id: membership.workspaceId }
      : null
  },
  mintToken: (input) => mintPostgrestToken(env.PGRST_JWT_SECRET, input),
  async verifyBearer(token, scope) {
    try {
      const claims = await verifyExternalCredential(
        db,
        token,
        env.PGRST_JWT_SECRET,
      )

      // Uploading and downloading act as a person, so only a personal token
      // (one that names its owner) can do it.
      if (!('sub' in claims) || !claims.scopes.includes(scope)) return null

      return {
        userId: claims.sub,
        workspaceId: claims.workspace_id,
        credentialId: claims.credential_id,
      }
    } catch {
      return null
    }
  },
}

export async function resolveSessionAuth(
  headers: Headers,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<SessionAuthResult> {
  const session = await deps.getSession(headers)

  if (!session) {
    annotateRequest({ auth: 'denied', reason: 'unauthenticated' })

    return {
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'Sign in to upload or download files.',
    }
  }

  const membership = await deps.getWorkspaceForUser(session.user.id)

  if (!membership) {
    annotateRequest({
      auth: 'denied',
      reason: 'no_workspace',
      user: { id: session.user.id },
    })

    return {
      ok: false,
      status: 403,
      code: 'no_workspace',
      message: 'Your account has no active workspace.',
    }
  }

  const token = await deps.mintToken({
    userId: session.user.id,
    workspaceId: membership.id,
    sessionId: session.session.id,
    clientId: headers.get('x-sheetbase-client-id') ?? null,
  })

  annotateRequest({
    auth: 'session',
    user: { id: session.user.id },
    workspace: { id: membership.id },
  })

  return {
    ok: true,
    context: {
      userId: session.user.id,
      workspaceId: membership.id,
      sessionId: session.session.id,
      token,
    },
  }
}

/**
 * Auth for the file byte routes: a signed-in session, or a personal API token
 * with the file scope the call needs (`files:read` to download, `files:write`
 * to upload). Only these routes accept a token; exports and the rest stay
 * session-only.
 */
export async function resolveFileAuth(
  headers: Headers,
  scope: Extract<Scope, 'files:read' | 'files:write'>,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<SessionAuthResult> {
  return resolvePersonalAuth(headers, scope, deps)
}

/**
 * A signed-in session, or a personal API token holding `scope`. For the few
 * routes that take a body the `/api/db` proxy cannot (file bytes, a plugin
 * package): the token acts as its owner, and the database checks what that
 * person may do, exactly as for a session.
 */
export async function resolvePersonalAuth(
  headers: Headers,
  scope: Scope,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<SessionAuthResult> {
  const bearer = readBearerToken(headers)

  if (!bearer) return resolveSessionAuth(headers, deps)

  const verified = deps.verifyBearer
    ? await deps.verifyBearer(bearer, scope)
    : null

  if (!verified) {
    annotateRequest({ auth: 'denied', reason: 'invalid_token' })

    return {
      ok: false,
      status: 401,
      code: 'invalid_token',
      message: `Use a personal API token with the ${scope} scope.`,
    }
  }

  annotateRequest({
    auth: 'token',
    user: { id: verified.userId },
    workspace: { id: verified.workspaceId },
  })

  return {
    ok: true,
    context: {
      userId: verified.userId,
      workspaceId: verified.workspaceId,
      sessionId: verified.credentialId,
      // The token is already a database login for this person and workspace.
      token: bearer,
    },
  }
}

/** JSON error response in the same envelope as the `/api/db` proxy. */
export function requestErrorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  if (status >= 500) annotateRequest({ error: { code, message } })

  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * One PostgREST request with the minted token: the JSON body PostgREST answers
 * with, or its plain-text refusal under `error`.
 */
async function postgrestRequest<T>(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: T | { error: unknown } }> {
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- This is the transport primitive: it hands the status back with the body so every caller can judge it, which they do before decoding a row.
  const response = await fetch(`${env.POSTGREST_URL}${path}`, init)
  const text = await response.text()

  if (!text) {
    // SAFETY: an empty reply carries no row; every caller reads `status` before `body`, so the empty object is never decoded as one.
    return { status: response.status, body: {} as T }
  }

  try {
    // SAFETY: the caller's T names the row shape it asked PostgREST for, and PostgREST answers those rows as JSON.
    return { status: response.status, body: JSON.parse(text) as T }
  } catch {
    return { status: response.status, body: { error: text } }
  }
}

/**
 * Calls PostgREST with the minted token. Used by the authorize route to create
 * the file record and file_objects row through RLS so events + audit fire.
 */
export async function postgrestRpc<T = unknown>(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- an RPC's argument object is the caller's own JSON body; PostgREST validates it against the function's signature.
  args: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  return postgrestRequest<T>(`/rpc/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  })
}

/** PostgREST table POST (insert) with the minted token. */
export async function postgrestInsert<T = unknown>(
  resource: string,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a row is the caller's own JSON body; PostgREST's table constraints validate it.
  row: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  return postgrestRequest<T>(`/${resource}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })
}

/** PostgREST table GET (filtered select) with the minted token. */
export async function postgrestSelect<T = unknown>(
  resource: string,
  query: string,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  return postgrestRequest<T>(`/${resource}?${query}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
}

/** PostgREST table PATCH (filtered update) with the minted token. */
export async function postgrestPatch<T = unknown>(
  resource: string,
  query: string,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a partial row is the caller's own JSON body; PostgREST's table constraints validate it.
  patch: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  return postgrestRequest<T>(`/${resource}?${query}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })
}
