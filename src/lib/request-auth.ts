/**
 * Shared session auth + workspace resolution for byte/multipart API routes
 * that do not proxy through `/api/db` (today: `/api/files/*`). These routes
 * are session-authenticated; they resolve the Better Auth session, the
 * caller's workspace, and a short-lived PostgREST JWT so every metadata
 * mutation goes through the same RLS + change-event + audit path as the rest
 * of the application.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { mintPostgrestToken } from '#/lib/postgrest-token'

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
}

const db = drizzle(env.DATABASE_URL, { schema })

/** Real production deps: Better Auth session + DB workspace + JWT mint. */
export const realSessionAuthDeps: SessionAuthDeps = {
  getSession: getAppSession,
  getWorkspaceForUser: async (userId) => {
    const membership = await db.query.workspaceMemberships.findFirst({
      where: eq(schema.workspaceMemberships.userId, userId),
    })
    return membership ? { id: membership.workspaceId } : null
  },
  mintToken: (input) => mintPostgrestToken(env.PGRST_JWT_SECRET, input),
}

export async function resolveSessionAuth(
  headers: Headers,
  deps: SessionAuthDeps = realSessionAuthDeps,
): Promise<SessionAuthResult> {
  const session = await deps.getSession(headers)
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'Sign in to upload or download files.',
    }
  }
  const membership = await deps.getWorkspaceForUser(session.user.id)
  if (!membership) {
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

/** JSON error response in the same envelope as the `/api/db` proxy. */
export function requestErrorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Calls PostgREST with the minted token. Used by the authorize route to create
 * the file record and file_objects row through RLS so events + audit fire.
 */
export async function postgrestRpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  const response = await fetch(`${env.POSTGREST_URL}/rpc/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  })
  const text = await response.text()
  let body: T | { error: unknown }
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    body = { error: text }
  }
  return { status: response.status, body }
}

/** PostgREST table POST (insert) with the minted token. */
export async function postgrestInsert<T = unknown>(
  resource: string,
  row: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  const response = await fetch(`${env.POSTGREST_URL}/${resource}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })
  const text = await response.text()
  let body: T | { error: unknown }
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    body = { error: text }
  }
  return { status: response.status, body }
}

/** PostgREST table GET (filtered select) with the minted token. */
export async function postgrestSelect<T = unknown>(
  resource: string,
  query: string,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  const response = await fetch(`${env.POSTGREST_URL}/${resource}?${query}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
  const text = await response.text()
  let body: T | { error: unknown }
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    body = { error: text }
  }
  return { status: response.status, body }
}

/** PostgREST table PATCH (filtered update) with the minted token. */
export async function postgrestPatch<T = unknown>(
  resource: string,
  query: string,
  patch: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: T | { error: unknown } }> {
  const response = await fetch(`${env.POSTGREST_URL}/${resource}?${query}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })
  const text = await response.text()
  let body: T | { error: unknown }
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    body = { error: text }
  }
  return { status: response.status, body }
}
