/**
 * Convert a Simple pipeline to Standard and duplicate a version as a new
 * pipeline. Declared once, so the public API, the SDKs, MCP
 * (`sheetbase.lab.act`), the assistant and pipeline actions all come from
 * these entries. Both send the events the tables already send: a conversion
 * is `pipeline.version.created` or `pipeline.version.updated` for the draft,
 * a duplicate is `pipeline.created` then `pipeline.version.created`.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

const described = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

export const PIPELINE_SIMPLE_OPERATIONS = defineOperations([
  {
    name: 'convert_pipeline_to_standard',
    label: 'Convert a Simple pipeline to Standard',
    summary: 'Convert a Simple pipeline to Standard',
    description:
      'Turns a Simple pipeline (a recipe) into a Standard one (typed steps) and cannot be undone: the recipe goes and the steps it compiled to stay. The draft becomes Standard in place; with no draft the newest version is copied into a new Standard draft. The published version keeps running until the draft is published. Stewards, admins and owners. Returns the Standard draft version. Sends `pipeline.version.updated` or `pipeline.version.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described(
        'p_definition_id',
        'uuid',
        'The pipeline, from `pipeline_definitions`.',
      ),
    ],
    result: 'row:pipeline_definition_versions',
    assistant: { tool: 'sheetbase.pipeline.convert' },
    pipeline: {},
    docsPage: 'pipelines-simple-api.md',
  },
  {
    name: 'duplicate_pipeline_definition',
    label: 'Duplicate a pipeline version as a new pipeline',
    summary: 'Duplicate a pipeline version as a new pipeline',
    description:
      'Makes a new pipeline from one version of another, in the mode that version was written in, starting as its first draft. Runs, starts and history stay with the original. `p_key` is letters, digits and `_`, unique in the workspace. Stewards, admins and owners. Returns the new pipeline. Sends `pipeline.created` and `pipeline.version.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described(
        'p_version_id',
        'uuid',
        'The version to copy, from `pipeline_definition_versions`.',
      ),
      described('p_key', 'text', 'The new pipeline’s key.'),
      described('p_name', 'text', 'The new pipeline’s name.'),
    ],
    result: 'row:pipeline_definitions',
    assistant: { tool: 'sheetbase.pipeline.duplicate' },
    pipeline: {},
    docsPage: 'pipelines-simple-api.md',
  },
  {
    name: 'list_expiring_materials',
    label: 'List the stock that expires soon',
    summary: 'List the stock that expires soon',
    description:
      'Looks at the materials that expire within `p_days` days (not quarantined, expired, consumed or depleted) and leaves one Inbox item for a person with a line for each lot, soonest first. Leaves nothing when nothing expires. Stewards and anyone who can edit in the workspace. Returns `{ count, created, inboxItemId }`. Sends `pipeline.inbox_item.created` when it leaves an item.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described('p_user_id', 'text', 'The person, from `workspace_members`.'),
      described(
        'p_days',
        'int',
        'How many days ahead to look, 1 to 365.',
        false,
      ),
    ],
    result: 'json',
    pipeline: {},
    docsPage: 'pipelines-simple-api.md',
  },
  {
    name: 'create_inbox_item',
    label: 'Leave an Inbox item for someone',
    summary: 'Leave an Inbox item for someone',
    description:
      'Puts an item in a person’s Inbox: a task to do or a snapshot to look at. Give the dataset or snapshot it is about, if it is about one, and a due time if there is one. It shows until they open it. Stewards and anyone who can edit in the workspace. Returns the item. Sends `pipeline.inbox_item.created`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described('p_user_id', 'text', 'The person, from `workspace_members`.'),
      described(
        'p_title',
        'text',
        'What they should do, up to 200 characters.',
      ),
      described('p_body', 'text', 'More about it.', false),
      described('p_dataset_id', 'uuid', 'The dataset it is about.', false),
      described(
        'p_dataset_version_id',
        'uuid',
        'The snapshot it is about.',
        false,
      ),
      described('p_due_at', 'ts', 'When it is due.', false),
    ],
    result: 'row:pipeline_inbox_items',
    assistant: { tool: 'sheetbase.inbox.leave_item' },
    pipeline: {},
    docsPage: 'pipelines-simple-api.md',
    events: [
      {
        name: 'pipeline.inbox_item.created',
        family: 'record',
        summary: 'A pipeline or a person left an Inbox item for someone.',
        producer: { entityType: 'pipeline_inbox_item', operation: 'create' },
        notes:
          'Payload: id, userId, title, datasetId, datasetVersionId and dueAt.',
      },
    ],
  },
])
