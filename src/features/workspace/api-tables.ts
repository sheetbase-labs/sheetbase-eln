/**
 * Tables of this area that API tokens (and so MCP and the docs) can read,
 * with `lab:read`. Row security is the app's own: you see what you can see.
 */
import type { LabTable } from '#/lib/lab-api-surface'

export const WORKSPACE_LAB_TABLES = {
  workspace_join_domains: {
    summary:
      'Email domains whose people can join the workspace themselves, and the role they join as. Change them with `set_join_domains`.',
    columns: [
      ['domain', 'text', 1],
      ['workspace_id', 'uuid', 1],
      ['role', 'text', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  configuration_change_log: {
    summary:
      'Configuration changes made in bulk (record types, tables, templates), each with who made it, what kind it was and its result.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['request_digest', 'text', 1],
      ['result', 'json', 1],
      ['actor_user_id', 'text', 1],
      ['created_at', 'ts', 1],
      ['idempotency_key', 'text', 1],
    ],
  },
  search_documents: {
    summary:
      'What search finds: one row for each record, file, dataset, sheet, project and other thing you can see, with its title, ID, text and link. Filter `title`, `identifier` or `body` with `ilike`.',
    columns: [
      ['object_type', 'text', 1],
      ['object_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['parent_type', 'text', 0],
      ['parent_id', 'uuid', 0],
      ['project_id', 'uuid', 0],
      ['kind', 'text', 1],
      ['status', 'text', 1],
      ['owner_user_id', 'text', 0],
      ['tags', 'text[]', 1],
      ['created_at', 'ts', 0],
      ['updated_at', 'ts', 0],
      ['archived', 'bool', 1],
      ['title', 'text', 1],
      ['identifier', 'text', 1],
      ['body', 'text', 1],
      ['fields', 'json', 1],
      ['deep_link', 'text', 1],
    ],
  },
  studies: {
    summary:
      'The study details of a study record: its summary, dates and plan version. The study itself is a record (`record_id`).',
    columns: [
      ['record_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['summary', 'text', 0],
      ['starts_on', 'date', 0],
      ['ends_on', 'date', 0],
      ['plan_version', 'int', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
      ['created_by_user_id', 'text', 1],
      ['updated_by_user_id', 'text', 0],
    ],
  },
  sheet_cell_conflicts: {
    summary:
      'Sheet cells that changed in two places while one was offline: both values, who and when, and how it was settled. Settle one with `resolve_cell_conflict`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['sheet_instance_id', 'uuid', 1],
      ['row_key', 'text', 1],
      ['field_id', 'uuid', 1],
      ['local_value', 'json', 0],
      ['local_author_user_id', 'text', 1],
      ['local_at', 'ts', 1],
      ['remote_value', 'json', 0],
      ['remote_author_user_id', 'text', 0],
      ['remote_at', 'ts', 0],
      ['state', 'text', 1],
      ['resolved_value', 'json', 0],
      ['resolved_by_user_id', 'text', 0],
      ['resolved_at', 'ts', 0],
      ['reason', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
