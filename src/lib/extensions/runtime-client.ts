/**
 * Browser side of `GET/POST /api/plugins/runtime`: each plugin's Python
 * packages, approved hosts, run limits and where its packages stand.
 */
import { z } from 'zod'

import type {
  PluginLimitOverrides,
  PluginLimits,
  PluginRuntimeInfo,
} from './runtime-config'

export const pluginRuntimeQueryKey = ['plugins', 'runtime'] as const

/** The limits a plugin runs with, as the settings route reports them. */
const pluginLimitsSchema = z.object({
  timeoutSeconds: z.number(),
  memoryMb: z.number(),
  cpus: z.number(),
  processes: z.number(),
  scratchMb: z.number(),
  dataMb: z.number(),
  rows: z.number(),
  callsPerMinute: z.number().nullable(),
}) satisfies z.ZodType<PluginLimits>

/** Only what an administrator changed from the defaults. */
const pluginLimitOverridesSchema = z.object({
  timeoutSeconds: z.number().optional(),
  memoryMb: z.number().optional(),
  cpus: z.number().optional(),
  processes: z.number().optional(),
  scratchMb: z.number().optional(),
  dataMb: z.number().optional(),
  rows: z.number().optional(),
  callsPerMinute: z.number().nullable().optional(),
}) satisfies z.ZodType<PluginLimitOverrides>

/** One plugin's runtime, as `/api/plugins/runtime` describes it. */
const pluginRuntimeInfoSchema = z.object({
  extensionId: z.string(),
  requirements: z.array(z.string()),
  network: z.array(z.string()),
  overrides: pluginLimitOverridesSchema,
  limits: pluginLimitsSchema,
  environment: z.object({
    state: z.enum(['none', 'building', 'ready', 'failed', 'unavailable']),
    error: z.string().nullable(),
    packages: z.record(z.string(), z.string()).nullable(),
  }),
}) satisfies z.ZodType<PluginRuntimeInfo>

/** The route's answer: one plugin's runtime, every plugin's, or a refusal. */
const runtimeAnswerSchema = z.object({
  runtime: z
    .union([pluginRuntimeInfoSchema, z.array(pluginRuntimeInfoSchema)])
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

async function answer(response: Response): Promise<PluginRuntimeInfo[]> {
  const body = runtimeAnswerSchema.safeParse(
    await response.json().catch(() => null),
  )

  const runtime = body.success ? body.data.runtime : undefined

  if (!response.ok || !runtime)
    throw new Error(
      (body.success ? body.data.error?.message : undefined) ??
        'The plugin settings could not be read.',
    )

  return Array.isArray(runtime) ? runtime : [runtime]
}

export async function listPluginRuntime(): Promise<PluginRuntimeInfo[]> {
  return answer(await fetch('/api/plugins/runtime', { cache: 'no-store' }))
}

/** What a settings change asks the route to do. */
type PluginRuntimeRequest =
  | { action: 'set-limits'; extensionId: string; limits: PluginLimitOverrides }
  | { action: 'reinstall-packages'; extensionId: string }

function post(body: PluginRuntimeRequest) {
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
