/**
 * Where a SQL login connects. The host is deployment configuration
 * (SHEETBASE_SQL_HOST): the database is usually private, so the app cannot
 * guess a name people can reach. Unset means SQL access is not set up on this
 * deployment, and the app says so to data-access members.
 */
import { createServerFn } from '@tanstack/react-start'

export interface SqlConnection {
  host: string
  port: number
  database: string
}

export const sqlConnectionQueryKey = ['data-access', 'sql-connection'] as const

export function formatSqlUrl(
  connection: SqlConnection,
  username = '<username>',
): string {
  return `postgresql://${username}:<password>@${connection.host}:${connection.port}/${connection.database}`
}

/** Null when this deployment has not published a SQL host. */
export const getSqlConnectionFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SqlConnection | null> => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    const context = await getCurrentContext(getRequestHeaders())
    if (!context?.dataAccess) return null
    const { env } = await import('#/env.server')
    if (!env.SHEETBASE_SQL_HOST) return null
    return {
      host: env.SHEETBASE_SQL_HOST,
      port: env.SHEETBASE_SQL_PORT,
      database: env.SHEETBASE_SQL_DATABASE,
    }
  },
)
