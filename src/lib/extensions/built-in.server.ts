/**
 * The plugins that ship with Sheetbase, under `plugins/` in the app folder:
 * sequence tools (molecular biology) and chemistry.
 *
 * They are ordinary plugins. They are installed from those folders with fixed
 * keys (the sequence-block migration and the chemistry adoption refer to them
 * by key), and an administrator can switch any of their points off or turn the
 * whole plugin off in Settings → Plugins, like any other.
 *
 * `ensureBuiltInPlugins` is safe to call any time: it installs what is
 * missing and updates what is out of date. A plugin an administrator turned
 * off on purpose stays off.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { eq } from 'drizzle-orm'

import type { DataClient } from '../data-client'
import { enableExtension, listExtensions } from './client'
import type { ExtensionWire } from './client'
import { defaultDeps, installPluginPackage } from './install.server'
import type { PluginInstallDeps } from './install.server'
import { buildPluginPackage, hashPluginFiles } from './package'
import type { PluginPackage } from './package'

export interface BuiltInPlugin {
  /** Folder under `plugins/`. */
  folder: string
  /** The key the install gets. */
  key: string
}

export const BUILT_IN_PLUGINS: readonly BuiltInPlugin[] = [
  { folder: 'sequence-tools', key: 'sequence-tools' },
  { folder: 'chemistry', key: 'chemistry' },
]

/** The folders and files of a package: everything else in a plugin folder (sources, tests, vectors) stays out. */
const PACKAGE_ROOTS = ['python', 'ui'] as const
const ROOT_FILES = ['plugin.json', 'README.md', 'LICENSE']

export function pluginsDirectory(): string {
  return resolve(process.env.SHEETBASE_PLUGINS_DIR ?? 'plugins')
}

async function collect(
  base: string,
  relative: string,
  out: Record<string, string>,
): Promise<void> {
  const entries = await readdir(join(base, relative), { withFileTypes: true })
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name === 'node_modules')
        continue
      await collect(base, path, out)
    } else if (entry.isFile()) {
      if (relative.startsWith('python') && !entry.name.endsWith('.py')) continue
      // The UI SDK is added by Sheetbase when a screen is served.
      if (entry.name === 'sheetbase-ui.js') continue
      out[path] = await readFile(join(base, path), 'utf8')
    }
  }
}

/** Reads one built-in plugin folder into a checked package. */
export async function readBuiltInPackage(
  plugin: BuiltInPlugin,
  directory: string = pluginsDirectory(),
): Promise<PluginPackage> {
  const base = join(directory, plugin.folder)
  const files: Record<string, string> = {}
  for (const name of ROOT_FILES) {
    try {
      files[name] = await readFile(join(base, name), 'utf8')
    } catch {
      // Optional files.
    }
  }
  for (const root of PACKAGE_ROOTS) {
    try {
      await collect(base, root, files)
    } catch {
      // A plugin may have no ui/ or python/ folder.
    }
  }
  const built = buildPluginPackage(files)
  return { ...built, sha256: await hashPluginFiles(files) }
}

async function storedHash(extensionId: string): Promise<string | null> {
  const { db } = await import('#/db/client.server')
  const { extensionPackages } = await import('#/db/schema')
  const rows = await db
    .select({ sha256: extensionPackages.sha256 })
    .from(extensionPackages)
    .where(eq(extensionPackages.extensionId, extensionId))
  return rows[0]?.sha256 ?? null
}

export interface BuiltInResult {
  key: string
  action: 'installed' | 'updated' | 'unchanged'
}

/**
 * Brings every built-in plugin up to date in the workspace. `client` must act
 * for an owner or administrator (installing is an administrator's right).
 */
export async function ensureBuiltInPlugins(
  client: DataClient,
  context: { workspaceId: string; userId: string },
  options: {
    deps?: PluginInstallDeps
    directory?: string
    plugins?: readonly BuiltInPlugin[]
    hashOf?: (extensionId: string) => Promise<string | null>
  } = {},
): Promise<BuiltInResult[]> {
  const deps = options.deps ?? defaultDeps()
  const hashOf = options.hashOf ?? storedHash
  const results: BuiltInResult[] = []
  const installs = await listExtensions(client)
  for (const plugin of options.plugins ?? BUILT_IN_PLUGINS) {
    const pkg = await readBuiltInPackage(plugin, options.directory)
    const existing = installs.find(
      (install) => install.manifest.id === pkg.manifest.id,
    )
    let current: ExtensionWire | undefined = existing
    let action: BuiltInResult['action'] = 'unchanged'
    if (!existing || (await hashOf(existing.id)) !== pkg.sha256) {
      current = await installPluginPackage(deps, client, context, pkg, {
        existing,
        taken: new Set(installs.map((i) => i.key)),
        key: plugin.key,
      })
      action = existing ? 'updated' : 'installed'
    }
    // A first install is switched on for the administrator. An update comes
    // back switched off, so it goes back to what it was; a plugin an
    // administrator turned off stays off.
    if (
      current &&
      current.status !== 'enabled' &&
      (action === 'installed' || existing?.status === 'enabled')
    )
      await enableExtension(client, {
        workspaceId: context.workspaceId,
        extensionId: current.id,
      })
    results.push({ key: plugin.key, action })
  }
  return results
}
