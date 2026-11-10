/**
 * POST /api/plugins/install: an administrator uploads a `.sbplugin` file.
 *
 * Two steps, so nothing is installed before it has been read and agreed to:
 *
 * - `?mode=check` unpacks the file, validates it and answers with what it asks
 *   for and what it adds, plus how it differs from the install that is already
 *   there. Nothing is stored.
 * - `?mode=install&acknowledge=1` does the same and then installs it (or
 *   updates the existing install, which comes back switched off until it is
 *   reviewed again), and stores the code.
 *
 * Signed in, or a personal API token with `admin:write` (a script or CI job
 * that ships a plugin); `api.extensions.manage` (owners and admins) is checked
 * by the database before anything is read or written, exactly as for enabling
 * and removing. The code is stored by the server and never readable through
 * the API.
 */
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolvePersonalAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { installExtension, listExtensions, updateExtension } from './client'
import type { ExtensionWire } from './client'
import {
  PluginPackageError,
  PLUGIN_MAX_ARCHIVE_BYTES,
  readPluginPackage,
} from './package'
import type { PluginPackage } from './package'
import { describeRunnerAdds } from './runner-points'
import type { ExtensionAdds } from './runner-points'
import {
  databaseStore,
  ensureEnvironment,
  runnerEnvironments,
} from './runtime-settings.server'
import type { EnvironmentRunner, RuntimeStore } from './runtime-settings.server'

export interface PluginInstallDeps {
  auth: SessionAuthDeps
  makeClient: (token: string) => DataClient
  /** Stores (or replaces) the install's code. */
  savePackage: (input: {
    workspaceId: string
    extensionId: string
    userId: string
    pkg: PluginPackage
  }) => Promise<void>
  /** Where the plugin's Python settings are kept, and the runner that installs its packages. */
  runtime?: { store: RuntimeStore; runner: EnvironmentRunner }
}

export interface PluginCheckResult {
  id: string
  name: string
  version: string
  description: string
  author: string | null
  permissions: string[]
  adds: ExtensionAdds[]
  fileCount: number
  size: number
  sha256: string
  /** The Python packages it installs and the hosts it asks to reach: what the administrator approves. */
  python: { requirements: string[]; network: string[] }
  /** The install already in this workspace with the same plugin id, if any. */
  existing: { key: string; version: string; status: string } | null
  /** Contributions the new version adds and drops compared with the existing one. */
  changes: { added: string[]; removed: string[] }
  examples: number
  /** The package brings its own screens, drawn in a sandboxed frame. */
  hasUi: boolean
}

const sum = (adds: ExtensionAdds[]) =>
  adds.flatMap((add) => add.items.map((item) => `${add.point}:${item.id}`))

export function describePlugin(
  pkg: PluginPackage,
  existing: ExtensionWire | undefined,
): PluginCheckResult {
  const adds = describeRunnerAdds(pkg.manifest)
  const before = existing ? sum(describeRunnerAdds(existing.manifest)) : []
  const after = sum(adds)
  const beforeIds = new Set(before)
  const afterIds = new Set(after)

  return {
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    description: pkg.manifest.description ?? '',
    author: pkg.manifest.author ?? null,
    permissions: pkg.manifest.scopes,
    python: {
      requirements: pkg.manifest.python?.requirements ?? [],
      network: pkg.manifest.python?.network ?? [],
    },
    adds,
    fileCount: Object.keys(pkg.files).length,
    size: pkg.size,
    sha256: pkg.sha256,
    existing: existing
      ? {
          key: existing.key,
          version: existing.version,
          status: existing.status,
        }
      : null,
    changes: {
      added: after.filter((item) => !beforeIds.has(item)),
      removed: before.filter((item) => !afterIds.has(item)),
    },
    examples: pkg.examples.length,
    hasUi: Object.keys(pkg.files).some((name) => name.startsWith('ui/')),
  }
}

/** `acme.cell-count` becomes `cell-count`; a taken key gets `-2`, `-3`… */
export function pluginKeyFor(
  manifestId: string,
  taken: ReadonlySet<string>,
): string {
  const base = (manifestId.split('.').at(-1) ?? 'plugin').slice(0, 44)

  if (!taken.has(base)) return base

  for (let n = 2; n < 100; n += 1)
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  throw new Error('No free name for this plugin.')
}

export async function handlePluginInstall(
  request: Request,
  deps: PluginInstallDeps = defaultDeps(),
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')

  const auth = await resolvePersonalAuth(
    request.headers,
    'admin:write',
    deps.auth,
  )

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const client = deps.makeClient(context.token)

  try {
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'extensions.manage',
    })
  } catch {
    return requestErrorResponse(
      403,
      'forbidden',
      'Only an owner or administrator can install plugins.',
    )
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') === 'install' ? 'install' : 'check'
  const declared = Number(request.headers.get('content-length') ?? 0)

  if (declared > PLUGIN_MAX_ARCHIVE_BYTES)
    return requestErrorResponse(
      413,
      'too_large',
      'That file is too large to be a plugin.',
    )
  const bytes = new Uint8Array(await request.arrayBuffer())
  let pkg: PluginPackage

  try {
    pkg = await readPluginPackage(bytes)
  } catch (error) {
    if (error instanceof PluginPackageError)
      return Response.json(
        {
          error: {
            code: 'invalid_package',
            message: error.message,
            problems: error.errors,
          },
        },
        { status: 400 },
      )
    throw error
  }

  const installs = await listExtensions(client)

  const existing = installs.find(
    (install) => install.manifest.id === pkg.manifest.id,
  )

  const summary = describePlugin(pkg, existing)

  if (mode === 'check') return Response.json({ plugin: summary })

  if (url.searchParams.get('acknowledge') !== '1')
    return requestErrorResponse(
      400,
      'not_acknowledged',
      'Say that you have read what this plugin does and trust it before installing.',
    )
  let installed: ExtensionWire

  try {
    installed = await installPluginPackage(deps, client, context, pkg, {
      existing,
      taken: new Set(installs.map((i) => i.key)),
    })
  } catch (error) {
    return requestErrorResponse(
      409,
      'install_refused',
      error instanceof Error
        ? error.message
        : 'The plugin could not be installed.',
    )
  }

  return Response.json({ plugin: summary, extension: installed })
}

/**
 * Installs a package, or updates the install it replaces, stores its code and
 * starts its Python environment. Shared by the upload route and the built-in
 * plugins (`built-in.server.ts`).
 */
export async function installPluginPackage(
  deps: PluginInstallDeps,
  client: DataClient,
  context: { workspaceId: string; userId: string },
  pkg: PluginPackage,
  options: {
    existing: ExtensionWire | undefined
    taken: ReadonlySet<string>
    /** A fixed key, for plugins that ship with Sheetbase. */
    key?: string
  },
): Promise<ExtensionWire> {
  const { existing } = options

  const installed = existing
    ? await updateExtension(client, {
        workspaceId: context.workspaceId,
        extensionId: existing.id,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        source: pkg.manifest.source,
        manifest: pkg.manifest,
        acknowledgeUntrusted: true,
      })
    : await installExtension(client, {
        workspaceId: context.workspaceId,
        key: options.key ?? pluginKeyFor(pkg.manifest.id, options.taken),
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        source: pkg.manifest.source,
        manifest: pkg.manifest,
        acknowledgeUntrusted: true,
      })

  await deps.savePackage({
    workspaceId: context.workspaceId,
    extensionId: installed.id,
    userId: context.userId,
    pkg,
  })
  // Install the plugin's Python packages now, so no call ever waits on pip. The
  // runner builds in the background; Settings → Plugins shows where it stands.
  const runtime = deps.runtime

  if (runtime) {
    const row = await runtime.store.load(context.workspaceId, installed.id)

    if (row)
      await ensureEnvironment(
        { store: runtime.store, runner: runtime.runner },
        context.workspaceId,
        row,
      ).catch(() => undefined)
  }

  return installed
}

export function defaultDeps(): PluginInstallDeps {
  return {
    auth: realSessionAuthDeps,
    makeClient: createServerDataClient,
    runtime: { store: databaseStore(), runner: runnerEnvironments },
    savePackage: async ({ workspaceId, extensionId, userId, pkg }) => {
      const [{ db }, { extensionPackages }] = await Promise.all([
        import('#/db/client.server'),
        import('#/db/schema'),
      ])

      await db
        .insert(extensionPackages)
        .values({
          extensionId,
          workspaceId,
          sha256: pkg.sha256,
          size: pkg.size,
          files: pkg.files,
          requirements: pkg.manifest.python?.requirements ?? [],
          networkHosts: pkg.manifest.python?.network ?? [],
          uploadedByUserId: userId,
        })
        .onConflictDoUpdate({
          target: extensionPackages.extensionId,
          // The administrator's own limits are not in this list: an update keeps them.
          set: {
            sha256: pkg.sha256,
            size: pkg.size,
            files: pkg.files,
            requirements: pkg.manifest.python?.requirements ?? [],
            networkHosts: pkg.manifest.python?.network ?? [],
            uploadedByUserId: userId,
            updatedAt: new Date(),
          },
        })
    },
  }
}
