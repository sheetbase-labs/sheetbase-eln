/**
 * Data access in the app: whether the signed-in person sees technical details
 * (keys, API routes, Postgres names), the roles setting behind it, and the
 * personal read-only SQL logins.
 *
 * Everyone without data access keeps exactly the scientist-facing UI: gate
 * every technical affordance on `useDataAccess()`.
 */
import { useRouteContext } from '@tanstack/react-router'

import type { DataClient } from './data-client'
import { notebookDataClient } from './notebook-data'
import { DEFAULT_DATA_ACCESS_ROLES, hasDataAccess } from './data-access-roles'

export {
  DATA_ACCESS_ROLE_OPTIONS,
  DEFAULT_DATA_ACCESS_ROLES,
  hasDataAccess,
} from './data-access-roles'
export type { DataAccessRole } from './data-access-roles'

/**
 * Whether a workspace role is one the data-access setting enables. client_viewer
 * never is. `roles` is the workspace's setting; without it the default applies.
 */
export function canUseDataAccess(
  role: string | null | undefined,
  roles: readonly string[] = DEFAULT_DATA_ACCESS_ROLES,
): boolean {
  if (!role || role === 'client_viewer') return false
  return hasDataAccess(role, roles)
}

/**
 * Whether the signed-in person's role has data access. Read from the root
 * route context, so it is right on first paint. The database stays the
 * authority: every technical read and write is checked there as well.
 */
export function useDataAccess(): boolean {
  const { auth } = useRouteContext({ from: '__root__' })
  return Boolean(auth?.dataAccess)
}

export const dataAccessKeys = {
  roles: (workspaceId: string) =>
    ['data-access', 'roles', workspaceId] as const,
  logins: (workspaceId: string) =>
    ['data-access', 'sql-logins', workspaceId] as const,
  ready: (workspaceId: string) =>
    ['data-access', 'sql-ready', workspaceId] as const,
}

export async function fetchDataAccessRoles(
  client: DataClient = notebookDataClient,
): Promise<string[]> {
  const rows = await client.list<{ data_access_roles: string[] | null }>(
    'workspace_settings',
    '?select=data_access_roles&limit=1',
  )
  return rows[0]?.data_access_roles ?? [...DEFAULT_DATA_ACCESS_ROLES]
}

export async function updateDataAccessRoles(
  workspaceId: string,
  roles: string[],
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('update_workspace_data_access_roles', {
    p_workspace_id: workspaceId,
    p_roles: roles,
  })
}

/** A personal SQL login as listed: never carries the password. */
export interface SqlLogin {
  id: string
  name: string
  username: string
  userId: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked' | 'suspended'
}

/** What minting or rotating returns once: the password is not stored. */
export interface SqlLoginSecret {
  id: string
  username: string
  password: string
  expiresAt: string | null
}

interface SqlLoginWire {
  id: string
  name: string
  username: string
  user_id: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  status: SqlLogin['status']
}

interface SqlLoginSecretWire {
  id: string
  username: string
  password: string
  expires_at: string | null
}

function toSecret(row: SqlLoginSecretWire): SqlLoginSecret {
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    expiresAt: row.expires_at,
  }
}

export async function fetchSqlLogins(
  workspaceId: string,
  client: DataClient = notebookDataClient,
): Promise<SqlLogin[]> {
  const rows = await client.rpc<SqlLoginWire[]>('list_sql_logins', {
    p_workspace_id: workspaceId,
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status: row.status,
  }))
}

export async function createSqlLogin(
  workspaceId: string,
  input: { name: string; expiresAt: string | null },
  client: DataClient = notebookDataClient,
): Promise<SqlLoginSecret> {
  const rows = await client.rpc<SqlLoginSecretWire[]>('create_sql_login', {
    p_workspace_id: workspaceId,
    p_name: input.name,
    p_expires_at: input.expiresAt,
  })
  return toSecret(rows[0])
}

export async function rotateSqlLogin(
  workspaceId: string,
  loginId: string,
  client: DataClient = notebookDataClient,
): Promise<SqlLoginSecret> {
  const rows = await client.rpc<SqlLoginSecretWire[]>('rotate_sql_login', {
    p_workspace_id: workspaceId,
    p_login_id: loginId,
  })
  return toSecret(rows[0])
}

export async function revokeSqlLogin(
  workspaceId: string,
  loginId: string,
  client: DataClient = notebookDataClient,
): Promise<void> {
  await client.rpc('revoke_sql_login', {
    p_workspace_id: workspaceId,
    p_login_id: loginId,
  })
}

/** Whether the database can serve SQL logins (its roles are bootstrapped). */
export async function fetchSqlAccessReady(
  client: DataClient = notebookDataClient,
): Promise<boolean> {
  const ready = await client.rpc<boolean>('sql_access_ready', {})
  return ready === true
}
