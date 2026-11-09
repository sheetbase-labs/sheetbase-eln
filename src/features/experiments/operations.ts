/**
 * Experiments, reviews, record aliases, formulas, label templates and the
 * record timeline on the token API, MCP, the assistant and pipelines. One
 * declaration each (see `docs/development/adding-an-operation.md`).
 *
 * What stays in the app: the review steps that run in a signed-in session
 * (`submit_record_revision`, `run_revision_checks`, `create_amendment`), which
 * the database refuses without one. Their reasons are in
 * `integration-exemptions.ts`.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (field: OperationInput, description: string): OperationInput => ({
  ...field,
  description,
})

const RECORD_ID = note(input('p_record_id', 'uuid'), 'The record id.')
const EXPERIMENT_ID = note(
  input('p_record_id', 'uuid'),
  'The experiment (`records.id`).',
)
const REVISION_ID = note(
  input('p_revision_id', 'uuid'),
  'The submitted revision (`revisions.id`).',
)
const METADATA_VERSION = note(
  input('p_expected_metadata_version', 'bigint'),
  'The `metadata_version` you last read. A stale one is refused.',
)
const ALIAS = note(
  input('p_alias', 'text'),
  'Another name the record is known by, such as a supplier code.',
)

const RECORD_FAMILY = 'record' as const
const ADMIN_FAMILY = 'administration' as const

export const EXPERIMENT_OPERATIONS = defineOperations([
  // -- Experiments ------------------------------------------------------------
  {
    name: 'start_experiment',
    label: 'Start an experiment',
    summary: 'Start a planned experiment',
    description:
      'Moves a planned experiment to running, optionally on a protocol version. The protocol must be one the project may use.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      EXPERIMENT_ID,
      METADATA_VERSION,
      note(
        input('p_protocol_version_id', 'uuid', false, true),
        'The protocol version to run it on.',
      ),
      note(input('p_reason', 'text', false, true), 'Why, in a sentence.'),
    ],
    result: 'row:records',
    assistant: { tool: 'sheetbase.experiment.start' },
    pipeline: {},
  },
  {
    name: 'set_experiment_status',
    label: 'Change an experiment’s status',
    summary: 'Change an experiment’s status',
    description:
      'Moves an experiment to another status, such as on hold or complete. Some moves need a reason when the workspace asks for one.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      EXPERIMENT_ID,
      METADATA_VERSION,
      note(input('p_status', 'text'), 'The new status.'),
      note(input('p_reason', 'text', true, true), 'Why, in a sentence.'),
    ],
    result: 'row:records',
    assistant: { tool: 'sheetbase.experiment.set_status' },
    pipeline: {},
  },
  {
    name: 'delete_experiment_draft',
    label: 'Delete a draft experiment',
    summary: 'Delete a draft experiment',
    description:
      'Deletes a draft experiment that was never submitted. Only its author, or a workspace admin, may.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [EXPERIMENT_ID],
    result: 'void',
    assistant: { tool: 'sheetbase.experiment.delete_draft' },
    pipeline: {},
  },
  {
    name: 'set_experiment_decision',
    label: 'Record what an experiment showed',
    summary: 'Record whether an experiment supported its hypothesis',
    description:
      'Records the outcome against the hypothesis: `supported`, `refuted` or `inconclusive`, with notes. Leave the decision out to clear it.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      EXPERIMENT_ID,
      note(
        input('p_decision', 'text', true, true),
        '`supported`, `refuted` or `inconclusive`.',
      ),
      note(input('p_notes', 'text', false, true), 'Why, in a few lines.'),
    ],
    result: 'row:records',
    assistant: { tool: 'sheetbase.experiment.set_outcome' },
    pipeline: {},
  },
  {
    name: 'experiment_readiness',
    label: 'Check an experiment is ready to submit',
    summary: 'What an experiment still needs before it can be submitted',
    description:
      'The checks an experiment must pass before it can go for review, and which of them still fail.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [EXPERIMENT_ID],
    result: 'json',
  },
  {
    name: 'experiment_open_issue_counts',
    label: 'Count open issues on experiments',
    summary: 'Open issues on each experiment',
    description:
      'For each experiment you can see, how many linked issues are still open.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [],
    result: 'rows:record_id=uuid,open_issues=bigint',
  },
  {
    name: 'experiment_tab_counts',
    label: 'Count experiments by status',
    summary: 'How many experiments are in each status',
    description:
      'Experiment counts by status and whether archived, in all and yours, narrowed as the Experiments list narrows them.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [
      note(input('p_user_id', 'text', false, true), 'Whose are “mine”.'),
      note(input('p_project_id', 'uuid', false, true), 'One project.'),
      note(input('p_since', 'ts', false, true), 'Changed since.'),
      note(input('p_query', 'text', false, true), 'Words to match.'),
      note(
        input('p_match_project_ids', 'uuid[]', false, true),
        'Projects to match.',
      ),
      note(
        input('p_match_owner_ids', 'text[]', false, true),
        'Owners to match.',
      ),
    ],
    result: 'rows:status=text,archived=bool,total=int,mine=int',
  },
  {
    name: 'create_plan_from_project',
    label: 'Plan a project from another',
    summary: 'Copy a project’s plan into another project',
    description:
      'Copies the planned experiments and tasks of one project into another, starting on a date, with their gaps kept.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      note(input('p_target_project_id', 'uuid'), 'The project to plan.'),
      note(input('p_source_project_id', 'uuid'), 'The project to copy.'),
      note(input('p_start_date', 'date'), 'When the copied plan starts.'),
    ],
    result: 'json',
    assistant: { tool: 'sheetbase.project.plan_from' },
    pipeline: {},
  },
  // -- Records: aliases, timeline, trail, delete preview -----------------------
  {
    name: 'add_record_alias',
    label: 'Add another name to a record',
    summary: 'Add an alias to a record',
    description:
      'Gives a record another name it can be found by, such as a supplier code or an old identifier. Returns the alias.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [RECORD_ID, ALIAS],
    result: 'row:record_aliases',
    assistant: { tool: 'sheetbase.record.add_alias' },
    pipeline: {},
    events: [
      {
        name: 'record.alias.added',
        family: RECORD_FAMILY,
        summary: 'A record was given another name.',
        producer: { entityType: 'record_alias', operation: 'create' },
        notes: 'Payload: recordId and alias.',
      },
      {
        name: 'record.alias.removed',
        family: RECORD_FAMILY,
        summary: 'Another name was taken off a record.',
        producer: { entityType: 'record_alias', operation: 'delete' },
        notes: 'Payload: recordId and alias.',
      },
    ],
  },
  {
    name: 'remove_record_alias',
    label: 'Remove another name from a record',
    summary: 'Remove an alias from a record',
    description: 'Takes one of a record’s other names off it.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [RECORD_ID, ALIAS],
    result: 'void',
    assistant: { tool: 'sheetbase.record.remove_alias' },
    pipeline: {},
  },
  {
    name: 'record_timeline',
    label: 'Read a record’s timeline',
    summary: 'Everything that happened to a record',
    description:
      'A record’s history in order: edits, status changes, links, reviews and signatures.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [RECORD_ID],
    result: 'json',
  },
  {
    name: 'save_trail_evidence',
    label: 'Save a trail of steps on a record',
    summary: 'Keep a trail of steps as evidence on a record',
    description:
      'Saves the steps that led to a result, such as the records and datasets followed, as evidence on the record. Saved trails cannot be changed.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      RECORD_ID,
      note(
        input('p_steps', 'json'),
        'The steps, as a JSON list of `{ kind, id, label }`.',
      ),
      note(input('p_note', 'text', false, true), 'A note.'),
    ],
    result: 'row:trail_evidence',
    pipeline: {},
  },
  {
    name: 'preview_hard_delete',
    label: 'Preview deleting for good',
    summary: 'What deleting something for good would remove or be blocked by',
    description:
      'Lists what a permanent delete would take with it, and what stops it. Deleting for good stays with a person in the app.',
    kind: 'read',
    scope: 'projects:read',
    inputs: [
      note(input('p_kind', 'text'), 'What it is, such as `record`.'),
      note(input('p_object_id', 'uuid'), 'Its id.'),
    ],
    result: 'json',
  },
  // -- Reviews -----------------------------------------------------------------
  {
    name: 'available_review_workflows',
    label: 'List the review workflows',
    summary: 'The review workflows records can be submitted to',
    description:
      'Each review workflow by key and version, and whether it needs a signature.',
    kind: 'read',
    scope: 'reviews:read',
    inputs: [],
    result: 'rows:definition_key=text,version=int,requires_signature=bool',
  },
  {
    name: 'review_workflow_options',
    label: 'List the review workflow options',
    summary: 'The review workflows offered in settings',
    description:
      'The review workflows a workspace can choose from, by key and version, and whether each needs a signature.',
    kind: 'read',
    scope: 'reviews:read',
    inputs: [],
    result: 'rows:definition_key=text,version=int,requires_signature=bool',
  },
  {
    name: 'revision_drift',
    label: 'Check a revision against its record',
    summary: 'What changed on a record since a revision was submitted',
    description:
      'Compares a submitted revision with the record as it is now, and lists what moved.',
    kind: 'read',
    scope: 'reviews:read',
    inputs: [REVISION_ID],
    result: 'json',
  },
  {
    name: 'revision_evidence_package',
    label: 'Read a revision’s evidence',
    summary: 'The evidence package of a submitted revision',
    description:
      'Everything a reviewer sees for a revision: its content digest, checks, links, files and signatures.',
    kind: 'read',
    scope: 'reviews:read',
    inputs: [REVISION_ID],
    result: 'json',
  },
  // -- Instruments and labels --------------------------------------------------
  {
    name: 'record_qc_check',
    label: 'Record a QC check on a run',
    summary: 'Record a quality check on an instrument run',
    description:
      'Adds a quality check result to an instrument run: its name, `info`, `pass`, `warn` or `fail`, a message and any detail.',
    kind: 'write',
    scope: 'lab:write',
    inputs: [
      note(input('p_workspace_id', 'uuid'), 'Your workspace id.'),
      note(input('p_run_id', 'uuid', true, true), 'The instrument run.'),
      note(input('p_check_name', 'text'), 'What was checked.'),
      note(input('p_check_type', 'text', false), 'The result kind.'),
      note(input('p_message', 'text', false, true), 'What it found.'),
      note(input('p_detail', 'json', false), 'Any detail, as JSON.'),
    ],
    result: 'row:instrument_qc_checks',
    pipeline: {},
  },
  {
    name: 'set_label_template_archived',
    label: 'Archive or restore a label template',
    summary: 'Archive or restore a label template',
    description:
      'Stops a label template being offered when printing, or brings it back.',
    kind: 'write',
    scope: 'lab:write',
    inputs: [
      note(input('p_template_id', 'uuid'), 'The label template.'),
      note(input('p_archived', 'bool'), 'true to archive, false to restore.'),
    ],
    result: 'row:label_templates',
    assistant: { tool: 'sheetbase.label_template.archive' },
    pipeline: {},
    events: [
      {
        name: 'label.template.created',
        family: ADMIN_FAMILY,
        summary: 'A label template was added.',
        producer: { entityType: 'label_template', operation: 'create' },
        notes: 'Payload: name, recordKind and isDefault.',
      },
      {
        name: 'label.template.updated',
        family: ADMIN_FAMILY,
        summary: 'A label template was changed, archived or restored.',
        producer: { entityType: 'label_template', operation: 'update' },
        notes:
          'Payload: name, recordKind, isDefault, archived and the changed columns.',
      },
    ],
  },
])
