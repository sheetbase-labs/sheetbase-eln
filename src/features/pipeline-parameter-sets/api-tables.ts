import type { LabTable } from '#/lib/lab-api-surface'

/** Parameter sets on the external API, read with `pipelines:read`. */
export const PARAMETER_SET_LAB_TABLES = {
  pipeline_parameter_sets: {
    summary:
      'Reusable named lists of pipeline parameters. `key` is what a version file lists under `include:`, `parameters` is the list (`name`, `type`, `required`, `default`, `description`).',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['key', 'text', 1],
      ['name', 'text', 1],
      ['description', 'text', 0],
      ['parameters', 'json', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
