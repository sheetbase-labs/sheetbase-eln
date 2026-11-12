/**
 * Pipelines and plugins: making and publishing pipelines, running, retrying
 * and cancelling runs, their schedules, and switching plugins on and off.
 * Declared once, so the public API, the Python and TypeScript SDKs, MCP
 * (`sheetbase.lab.act`), the assistant and pipeline actions all come from
 * these entries. Their webhook events are the pipeline and plugin entries of
 * the event catalogue.
 *
 * Everything here acts as the person (or the personal token) that calls it,
 * so the database's own checks apply: stewards and up make pipelines and ask
 * for them to be published (an admin approves, see `pipeline-approvals`), anyone who can write runs them, and owners and admins manage
 * plugins. Answering a run that waits for a person stays with that person in
 * the app.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

/** The workspace of the call: a pipeline step fills it in itself. */
const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

const runId = (): OperationInput => ({
  ...input('p_run_id', 'uuid'),
  description: 'The pipeline run, from `pipeline_runs`.',
})

const extensionId = (): OperationInput => ({
  ...input('p_extension_id', 'uuid'),
  description: 'The installed plugin, from `extensions`.',
})

/** An input with its one line for the docs and for agents. */
const described = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

const definitionId = () =>
  described(
    'p_definition_id',
    'uuid',
    'The pipeline, from `pipeline_definitions`.',
  )

const versionId = () =>
  described(
    'p_version_id',
    'uuid',
    'The version, from `pipeline_definition_versions`.',
  )

const scheduleId = () =>
  described('p_schedule_id', 'uuid', 'The schedule, from `pipeline_schedules`.')

const parameters = () =>
  described(
    'p_parameters',
    'json',
    'The pipeline’s parameters, by name. Leave out for the defaults.',
    false,
  )

const inputVersions = () =>
  described(
    'p_input_versions',
    'json',
    'Each input’s name to the dataset version id it reads.',
    false,
  )

export const PIPELINES_EXTENSIONS_OPERATIONS = defineOperations([
  // -- Pipelines and versions -------------------------------------------------
  {
    name: 'create_pipeline_definition',
    label: 'Create a pipeline',
    summary: 'Create a pipeline',
    description:
      'Creates an empty pipeline with a key (letters, digits and `_`, unique in the workspace) and a name. Save its first version with `create_pipeline_definition_version` and publish it to run it. Stewards, admins and owners. Returns the pipeline. Sends `pipeline.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      { ...input('p_key', 'text'), description: 'The pipeline’s key.' },
      described('p_name', 'text', 'Name.'),
      described('p_description', 'text', 'What it does, in a sentence.', false),
    ],
    result: 'row:pipeline_definitions',
  },
  {
    name: 'update_pipeline_definition',
    label: 'Rename or retire a pipeline',
    summary: 'Change or retire a pipeline',
    description:
      'Changes a pipeline’s name or description, or retires it (`p_lifecycle` `retired`) so it cannot be run any more; `active` brings it back. Stewards, admins and owners. Leave a field out to keep it. Returns the pipeline. Sends `pipeline.updated`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      definitionId(),
      described('p_name', 'text', 'A new name.', false),
      described('p_description', 'text', 'What it does, in a sentence.', false),
      {
        ...input('p_lifecycle', 'text', false),
        description: '`active` or `retired`.',
      },
    ],
    result: 'row:pipeline_definitions',
    assistant: { tool: 'sheetbase.pipeline.retire' },
  },
  {
    name: 'retire_pipeline_definition_version',
    label: 'Retire a pipeline version',
    summary: 'Retire a pipeline version',
    description:
      'Retires a published version so new runs cannot use it. Runs that used it keep it, and a failed one can still be retried on it. Returns the version. Sends `pipeline.version.retired`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [workspace(), versionId()],
    result: 'row:pipeline_definition_versions',
  },
  // -- Runs -------------------------------------------------------------------
  {
    name: 'run_pipeline_version',
    label: 'Run a pipeline version',
    summary: 'Run one pipeline version',
    description:
      'Starts a run of one exact published version, as the person the token belongs to, so a script that tested version 4 runs version 4 even after a newer one is published. `p_parameters` sets the pipeline’s parameters and `p_input_versions` maps each input name to the dataset version to read. Returns the run straight away; follow it on `pipeline_runs`. Sends `pipeline.run.created`, then `pipeline.run.succeeded` or `pipeline.run.failed`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [versionId(), parameters(), inputVersions()],
    result: 'row:pipeline_runs',
    assistant: { tool: 'sheetbase.pipeline.run' },
    pipeline: {},
  },
  {
    name: 'retry_pipeline_run',
    label: 'Retry a pipeline run',
    summary: 'Retry a failed run',
    description:
      'Runs a failed or cancelled run again, on the same version with the same parameters and inputs, as the Retry button does. The new run points back at the old one (`retry_of_run_id`). Returns the new run. Sends `pipeline.run.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [runId()],
    result: 'row:pipeline_runs',
    assistant: { tool: 'sheetbase.pipeline.retry' },
    pipeline: {},
  },
  {
    name: 'cancel_pipeline_run',
    label: 'Cancel a pipeline run',
    summary: 'Cancel a run',
    description:
      'Stops a running run. The person who started it, or a steward, admin or owner, can cancel it. Returns the run. Sends `pipeline.run.cancelled`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [workspace(), runId()],
    result: 'row:pipeline_runs',
    assistant: { tool: 'sheetbase.pipeline.cancel' },
    pipeline: {},
  },
  // -- Schedules --------------------------------------------------------------
  {
    name: 'create_pipeline_schedule',
    label: 'Add a pipeline schedule',
    summary: 'Add a pipeline schedule',
    description:
      'Makes a pipeline run by itself. `p_kind` is `interval` (`p_spec` `{ "intervalMinutes": 60 }`), `daily` (`{ "dailyAt": "06:00", "timeZone": "Europe/London" }`), `cron` (`{ "cron": "0 6 * * 1-5", "timeZone": "Europe/London" }`) or `event` (`{ "eventType": "dataset.versioned", "datasetId": "…" }`, any event that can start a pipeline). The spec can also carry `parameters`, `inputs` and `missedRunPolicy`. It runs as the person who adds it. Returns the schedule. Sends `pipeline.schedule.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      definitionId(),
      described('p_kind', 'text', '`interval`, `daily`, `cron` or `event`.'),
      described('p_spec', 'json', 'When it runs, for its kind (above).'),
      described(
        'p_enabled',
        'bool',
        '`false` switches it off; `true` on.',
        false,
      ),
    ],
    result: 'row:pipeline_schedules',
    assistant: { tool: 'sheetbase.pipeline.schedule_add' },
  },
  {
    name: 'update_pipeline_schedule',
    label: 'Change a pipeline schedule',
    summary: 'Change or pause a pipeline schedule',
    description:
      'Changes when a schedule runs (`p_kind` and `p_spec`, as for `create_pipeline_schedule`) or switches it off and on (`p_enabled`). Leave a field out to keep it. Returns the schedule. Sends `pipeline.schedule.updated`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      scheduleId(),
      described(
        'p_kind',
        'text',
        '`interval`, `daily`, `cron` or `event`.',
        false,
      ),
      described('p_spec', 'json', 'When it runs, for its kind.', false),
      described(
        'p_enabled',
        'bool',
        '`false` switches it off; `true` on.',
        false,
      ),
    ],
    result: 'row:pipeline_schedules',
    assistant: { tool: 'sheetbase.pipeline.schedule_switch' },
    pipeline: {},
  },
  {
    name: 'delete_pipeline_schedule',
    label: 'Delete a pipeline schedule',
    summary: 'Delete a pipeline schedule',
    description:
      'Deletes a schedule. Runs it already started are kept. Sends `pipeline.schedule.deleted`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [workspace(), scheduleId()],
    result: 'void',
    assistant: { tool: 'sheetbase.pipeline.schedule_delete' },
  },
  // -- Plugins ----------------------------------------------------------------
  // Installing a plugin takes its file: POST /api/plugins/install.
  {
    name: 'enable_extension',
    label: 'Switch a plugin on',
    summary: 'Switch a plugin on',
    description:
      'Switches an installed plugin on, so what it adds shows in the app, the assistant, MCP and pipelines. Owners and admins. Returns the plugin. Sends `extension.enabled`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [workspace(), extensionId()],
    result: 'row:extensions',
    assistant: { tool: 'sheetbase.plugin.switch' },
  },
  {
    name: 'disable_extension',
    label: 'Switch a plugin off',
    summary: 'Switch a plugin off',
    description:
      'Switches a plugin off: everything it adds stops at once, and it can be switched on again. Owners and admins. Returns the plugin. Sends `extension.disabled`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [workspace(), extensionId()],
    result: 'row:extensions',
  },
  {
    name: 'set_extension_point_enabled',
    label: 'Switch part of a plugin on or off',
    summary: 'Switch part of a plugin on or off',
    description:
      'Switches one part of a plugin (`p_point`, such as `operations`, `pipeline-steps` or `analysis-kinds`; its parts are the keys of `manifest.contributions`) on or off, leaving the rest as it is. Owners and admins. Returns the plugin. Sends `extension.point.enabled` or `extension.point.disabled`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [
      workspace(),
      extensionId(),
      described(
        'p_point',
        'text',
        'The part, such as `operations` or `pipeline-steps`.',
      ),
      described('p_enabled', 'bool', '`true` switches it on, `false` off.'),
    ],
    result: 'row:extensions',
  },
  {
    name: 'remove_extension',
    label: 'Remove a plugin',
    summary: 'Remove a plugin',
    description:
      'Removes an installed plugin and its code; everything it added stops at once. Owners and admins. Sends `extension.removed`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [workspace(), extensionId()],
    result: 'void',
    assistant: { tool: 'sheetbase.plugin.remove' },
  },
])
