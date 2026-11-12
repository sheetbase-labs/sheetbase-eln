/**
 * What the editor and Settings read about the two outside-the-run steps:
 * the remote job connections a steward set up, the open tables a lakehouse
 * step may read, and the steward's switch. Plain reads through the data client.
 */
import { z } from 'zod'

import type { DataClient } from '../../data-client'
import { REMOTE_CONNECTION_RE } from './settings'

export type RemoteQueueOption = {
  name: string
  maxMinutes?: number
}

export interface RemoteConnectionOption {
  id: string
  key: string
  name: string
  status: string
  baseUrl: string
  user: string
  callbackUrl: string
  /** The names of the secrets sealed on the connection; never their values. */
  secrets: string[]
  queues: RemoteQueueOption[]
}

/** What a remote job connection keeps in its connector's settings. */
export type HpcConnectorConfig = {
  adapter: 'hpc'
  scheduler: 'slurm'
  baseUrl: string
  user: string
  queues: Array<{ name: string; maxMinutes?: number }>
  callbackUrl?: string
  secrets?: string[]
}

export interface LakehouseSettings {
  /** A steward has let pipelines read the open tables. */
  enabled: boolean
  /** The open tables themselves are on. */
  lakeEnabled: boolean
  tableCount: number
}

export interface LakeTableOption {
  name: string
  rows: number
}

const connectorRow = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  status: z.string(),
  config: z.unknown(),
})

const hpcConfig = z.object({
  adapter: z.literal('hpc'),
  baseUrl: z.string().catch(''),
  user: z.string().catch(''),
  callbackUrl: z.string().catch(''),
  secrets: z.array(z.string()).catch([]),
  queues: z
    .array(
      z.object({
        name: z.string(),
        maxMinutes: z.number().int().positive().optional(),
      }),
    )
    .catch([]),
})

export const remoteKeys = {
  connections: ['pipelines', 'remote-connections'] as const,
  lakehouse: ['pipelines', 'lakehouse-settings'] as const,
  tables: ['pipelines', 'lake-tables'] as const,
}

/** The remote job connections of the workspace: connectors that adapt to a cluster. */
export async function fetchRemoteConnections(
  client: DataClient,
): Promise<RemoteConnectionOption[]> {
  const rows = await client.list<unknown>(
    'connectors',
    '?select=id,key,name,status,config&connector_type=eq.custom&status=neq.archived&order=name.asc',
  )

  return rows.flatMap((row) => {
    const parsed = connectorRow.safeParse(row)

    if (!parsed.success || !REMOTE_CONNECTION_RE.test(parsed.data.key))
      return []
    const config = hpcConfig.safeParse(parsed.data.config)

    // Other custom connectors share the table; only a cluster's settings say adapter hpc.
    if (!config.success) return []

    return [
      {
        id: parsed.data.id,
        key: parsed.data.key,
        name: parsed.data.name,
        status: parsed.data.status,
        baseUrl: config.data.baseUrl,
        user: config.data.user,
        callbackUrl: config.data.callbackUrl,
        secrets: config.data.secrets,
        queues: config.data.queues,
      },
    ]
  })
}

export function fetchLakehouseSettings(
  client: DataClient,
  workspaceId: string,
): Promise<LakehouseSettings> {
  return client.rpc<LakehouseSettings>('pipeline_lakehouse_settings', {
    p_workspace_id: workspaceId,
  })
}

export function setLakehouseSql(
  client: DataClient,
  workspaceId: string,
  enabled: boolean,
): Promise<LakehouseSettings> {
  return client.rpc<LakehouseSettings>('set_pipeline_lakehouse_sql', {
    p_workspace_id: workspaceId,
    p_enabled: enabled,
  })
}

const tableRow = z.object({
  table_name: z.string(),
  row_count: z.number().nullable().catch(null),
})

/** The open tables a lakehouse step may read: those that are written and ready. */
export async function fetchLakeTableOptions(
  client: DataClient,
): Promise<LakeTableOption[]> {
  const rows = await client.list<unknown>(
    'lake_tables',
    '?select=table_name,row_count&status=eq.ready&order=table_name.asc',
  )

  return rows.flatMap((row) => {
    const parsed = tableRow.safeParse(row)

    return parsed.success
      ? [{ name: parsed.data.table_name, rows: parsed.data.row_count ?? 0 }]
      : []
  })
}

/** A job a run sent to a cluster, as the run page shows it. */
export interface RunRemoteJob {
  id: string
  step_name: string
  connection_key: string
  queue: string
  external_job_id: string | null
  state: 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  reason: string | null
  message: string | null
  limit_minutes: number
  deadline_at: string
  result_rows: number | null
  submitted_at: string
  finished_at: string | null
}

const runJobFields =
  'id,step_name,connection_key,queue,external_job_id,state,reason,message,limit_minutes,deadline_at,result_rows,submitted_at,finished_at'

export function fetchRunRemoteJobs(
  client: DataClient,
  runId: string,
): Promise<RunRemoteJob[]> {
  return client.list<RunRemoteJob>(
    'pipeline_remote_jobs',
    `?select=${runJobFields}&run_id=eq.${encodeURIComponent(runId)}&order=submitted_at.asc`,
  )
}

/** The job a waiting run is paused on: the newest one still going. */
export function openRemoteJob(jobs: RunRemoteJob[]): RunRemoteJob | undefined {
  return jobs
    .filter((job) => job.state === 'submitted' || job.state === 'running')
    .at(-1)
}
