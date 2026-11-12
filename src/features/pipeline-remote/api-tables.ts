/**
 * Tables of this area that API tokens (and so MCP and the docs) can read,
 * with `lab:read`. Row security is the app's own: you see what you can see.
 */
import type { LabTable } from '#/lib/lab-api-surface'

export const PIPELINE_REMOTE_LAB_TABLES = {
  pipeline_remote_jobs: {
    summary:
      'The jobs pipeline runs sent to an HPC queue: where each went, its state (`submitted`, `running`, `succeeded`, `failed`, `cancelled`), why it failed (`reason`), its cluster job id and when it must finish. What the job reads and sends back is not here.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['run_id', 'uuid', 1],
      ['step_name', 'text', 1],
      ['connection_key', 'text', 1],
      ['queue', 'text', 1],
      ['secret_name', 'text', 0],
      ['external_job_id', 'text', 0],
      ['state', 'text', 1],
      ['reason', 'text', 0],
      ['message', 'text', 0],
      ['limit_minutes', 'int', 1],
      ['deadline_at', 'ts', 1],
      ['result_rows', 'int', 0],
      ['submitted_at', 'ts', 1],
      ['scheduler_done_at', 'ts', 0],
      ['finished_at', 'ts', 0],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
