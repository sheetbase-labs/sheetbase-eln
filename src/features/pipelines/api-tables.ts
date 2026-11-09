import type { LabTable } from '#/lib/lab-api-surface'

/**
 * Pipelines and plugins on the external API: schedules and what they did,
 * runs waiting for a person, signed run records, and the plugins installed in
 * the workspace. Pipeline tables are read with `pipelines:read`, like the
 * runs; plugins with `admin:read`. Listed on the feature, which adds them to `LAB_TABLES`.
 */
export const PIPELINE_LAB_TABLES = {
  pipeline_schedules: {
    summary:
      'When a pipeline runs by itself. `kind` is `interval`, `daily`, `cron` or `event`; `spec` holds `intervalMinutes`, `dailyAt`, `cron` or `eventType` (with its filters), plus the inputs and parameters it runs with. `enabled` is false while it is switched off.',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['definition_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['spec', 'json', 1],
      ['enabled', 'bool', 1],
      ['last_run_at', 'ts', 0],
      ['next_run_at', 'ts', 0],
      ['last_evaluated_at', 'ts', 0],
      ['last_evaluated_sequence', 'bigint', 0],
      ['input_watermarks', 'json', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  pipeline_schedule_activity: {
    summary:
      'Why a schedule did not run when it might have: `kind` is `skipped_missed`, `skipped_unchanged` (its inputs had not changed), `skipped_overlap` (the last run was still going), `skipped_no_version`, `input_unresolved` or `start_failed`, with a `message` saying more.',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['schedule_id', 'uuid', 1],
      ['kind', 'text', 1],
      ['occurrence_id', 'text', 0],
      ['message', 'text', 1],
      ['detail', 'json', 1],
      ['occurred_at', 'ts', 1],
    ],
  },
  pipeline_trigger_failures: {
    summary:
      'A time a schedule could not start its pipeline (a missing input, a version with errors). `status` is `pending` while it is tried again and `abandoned` once it gives up.',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['schedule_id', 'uuid', 1],
      ['trigger_occurrence_id', 'text', 1],
      ['event_id', 'uuid', 0],
      ['error_code', 'text', 1],
      ['error_message', 'text', 0],
      ['attempt', 'int', 1],
      ['status', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  pipeline_run_prompts: {
    summary:
      'A step where a run paused for a person to confirm. `asked_user_ids` are the people who may answer; `answer` holds their decision (`confirm`, `skip` or `stop`) once they have. Answering is done by that person in the app.',
    scope: 'pipelines:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['run_id', 'uuid', 1],
      ['step_id', 'text', 1],
      ['form_schema', 'json', 1],
      ['asked_user_ids', 'text[]', 1],
      ['answer', 'json', 0],
      ['answered_by_user_id', 'text', 0],
      ['answered_at', 'ts', 0],
      ['expires_at', 'ts', 0],
      ['created_at', 'ts', 1],
    ],
  },
  pipeline_run_manifests: {
    summary:
      'The record of exactly what a run used and made (version, inputs, code, environment, outputs), chained by digest and signed when the workspace has a signing key. Check one with `GET /api/pipelines/manifest`.',
    scope: 'pipelines:read',
    columns: [
      ['run_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['sequence', 'bigint', 1],
      ['manifest', 'json', 1],
      ['manifest_digest', 'text', 1],
      ['previous_digest', 'text', 0],
      ['signature', 'text', 0],
      ['signature_algorithm', 'text', 0],
      ['key_id', 'text', 0],
      ['signed_at', 'ts', 1],
    ],
  },
  pipeline_artefact_releases: {
    summary:
      'Whether a finished run kept its working files (`kept`) or they were deleted, and when.',
    scope: 'pipelines:read',
    columns: [
      ['run_id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['kept', 'bool', 1],
      ['released_at', 'ts', 1],
    ],
  },
  extensions: {
    summary:
      'The plugins installed in the workspace. `key` is its name here, `status` is `installed`, `enabled` or `disabled`, `manifest` is what it declares (its parts, permissions and the hosts it may reach) and `disabled_points` the parts an administrator switched off. The code itself is never readable.',
    scope: 'admin:read',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['key', 'text', 1],
      ['name', 'text', 1],
      ['version', 'text', 1],
      ['source', 'text', 1],
      ['manifest', 'json', 1],
      ['status', 'text', 1],
      ['disabled_points', 'text[]', 1],
      ['credential_id', 'uuid', 0],
      ['created_by_user_id', 'text', 0],
      ['updated_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
