import type { LabTable } from '#/lib/lab-api-surface'

/**
 * Pipeline connections on the external API. The secret values are sealed in
 * `internal.pipeline_connection_secrets` and are on no surface; `secret_names`
 * lists the names only. Read with `pipelines:read`, so a token that authors pipelines can list and reference them.
 */
export const PIPELINE_CONNECTION_LAB_TABLES = {
  pipeline_connections: {
    summary:
      'The https addresses pipeline web call steps may call. `key` is what a step names; `status` is `active` or `off`; `secret_names` lists the names of the secrets stored for it (never their values).',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['key', 'text', 1],
      ['name', 'text', 1],
      ['description', 'text', 0],
      ['base_url', 'text', 1],
      ['auth_header', 'text', 1],
      ['auth_scheme', 'text', 1],
      ['status', 'text', 1],
      ['secret_names', 'text[]', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 0],
      ['updated_by_user_id', 'text', 0],
    ],
  },
} as const satisfies Record<string, LabTable>
