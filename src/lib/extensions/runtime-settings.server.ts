/**
 * The Python side of an installed plugin: its packages, the hosts it may
 * reach and the room it gets. Server-only.
 *
 * - Packages are installed once, when the plugin is added, in the Python
 *   runner (never while a call is running). The runner keeps the result as an
 *   image keyed by the package list, so two plugins that need the same things
 *   share one and a call never waits on pip.
 * - Limits are the administrator's own settings per plugin and survive updates.
 *   Nothing here caps what an administrator may give a plugin.
 * - `runtime-settings-route.server.ts` is how Settings → Plugins reads and
 *   changes them.
 */
import {
  getPythonEnvironment,
  requestPythonEnvironment,
} from '../pipeline-python.server'
import type { PythonEnvironmentStatus } from '../pipeline-python.server'
import { resolveLimits, validateLimitOverrides } from './runtime-config'
import type {
  PluginEnvironmentState,
  PluginLimitOverrides,
  PluginRuntimeInfo,
} from './runtime-config'

export interface PluginRuntimeRow {
  extensionId: string
  requirements: string[]
  networkHosts: string[]
  limitOverrides: unknown
  environmentId: string | null
  environmentState: 'none' | 'building' | 'ready' | 'failed'
  environmentError: string | null
}

export interface RuntimeStore {
  load: (
    workspaceId: string,
    extensionId: string,
  ) => Promise<PluginRuntimeRow | null>
  loadByKey: (
    workspaceId: string,
    key: string,
  ) => Promise<PluginRuntimeRow | null>
  list: (workspaceId: string) => Promise<PluginRuntimeRow[]>
  saveEnvironment: (
    workspaceId: string,
    extensionId: string,
    environment: {
      id: string | null
      state: PluginRuntimeRow['environmentState']
      error: string | null
    },
  ) => Promise<void>
  saveOverrides: (
    workspaceId: string,
    extensionId: string,
    overrides: PluginLimitOverrides,
  ) => Promise<void>
  /** Records the packages and hosts of a freshly added or updated plugin. */
  saveDeclaration: (
    workspaceId: string,
    extensionId: string,
    declaration: { requirements: string[]; networkHosts: string[] },
  ) => Promise<void>
}

export interface EnvironmentRunner {
  request: (requirements: string[]) => Promise<PythonEnvironmentStatus>
  status: (id: string) => Promise<PythonEnvironmentStatus>
}

export const runnerEnvironments: EnvironmentRunner = {
  request: requestPythonEnvironment,
  status: getPythonEnvironment,
}

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'The packages could not be installed.'

/**
 * Asks the runner to install the plugin's packages (a no-op when they are
 * already there) and records where that stands. A runner that can't be reached
 * leaves the plugin's state alone, so the next call asks again.
 */
export async function ensureEnvironment(
  deps: { store: RuntimeStore; runner: EnvironmentRunner },
  workspaceId: string,
  row: PluginRuntimeRow,
): Promise<PluginRuntimeRow> {
  if (row.requirements.length === 0) {
    if (row.environmentState === 'none' && row.environmentId === null)
      return row
    await deps.store.saveEnvironment(workspaceId, row.extensionId, {
      id: null,
      state: 'none',
      error: null,
    })
    return {
      ...row,
      environmentId: null,
      environmentState: 'none',
      environmentError: null,
    }
  }
  let status: PythonEnvironmentStatus
  try {
    status = await deps.runner.request(row.requirements)
  } catch (error) {
    return {
      ...row,
      environmentState: 'failed',
      environmentError: message(error),
    }
  }
  const state: PluginRuntimeRow['environmentState'] =
    status.state === 'ready'
      ? 'ready'
      : status.state === 'failed'
        ? 'failed'
        : 'building'
  const next = {
    id: status.id,
    state,
    error: status.state === 'failed' ? (status.error ?? null) : null,
  }
  if (
    row.environmentId !== next.id ||
    row.environmentState !== next.state ||
    row.environmentError !== next.error
  )
    await deps.store.saveEnvironment(workspaceId, row.extensionId, next)
  return {
    ...row,
    environmentId: next.id,
    environmentState: next.state,
    environmentError: next.error,
  }
}

/** Follows a build the runner is doing, so the page shows where it is. */
export async function refreshEnvironment(
  deps: { store: RuntimeStore; runner: EnvironmentRunner },
  workspaceId: string,
  row: PluginRuntimeRow,
): Promise<{ row: PluginRuntimeRow; packages: Record<string, string> | null }> {
  if (row.requirements.length === 0) return { row, packages: null }
  if (!row.environmentId) {
    const asked = await ensureEnvironment(deps, workspaceId, row)
    return { row: asked, packages: null }
  }
  let status: PythonEnvironmentStatus
  try {
    status = await deps.runner.status(row.environmentId)
  } catch {
    return { row, packages: null }
  }
  if (status.state === 'missing') {
    // The runner lost it (a new runner, a pruned image): install again.
    const asked = await ensureEnvironment(deps, workspaceId, row)
    return { row: asked, packages: null }
  }
  const state: PluginRuntimeRow['environmentState'] =
    status.state === 'ready'
      ? 'ready'
      : status.state === 'failed'
        ? 'failed'
        : 'building'
  const error = status.state === 'failed' ? (status.error ?? null) : null
  if (row.environmentState !== state || row.environmentError !== error)
    await deps.store.saveEnvironment(workspaceId, row.extensionId, {
      id: row.environmentId,
      state,
      error,
    })
  return {
    row: { ...row, environmentState: state, environmentError: error },
    packages: status.packages ?? null,
  }
}

export function describeRuntime(
  row: PluginRuntimeRow,
  packages: Record<string, string> | null = null,
): PluginRuntimeInfo {
  const checked = validateLimitOverrides(row.limitOverrides)
  const overrides = checked.errors.length === 0 ? checked.value : {}
  const state: PluginEnvironmentState =
    row.requirements.length === 0 ? 'none' : row.environmentState
  return {
    extensionId: row.extensionId,
    requirements: row.requirements,
    network: row.networkHosts,
    overrides,
    limits: resolveLimits(overrides),
    environment: {
      state,
      error: row.environmentError,
      packages: state === 'ready' ? packages : null,
    },
  }
}

// ---------------------------------------------------------------------------
// Database-backed defaults.
// ---------------------------------------------------------------------------

function rowFrom(row: {
  extensionId: string
  requirements: string[]
  networkHosts: string[]
  limitOverrides: unknown
  environmentId: string | null
  environmentState: string
  environmentError: string | null
}): PluginRuntimeRow {
  return {
    ...row,
    environmentState:
      row.environmentState as PluginRuntimeRow['environmentState'],
  }
}

export function databaseStore(): RuntimeStore {
  const columns = async () => {
    const { extensionPackages } = await import('#/db/schema')
    return {
      table: extensionPackages,
      select: {
        extensionId: extensionPackages.extensionId,
        requirements: extensionPackages.requirements,
        networkHosts: extensionPackages.networkHosts,
        limitOverrides: extensionPackages.limitOverrides,
        environmentId: extensionPackages.environmentId,
        environmentState: extensionPackages.environmentState,
        environmentError: extensionPackages.environmentError,
      },
    }
  }
  return {
    async load(workspaceId, extensionId) {
      const { db } = await import('#/db/client.server')
      const { and, eq } = await import('drizzle-orm')
      const { table, select } = await columns()
      const rows = await db
        .select(select)
        .from(table)
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            eq(table.extensionId, extensionId),
          ),
        )
      return rows[0] ? rowFrom(rows[0]) : null
    },
    async loadByKey(workspaceId, key) {
      const { db } = await import('#/db/client.server')
      const { and, eq } = await import('drizzle-orm')
      const { extensions } = await import('#/db/schema')
      const { table, select } = await columns()
      const rows = await db
        .select(select)
        .from(table)
        .innerJoin(extensions, eq(extensions.id, table.extensionId))
        .where(and(eq(table.workspaceId, workspaceId), eq(extensions.key, key)))
      return rows[0] ? rowFrom(rows[0]) : null
    },
    async list(workspaceId) {
      const { db } = await import('#/db/client.server')
      const { eq } = await import('drizzle-orm')
      const { table, select } = await columns()
      const rows = await db
        .select(select)
        .from(table)
        .where(eq(table.workspaceId, workspaceId))
      return rows.map(rowFrom)
    },
    async saveEnvironment(workspaceId, extensionId, environment) {
      const { db } = await import('#/db/client.server')
      const { and, eq } = await import('drizzle-orm')
      const { table } = await columns()
      await db
        .update(table)
        .set({
          environmentId: environment.id,
          environmentState: environment.state,
          environmentError: environment.error,
          environmentUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            eq(table.extensionId, extensionId),
          ),
        )
    },
    async saveOverrides(workspaceId, extensionId, overrides) {
      const { db } = await import('#/db/client.server')
      const { and, eq } = await import('drizzle-orm')
      const { table } = await columns()
      await db
        .update(table)
        .set({ limitOverrides: overrides })
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            eq(table.extensionId, extensionId),
          ),
        )
    },
    async saveDeclaration(workspaceId, extensionId, declaration) {
      const { db } = await import('#/db/client.server')
      const { and, eq } = await import('drizzle-orm')
      const { table } = await columns()
      await db
        .update(table)
        .set({
          requirements: declaration.requirements,
          networkHosts: declaration.networkHosts,
        })
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            eq(table.extensionId, extensionId),
          ),
        )
    },
  }
}
