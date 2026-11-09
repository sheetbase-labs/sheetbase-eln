/**
 * Planning and reporting: studies and their planner, reports, analysis views
 * and charts, and plate designs. Declared once, so the public API, the Python
 * and TypeScript SDKs, MCP (`sheetbase.lab.act`), the assistant, pipeline
 * actions and the webhook events all come from these entries.
 *
 * Everything here acts as the person (or the personal token) that calls it, so
 * every permission, version check and audit entry is the page's own.
 */
import { defineOperations, input } from '../descriptor'
import type { OperationInput } from '../descriptor'

/** The workspace of the call: a pipeline step fills it in itself. */
const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

const version = (what: string): OperationInput => ({
  ...input('p_expected_metadata_version', 'int'),
  description: `The version of the ${what} you last read. A change made since is refused instead of overwritten.`,
})

const optionalVersion = (what: string): OperationInput => ({
  ...input('p_expected_metadata_version', 'int', false),
  description: `The version of the ${what} you last read. A change made since is refused instead of overwritten.`,
})

export const PLANNING_OPERATIONS = defineOperations([
  // -- Studies and the planner ----------------------------------------------
  {
    name: 'create_study',
    label: 'Create a study',
    summary: 'Create a study',
    description:
      'Creates a study: a record that groups projects and experiments and carries the plan. Returns the study record.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_title', 'text'),
      input('p_home_project_id', 'uuid', false),
      input('p_summary', 'text', false),
      input('p_starts_on', 'date', false),
      input('p_ends_on', 'date', false),
      input('p_custom_fields', 'json', false),
    ],
    result: 'row:records',
    pipeline: {},
  },
  {
    name: 'edit_study',
    label: 'Edit a study',
    summary: 'Change a study',
    description:
      'Changes a study’s title, status, summary, dates or custom fields. Returns the study record.',
    kind: 'write',
    inputs: [
      input('p_study_record_id', 'uuid'),
      version('study'),
      input('p_title', 'text', true, true),
      input('p_status', 'text', true, true),
      input('p_summary', 'text', true, true),
      input('p_starts_on', 'date', true, true),
      input('p_ends_on', 'date', true, true),
      input('p_custom_fields', 'json', true, true),
    ],
    result: 'row:records',
  },
  {
    name: 'link_study_experiment',
    label: 'Add an experiment to a study',
    summary: 'Add an experiment to a study',
    description:
      'Makes an experiment part of a study. `p_relationship` is `member` by default. Returns the link.',
    kind: 'write',
    inputs: [
      input('p_study_record_id', 'uuid'),
      input('p_experiment_record_id', 'uuid'),
      input('p_relationship', 'text', false),
    ],
    result: 'row:study_experiments',
    pipeline: {},
  },
  {
    name: 'link_study_project',
    label: 'Add a project to a study',
    summary: 'Add a project to a study',
    description:
      'Makes a project take part in a study. `p_relationship` is `participating` by default. Returns the link.',
    kind: 'write',
    inputs: [
      input('p_study_record_id', 'uuid'),
      input('p_project_id', 'uuid'),
      input('p_relationship', 'text', false),
    ],
    result: 'row:study_projects',
  },
  {
    name: 'create_study_workstream',
    label: 'Add a workstream to the planner',
    summary: 'Create a workstream',
    description:
      'Adds a lane to the study planner that groups tasks. Returns the workstream.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_name', 'text'),
      input('p_project_id', 'uuid', false),
      input('p_color', 'text', false),
      input('p_position', 'int', false),
    ],
    result: 'row:study_workstreams',
    events: [
      {
        name: 'study.workstream.created',
        family: 'record',
        summary: 'A workstream was added to the study planner.',
        producer: { entityType: 'study_workstream', operation: 'create' },
        notes:
          'Payload is the workstream as stored: id, name, projectId, studyRecordId, color, position and status.',
      },
      {
        name: 'study.workstream.updated',
        family: 'record',
        summary: 'A workstream of the study planner was changed.',
        producer: { entityType: 'study_workstream', operation: 'update' },
      },
      {
        name: 'study.workstream.deleted',
        family: 'record',
        summary: 'A workstream was removed from the study planner.',
        producer: { entityType: 'study_workstream', operation: 'delete' },
      },
    ],
  },
  {
    name: 'create_study_task',
    label: 'Add a task or milestone to the planner',
    summary: 'Create a planner task',
    description:
      'Adds a task or milestone to the study planner. `p_task_type` is `task` (default) or `milestone`; `p_status` is `not_started` by default (or `in_progress`, `review`, `completed`, `blocked`, `cancelled`) and `p_priority` is `low`, `medium` (default), `high` or `critical`. Returns the task. Sends `study.task.created`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_title', 'text'),
      input('p_task_type', 'text', false),
      input('p_workstream_id', 'uuid', false, true),
      input('p_project_id', 'uuid', false, true),
      input('p_description', 'text', false, true),
      input('p_status', 'text', false),
      input('p_priority', 'text', false),
      input('p_starts_at', 'ts', false, true),
      input('p_ends_at', 'ts', false, true),
      input('p_due_at', 'ts', false, true),
      input('p_linked_experiment_record_id', 'uuid', false, true),
      input('p_linked_protocol_record_id', 'uuid', false, true),
      input('p_tags', 'text[]', false),
    ],
    result: 'row:study_tasks',
    assistant: { tool: 'sheetbase.study.task_add' },
    pipeline: {},
    events: [
      {
        name: 'study.task.created',
        family: 'record',
        summary: 'A task or milestone was added to the study planner.',
        producer: { entityType: 'study_task', operation: 'create' },
        notes:
          'Payload is the task as stored: id, title, taskType, status, priority, startsAt, endsAt, dueAt, workstreamId, projectId, studyRecordId and clientVisible. It fires however the task was added: on the planner, by the assistant, over the API or from a pipeline.',
      },
    ],
  },
  {
    name: 'edit_study_task',
    label: 'Change a planner task',
    summary: 'Change a planner task',
    description:
      'Changes a task or milestone: title, description, status (`not_started`, `in_progress`, `review`, `completed`, `blocked`, `cancelled`), priority, dates, progress, links or tags. Leave a field out to keep it. To move a due date that people have been told about, use `move_study_task_due`, which keeps the reason. Returns the task. Sends `study.task.updated`.',
    kind: 'write',
    inputs: [
      input('p_task_id', 'uuid'),
      input('p_title', 'text', false),
      input('p_description', 'text', false),
      input('p_task_type', 'text', false),
      input('p_status', 'text', false),
      input('p_priority', 'text', false),
      input('p_starts_at', 'ts', false),
      input('p_ends_at', 'ts', false),
      input('p_due_at', 'ts', false),
      input('p_workstream_id', 'text', false),
      input('p_project_id', 'uuid', false),
      input('p_progress_percent', 'int', false),
      input('p_linked_experiment_record_id', 'uuid', false),
      input('p_linked_protocol_record_id', 'uuid', false),
      input('p_tags', 'text[]', false),
      optionalVersion('task'),
    ],
    result: 'row:study_tasks',
    assistant: { tool: 'sheetbase.study.task_update' },
    pipeline: {},
    events: [
      {
        name: 'study.task.updated',
        family: 'record',
        summary: 'A planner task or milestone was changed.',
        producer: { entityType: 'study_task', operation: 'update' },
        notes:
          'Payload is the task as stored. Changes that come from elsewhere (a milestone added, a condition met) carry an `effect` that says which.',
      },
    ],
  },
  {
    name: 'delete_study_task',
    label: 'Delete a planner task',
    summary: 'Delete a planner task',
    description:
      'Removes a task or milestone from the planner, with its deliverables and dependencies. Sends `study.task.deleted`.',
    kind: 'write',
    inputs: [input('p_task_id', 'uuid')],
    result: 'void',
    events: [
      {
        name: 'study.task.deleted',
        family: 'record',
        summary: 'A task or milestone was removed from the study planner.',
        producer: { entityType: 'study_task', operation: 'delete' },
      },
    ],
  },
  {
    name: 'move_study_task_due',
    label: 'Move a task’s due date',
    summary: 'Move a planner task’s due date',
    description:
      'Moves the due date and keeps the reason in the task’s history. `p_notify_client` tells the client when the task is shared with them. Returns the task. Sends `study.task.updated`.',
    kind: 'write',
    inputs: [
      input('p_task_id', 'uuid'),
      version('task'),
      input('p_due_at', 'ts', true, true),
      input('p_reason', 'text'),
      input('p_notify_client', 'bool', false),
    ],
    result: 'row:study_tasks',
    pipeline: {},
  },
  {
    name: 'set_study_task_client_visible',
    label: 'Share a task with the client, or stop',
    summary: 'Share a planner task with a client',
    description:
      'Shows or hides a task on the client portal, with an optional reason. Returns the task.',
    kind: 'write',
    inputs: [
      input('p_task_id', 'uuid'),
      version('task'),
      input('p_client_visible', 'bool'),
      input('p_reason', 'text', false),
    ],
    result: 'row:study_tasks',
  },
  {
    name: 'create_dependency',
    label: 'Make one task wait for another',
    summary: 'Add a dependency between planner tasks',
    description:
      'Makes the successor wait for the predecessor. `p_dependency_type` is `finish_to_start` (default), `start_to_start`, `finish_to_finish` or `start_to_finish`; `p_lag_days` adds a gap. Returns the dependency.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_predecessor_id', 'uuid'),
      input('p_successor_id', 'uuid'),
      input('p_dependency_type', 'text', false),
      input('p_lag_days', 'int', false),
      input('p_is_external', 'bool', false),
    ],
    result: 'row:study_task_dependencies',
  },
  {
    name: 'delete_dependency',
    label: 'Remove a dependency between tasks',
    summary: 'Remove a dependency between planner tasks',
    description: 'Removes the dependency.',
    kind: 'write',
    inputs: [input('p_dependency_id', 'uuid')],
    result: 'void',
  },
  {
    name: 'assign_task_resource',
    label: 'Book an instrument or room for a task',
    summary: 'Book a resource for a planner task',
    description:
      'Reserves an instrument or room for a planner task between two times. Returns the reservation.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_task_id', 'uuid'),
      input('p_calendar_resource_id', 'uuid'),
      input('p_starts_at', 'ts'),
      input('p_ends_at', 'ts'),
      input('p_notes', 'text', false),
    ],
    result: 'row:study_task_resources',
  },
  {
    name: 'create_study_deliverable',
    label: 'Add a deliverable to a task',
    summary: 'Add a deliverable to a planner task',
    description:
      'Adds something the task must produce. `p_status` is `planned` (default), `in_progress`, `delivered` or `overdue`. Returns `{ id, taskId, name, status, dueAt, position }`. Sends `study.deliverable.created`.',
    kind: 'write',
    inputs: [
      input('p_task_id', 'uuid'),
      input('p_name', 'text'),
      input('p_description', 'text', false),
      input('p_status', 'text', false),
      input('p_due_at', 'ts', false, true),
    ],
    result: 'json',
    assistant: { tool: 'sheetbase.study.deliverable_add' },
    pipeline: {},
    events: [
      {
        name: 'study.deliverable.created',
        family: 'record',
        summary: 'A deliverable was added to a planner task.',
        producer: { entityType: 'study_deliverable', operation: 'create' },
        notes:
          'Payload is the deliverable as stored: id, taskId, name, status, dueAt and linkedRecordId.',
      },
    ],
  },
  {
    name: 'update_study_deliverable',
    label: 'Change a deliverable',
    summary: 'Change a planner deliverable',
    description:
      'Changes a deliverable’s name, description, status or due date. Leave a field out to keep it. Returns the deliverable. Sends `study.deliverable.updated`.',
    kind: 'write',
    inputs: [
      input('p_id', 'uuid'),
      input('p_name', 'text', false),
      input('p_description', 'text', false),
      input('p_status', 'text', false),
      input('p_due_at', 'ts', false),
    ],
    result: 'json',
    pipeline: {},
    events: [
      {
        name: 'study.deliverable.updated',
        family: 'record',
        summary: 'A planner deliverable was changed.',
        producer: { entityType: 'study_deliverable', operation: 'update' },
      },
      {
        name: 'study.deliverable.deleted',
        family: 'record',
        summary: 'A planner deliverable was removed.',
        producer: { entityType: 'study_deliverable', operation: 'delete' },
      },
    ],
  },
  {
    name: 'reorder_study_deliverables',
    label: 'Reorder the deliverables of a task',
    summary: 'Reorder planner deliverables',
    description: 'Puts a task’s deliverables in the order given.',
    kind: 'write',
    inputs: [input('p_task_id', 'uuid'), input('p_ids', 'uuid[]')],
    result: 'json',
  },
  {
    name: 'link_study_deliverable_evidence',
    label: 'Attach a record as evidence for a deliverable',
    summary: 'Attach evidence to a planner deliverable',
    description:
      'Links the experiment or record that shows the deliverable was met. Returns the deliverable.',
    kind: 'write',
    inputs: [input('p_id', 'uuid'), input('p_record_id', 'uuid')],
    result: 'json',
  },
  {
    name: 'snapshot_study_plan',
    label: 'Keep a snapshot of a study’s plan',
    summary: 'Snapshot a study’s plan',
    description:
      'Saves the whole plan of a study as it stands, with a checksum, so a later change can be compared with it. Returns the snapshot. Sends `study.plan.snapshotted`.',
    kind: 'write',
    inputs: [
      input('p_study_record_id', 'uuid'),
      input('p_reason', 'text', false),
    ],
    result: 'row:study_plan_snapshots',
    pipeline: {},
    events: [
      {
        name: 'study.plan.snapshotted',
        family: 'record',
        summary: 'A snapshot of a study’s plan was kept.',
        producer: { entityType: 'study_plan_snapshot', operation: 'create' },
        notes:
          'Payload carries the snapshot row: id, studyRecordId, planVersion, checksum and reason.',
      },
    ],
  },

  // -- Reports --------------------------------------------------------------
  {
    name: 'create_report_definition',
    label: 'Create a report',
    summary: 'Create a report',
    description:
      'Starts a report, optionally in a project and from a template. Returns the report. Sends `report.created`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_title', 'text'),
      input('p_subtitle', 'text', false, true),
      input('p_project_id', 'uuid', false, true),
      input('p_template_record_id', 'uuid', false, true),
    ],
    result: 'row:report_definitions',
    pipeline: {},
    events: [
      {
        name: 'report.created',
        family: 'report',
        summary: 'A report was started.',
        producer: { entityType: 'report_definition', operation: 'create' },
        notes:
          'Payload is the report as stored: id, title, status, projectId, recordId and documentIdentifier.',
      },
    ],
  },
  {
    name: 'update_report_definition',
    label: 'Change a report',
    summary: 'Change a report',
    description:
      'Changes a report’s title, subtitle, status (`draft`, `in_review`, `approved`, `published`, `archived`) or template. Leave a field out to keep it. Returns the report. Sends `report.updated`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_report_id', 'uuid'),
      input('p_title', 'text', false),
      input('p_subtitle', 'text', false),
      input('p_status', 'text', false),
      input('p_template_record_id', 'uuid', false),
      input('p_review_submission_id', 'uuid', false),
    ],
    result: 'row:report_definitions',
    pipeline: {},
    events: [
      {
        name: 'report.updated',
        family: 'report',
        summary: 'A report was changed.',
        producer: { entityType: 'report_definition', operation: 'update' },
      },
    ],
  },
  {
    name: 'add_report_section',
    label: 'Add a section to a report',
    summary: 'Add a report section',
    description:
      'Adds a section to the end of a report. `p_section_type` is `text` by default; `p_source_type` says where the content comes from (`free_text` by default). Returns the section.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_report_id', 'uuid'),
      input('p_title', 'text'),
      input('p_description', 'text', false),
      input('p_section_type', 'text', false),
      input('p_source_type', 'text', false),
    ],
    result: 'row:report_sections',
    pipeline: {},
  },
  {
    name: 'update_report_section',
    label: 'Change a report section',
    summary: 'Change a report section',
    description:
      'Changes a section’s title, description, type or position. Leave a field out to keep it. Returns the section.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_section_id', 'uuid'),
      input('p_title', 'text', false),
      input('p_description', 'text', false),
      input('p_section_type', 'text', false),
      input('p_position', 'int', false),
    ],
    result: 'row:report_sections',
  },
  {
    name: 'bind_report_section_source',
    label: 'Point a report section at its data',
    summary: 'Bind a report section to its source',
    description:
      'Fills a section from a saved revision (a chart, table or analysis), so the report always shows that exact data. `p_source_ref` says which part. Returns the section.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_section_id', 'uuid'),
      input('p_source_revision_id', 'uuid'),
      input('p_source_ref', 'json', false),
    ],
    result: 'row:report_sections',
    pipeline: {},
  },
  {
    name: 'remove_report_section',
    label: 'Remove a report section',
    summary: 'Remove a report section',
    description: 'Takes a section out of a report.',
    kind: 'write',
    inputs: [workspace(), input('p_section_id', 'uuid')],
    result: 'void',
  },
  {
    name: 'reorder_report_sections',
    label: 'Reorder a report’s sections',
    summary: 'Reorder report sections',
    description:
      'Puts the sections in the order given: `p_section_ids` is a JSON array of section ids.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_report_id', 'uuid'),
      input('p_section_ids', 'json'),
    ],
    result: 'void',
  },
  {
    name: 'validate_report',
    label: 'Check a report is ready',
    summary: 'Check a report',
    description:
      'Checks every section: whether its source still exists and is unchanged. Returns the findings; nothing is changed.',
    kind: 'read',
    inputs: [workspace(), input('p_report_id', 'uuid')],
    result: 'json',
    pipeline: {},
  },
  {
    name: 'generate_report',
    label: 'Generate a report',
    summary: 'Generate a report',
    description:
      'Builds the report from its sections as they stand now and keeps the result with a checksum. `p_output_format` is `html` (default) or `pdf`. Returns the generation. Sends `report.generated`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_report_id', 'uuid'),
      input('p_output_format', 'text', false),
    ],
    result: 'row:report_generations',
    assistant: { tool: 'sheetbase.report.generate' },
    pipeline: {},
    events: [
      {
        name: 'report.generated',
        family: 'report',
        summary: 'A report was generated.',
        producer: { entityType: 'report_generation', operation: 'create' },
        notes:
          'Payload carries the generation: id, reportId, reportVersion, outputFormat, outputChecksum, outputSizeBytes and generatedAt. The output itself stays out of the event; read it from `report_generations`.',
      },
    ],
  },

  // -- Plate designs --------------------------------------------------------
  {
    name: 'create_plate_design',
    label: 'Create a plate design',
    summary: 'Create a plate design',
    description:
      'Starts a plate layout. `p_format` is `96_well` by default (`6_well` to `1536_well`), with `p_rows` and `p_cols` to match. Returns the design. Sends `plate_design.created`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_name', 'text'),
      input('p_project_id', 'uuid', false, true),
      input('p_format', 'text', false),
      input('p_rows', 'int', false),
      input('p_cols', 'int', false),
      input('p_validation', 'json', false),
    ],
    result: 'row:plate_designs',
    pipeline: {},
    events: [
      {
        name: 'plate_design.created',
        family: 'inventory',
        summary: 'A plate design was started.',
        producer: { entityType: 'plate_design', operation: 'create' },
        notes:
          'Payload is the design as stored: id, name, format, rows, cols, status and projectId.',
      },
    ],
  },
  {
    name: 'save_plate_design',
    label: 'Save a plate design’s wells',
    summary: 'Save a plate design',
    description:
      'Replaces the wells of a design. `p_wells` is a JSON array of `{ wellCode, role, sampleId, sampleLabel, concentration, concentrationUnit, volumeUl }`. Returns the design. Sends `plate_design.updated`.',
    kind: 'write',
    inputs: [
      input('p_design_id', 'uuid'),
      input('p_wells', 'json'),
      input('p_validation', 'json', false),
      optionalVersion('design'),
    ],
    result: 'row:plate_designs',
    pipeline: {},
    events: [
      {
        name: 'plate_design.updated',
        family: 'inventory',
        summary: 'A plate design was changed or archived.',
        producer: { entityType: 'plate_design', operation: 'update' },
        notes:
          'Payload is the design as stored. An archived design has status `archived`.',
      },
    ],
  },
  {
    name: 'archive_plate_design',
    label: 'Archive a plate design',
    summary: 'Archive a plate design',
    description:
      'Archives a design so it no longer shows in lists. Returns the design. Sends `plate_design.updated`.',
    kind: 'write',
    inputs: [input('p_design_id', 'uuid'), version('design')],
    result: 'row:plate_designs',
    assistant: { tool: 'sheetbase.plate_design.archive' },
    pipeline: {},
  },
  {
    name: 'save_plate_layout_template',
    label: 'Save a plate layout template',
    summary: 'Save a plate layout template',
    description:
      'Saves a layout others can start from. Give `p_template_id` to change one. Returns the template. Sends `plate_layout_template.created` or `plate_layout_template.updated`.',
    kind: 'write',
    inputs: [
      workspace(),
      input('p_name', 'text'),
      input('p_description', 'text', false),
      input('p_format', 'text', false),
      input('p_rows', 'int', false),
      input('p_cols', 'int', false),
      input('p_layout', 'json', false),
      input('p_template_id', 'uuid', false),
    ],
    result: 'row:plate_layout_templates',
    events: [
      {
        name: 'plate_layout_template.created',
        family: 'inventory',
        summary: 'A plate layout template was saved.',
        producer: { entityType: 'plate_layout_template', operation: 'create' },
      },
      {
        name: 'plate_layout_template.updated',
        family: 'inventory',
        summary: 'A plate layout template was changed.',
        producer: { entityType: 'plate_layout_template', operation: 'update' },
      },
    ],
  },

  // -- Analysis views and charts -------------------------------------------
  {
    name: 'save_analysis_view',
    label: 'Save an analysis view',
    summary: 'Save an analysis view',
    description:
      'Creates a view (leave `p_id` out) or saves a new version of one you own. `p_charts` is a JSON list of one to eight chart specifications and `p_source_revisions` the data versions it was made from, so the view can be reproduced. Returns the view. Sends `analysis_view.created` or `analysis_view.updated`.',
    kind: 'write',
    inputs: [
      input('p_id', 'uuid', false, true),
      input('p_name', 'text'),
      input('p_charts', 'json'),
      input('p_source_revisions', 'json'),
      input('p_export_settings', 'json', false, true),
    ],
    result: 'row:analysis_views',
    pipeline: {},
    events: [
      {
        name: 'analysis_view.created',
        family: 'report',
        summary: 'An analysis view was saved for the first time.',
        producer: { entityType: 'analysis_view', operation: 'create' },
        notes:
          'Payload carries id, displayId, name, version and ownerUserId. The charts stay out of the event; read them from `analysis_views`.',
      },
      {
        name: 'analysis_view.updated',
        family: 'report',
        summary: 'An analysis view was saved again.',
        producer: { entityType: 'analysis_view', operation: 'update' },
      },
      {
        name: 'analysis_view.deleted',
        family: 'report',
        summary: 'An analysis view was deleted.',
        producer: { entityType: 'analysis_view', operation: 'delete' },
      },
    ],
  },
  {
    name: 'delete_analysis_view',
    label: 'Delete an analysis view',
    summary: 'Delete an analysis view',
    description:
      'Deletes a view you own. A view a notebook cites cannot be deleted. Sends `analysis_view.deleted`.',
    kind: 'write',
    inputs: [input('p_id', 'uuid')],
    result: 'void',
  },
  {
    name: 'save_analysis_definition',
    label: 'Save an analysis definition',
    summary: 'Save an analysis definition',
    description:
      'Creates a reusable analysis (leave `p_id` out) or saves a new version of one you own. Returns the definition.',
    kind: 'write',
    inputs: [
      input('p_id', 'uuid', false, true),
      input('p_name', 'text'),
      input('p_definition', 'json'),
      input('p_source_revisions', 'json'),
    ],
    result: 'row:analysis_definitions',
  },
  {
    name: 'delete_analysis_definition',
    label: 'Delete an analysis definition',
    summary: 'Delete an analysis definition',
    description: 'Deletes a definition you own.',
    kind: 'write',
    inputs: [input('p_id', 'uuid')],
    result: 'void',
  },
  {
    name: 'compose_analysis_definition',
    label: 'Turn a chart view into an analysis definition',
    summary: 'Compose an analysis definition from a chart',
    description:
      'Combines a saved chart view with a statistic definition into a named analysis definition. Returns the definition.',
    kind: 'write',
    inputs: [
      input('p_chart_view_id', 'uuid'),
      input('p_statistic_definition_id', 'uuid'),
      input('p_name', 'text'),
    ],
    result: 'row:analysis_definitions',
  },
  {
    name: 'analysis_view_source_status',
    label: 'Check whether an analysis view’s data has moved on',
    summary: 'Check an analysis view’s sources',
    description:
      'For each data version the view was made from, whether a newer one exists. Returns the findings; nothing is changed.',
    kind: 'read',
    inputs: [input('p_view_id', 'uuid')],
    result: 'json',
  },
  {
    name: 'analysis_view_citations',
    label: 'See where an analysis view is cited',
    summary: 'List where an analysis view is cited',
    description:
      'The notebooks that cite the view, and whether each is locked. Returns the list.',
    kind: 'read',
    inputs: [input('p_view_id', 'uuid')],
    result: 'json',
  },
  {
    name: 'resolve_analysis_view_sources',
    label: 'Decide what to do about newer data',
    summary: 'Resolve newer data behind an analysis view',
    description:
      '`p_resolution` is `keep` (stay on the pinned versions, with a `p_justification`) or `update` (move to the newest). Returns the new status.',
    kind: 'write',
    inputs: [
      input('p_view_id', 'uuid'),
      version('view'),
      input('p_resolution', 'text'),
      input('p_justification', 'text', false),
    ],
    result: 'json',
  },
  {
    name: 'freeze_chart',
    label: 'Freeze a chart in a notebook',
    summary: 'Freeze a chart',
    description:
      'Fixes a chart block to the data it shows now, so later data cannot change it. Returns the block.',
    kind: 'write',
    inputs: [input('p_block_id', 'uuid'), input('p_expected_version', 'int')],
    result: 'json',
  },
  {
    name: 'unfreeze_chart',
    label: 'Unfreeze a chart',
    summary: 'Unfreeze a chart',
    description:
      'Lets a frozen chart block follow its data again. Returns the block.',
    kind: 'write',
    inputs: [input('p_block_id', 'uuid'), input('p_expected_version', 'int')],
    result: 'json',
  },
  {
    name: 'bind_chart_revision',
    label: 'Point a chart at a saved revision',
    summary: 'Bind a chart to a revision',
    description:
      'Makes a chart block show one saved revision of its data. Returns the block.',
    kind: 'write',
    inputs: [
      input('p_block_id', 'uuid'),
      input('p_revision_id', 'uuid'),
      input('p_expected_version', 'int'),
    ],
    result: 'json',
  },
  {
    name: 'freeze_analysis_block',
    label: 'Freeze an analysis in a notebook',
    summary: 'Freeze an analysis block',
    description:
      'Fixes an analysis block to the data it shows now. Returns the block.',
    kind: 'write',
    inputs: [input('p_block_id', 'uuid'), input('p_expected_version', 'int')],
    result: 'json',
  },
  {
    name: 'unfreeze_analysis_block',
    label: 'Unfreeze an analysis',
    summary: 'Unfreeze an analysis block',
    description:
      'Lets a frozen analysis block follow its data again. Returns the block.',
    kind: 'write',
    inputs: [input('p_block_id', 'uuid'), input('p_expected_version', 'int')],
    result: 'json',
  },
])
