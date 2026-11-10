/**
 * Browser side of `GET/POST /api/plugins/runtime`: each plugin's Python
 * packages, approved hosts, run limits and where its packages stand.
 */
import type { PluginLimitOverrides, PluginRuntimeInfo } from './runtime-config'

export const pluginRuntimeQueryKey = ['plugins', 'runtime'] as const

async function answer(response: Response): Promise<PluginRuntimeInfo[]> {
  const body = (await response.json().catch(() => null)) as {
    runtime?: PluginRuntimeInfo | PluginRuntimeInfo[]
    error?: { message?: string }
  } | null

  if (!response.ok || !body?.runtime)
    throw new Error(
      body?.error?.message ?? 'The plugin settings could not be read.',
    )

  return Array.isArray(body.runtime) ? body.runtime : [body.runtime]
}

export async function listPluginRuntime(): Promise<PluginRuntimeInfo[]> {
  return answer(await fetch('/api/plugins/runtime', { cache: 'no-store' }))
}

function post(body: Record<string, unknown>) {
  return fetch('/api/plugins/runtime', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Saves a plugin's limits: only what differs from the defaults. */
export async function setPluginLimits(
  extensionId: string,
  limits: PluginLimitOverrides,
): Promise<PluginRuntimeInfo> {
  const [info] = await answer(
    await post({ action: 'set-limits', extensionId, limits }),
  )

  return info
}

/** Installs a plugin's Python packages again, after a failure. */
export async function reinstallPluginPackages(
  extensionId: string,
): Promise<PluginRuntimeInfo> {
  const [info] = await answer(
    await post({ action: 'reinstall-packages', extensionId }),
  )

  return info
}
