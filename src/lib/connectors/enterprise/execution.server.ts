/**
 * INT-03 — server-only execution boundary for enterprise connectors.
 *
 * All external network access (object storage, external databases) happens
 * inside server functions. The browser may request a connection test,
 * discovery, a preview or an import — it never receives decrypted secrets
 * and never touches the external system itself.
 *
 * The boundary resolves the signed-in session and the caller's workspace
 * role, mints a short-lived PostgREST token and exposes the governed RPC
 * surface through a server-side DataClient, so runs, capability checks,
 * idempotency and change events behave exactly as in the browser flows.
 */
import type { DataClient } from '#/lib/data-client'
import { env } from '#/env.server'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import {
  postgrestInsert,
  postgrestPatch,
  postgrestRpc,
  postgrestSelect,
} from '#/lib/request-auth'

/**
 * Roles that may execute connector work (mirrors `api.is_workspace_writer`,
 * i.e. the `record.create` capability). Viewers are read-only; secret
 * management stays owner/admin/steward inside the existing sealed-secret
 * functions.
 */
const EXECUTOR_ROLES = new Set([
  'owner',
  'admin',
  'steward',
  'member',
  'scientist',
  'analyst',
  'reviewer',
])

export class ConnectorExecutionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ConnectorExecutionError'
    this.code = code
  }
}

export interface ConnectorExecutionContext {
  userId: string
  workspaceId: string
  /** Short-lived PostgREST token carrying the session identity. */
  token: string
  /** Governed RPC/REST surface for runs, datasets and file metadata. */
  client: DataClient
}

/**
 * Create a server-side DataClient: the same surface the browser uses against
 * `/api/db`, but issued server-side with the minted session token. Every
 * write still goes through PostgREST RPCs so capability checks, idempotency
 * digests and change events fire identically.
 */
export function createServerDataClient(token: string): DataClient {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { status, body } = await postgrestRpc<T>(name, args, token)
    if (status >= 400) {
      const message =
        body && typeof body === 'object' && 'message' in body
          ? String((body as { message?: unknown }).message)
          : `RPC ${name} failed.`
      throw new Error(message)
    }
    return body as T
  }
  return {
    list: async <T>(resource: string, query = ''): Promise<T[]> => {
      const { status, body } = await postgrestSelect<T[]>(
        resource,
        query.replace(/^\?/, ''),
        token,
      )
      if (status >= 400) {
        throw new Error(`${resource} query failed (${status}).`)
      }
      return body as T[]
    },
    count: async (resource: string, query = ''): Promise<number> => {
      const rows = await createServerDataClient(token).list<unknown>(
        resource,
        query,
      )
      return rows.length
    },
    rpc,
    insert: async <T>(resource: string, row: Record<string, unknown>): Promise<T> => {
      const { status, body } = await postgrestInsert<T>(resource, row, token)
      if (status >= 400) {
        throw new Error(`${resource} insert failed (${status}).`)
      }
      return body as T
    },
    patch: async <T>(
      resource: string,
      query: string,
      row: Record<string, unknown>,
    ): Promise<T[]> => {
      const { status, body } = await postgrestPatch<T[]>(
        resource,
        query.replace(/^\?/, ''),
        row,
        token,
      )
      if (status >= 400) throw new Error(`${resource} update failed.`)
      return body as T[]
    },
    remove: async (): Promise<unknown[]> => {
      throw new Error('Connector execution never deletes rows directly.')
    },
  }
}

/**
 * Resolve the signed-in executor. Server functions call this first; the role
 * comes from the verified session's workspace membership, never from
 * arguments a browser could craft.
 */
export async function resolveConnectorExecutionContext(input: {
  userId: string
  sessionId: string
  workspaceId: string
  role: string
}): Promise<ConnectorExecutionContext> {
  if (!input.workspaceId) {
    throw new ConnectorExecutionError('forbidden', 'No workspace selected.')
  }
  if (!EXECUTOR_ROLES.has(input.role)) {
    throw new ConnectorExecutionError(
      'forbidden',
      'Your workspace role cannot execute integrations.',
    )
  }
  const token = await mintPostgrestToken(env.PGRST_JWT_SECRET, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  })
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    token,
    client: createServerDataClient(token),
  }
}

/** Format any thrown error into a bounded, safe message for run failures. */
export function boundedErrorMessage(error: unknown): string {
  if (error instanceof ConnectorExecutionError) return error.message
  if (error instanceof Error) {
    // Never surface raw driver/SDK stacks; keep the first line only.
    return error.message.split('\n')[0].slice(0, 500)
  }
  return 'The connector operation failed.'
}
