/**
 * Browser side of a plugin's Logs view: its recent runs, from the
 * `extension_run_logs` table (administrators only; the database checks it).
 */
import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'

export const pluginRunLogSchema = z.object({
  id: z.string(),
  kind: z.string(),
  entry: z.string(),
  ok: z.boolean(),
  duration_ms: z.number(),
  error: z.string().nullable(),
  output: z.array(z.string()),
  created_at: z.string(),
})

export type PluginRunLog = z.infer<typeof pluginRunLogSchema>

export const pluginRunLogsQueryKey = (extensionId: string) =>
  ['plugins', 'run-logs', extensionId] as const

/** The plugin's newest runs first; a plugin keeps at most 200. */
export async function listPluginRunLogs(
  client: DataClient,
  extensionId: string,
): Promise<PluginRunLog[]> {
  const rows = await client.list<unknown>(
    'extension_run_logs',
    `?select=id,kind,entry,ok,duration_ms,error,output,created_at&extension_id=eq.${encodeURIComponent(extensionId)}&order=created_at.desc&limit=200`,
  )

  return z.array(pluginRunLogSchema).parse(rows)
}
