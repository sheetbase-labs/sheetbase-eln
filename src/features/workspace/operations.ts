/**
 * Workspace set-up and the leftovers of areas that are already open: the
 * first-run set-up, starter tables, join domains, the regulated-lab switch,
 * what the caller may do, the category vocabularies, search helpers, sheet
 * cell conflicts, filing planner work under a study and the sample storage
 * places in use. One declaration gives each its API entry (allowlist,
 * OpenAPI, docs, SDK), the MCP action, the pipeline action and, where it has
 * one, the assistant card name.
 *
 * Every call acts as the person the token belongs to, and the database still
 * checks their access: set-up, starter tables, join domains and the
 * regulated-lab switch need the matching admin or settings access.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

const workspace = (): OperationInput => ({
  ...note('p_workspace_id', 'uuid', 'Your workspace id.'),
  server: 'workspace',
})

const card = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})

const DOCS = 'workspace-api.md'

export const WORKSPACE_OPERATIONS = defineOperations([
  // -- set-up and workspace rules ----------------------------------------------
  {
    name: 'complete_workspace_setup',
    label: 'Finish setting up the workspace',
    summary: 'Name the lab, set its time zone and add starter tables',
    description:
      'The first set-up: the lab’s name (1 to 120 characters), its IANA time zone and which starter tables to add (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`). Marks the workspace set up. Needs workspace admin. Returns `{ installed }`. Sends `workspace.setup.completed`.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_name', 'text', 'The lab’s name.'),
      note('p_timezone', 'text', 'IANA time zone, such as `Europe/London`.'),
      note(
        'p_starter_keys',
        'text[]',
        'Starter tables to add, such as `qpcr`.',
        false,
      ),
    ],
    result: 'json',
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'install_starter_structures',
    label: 'Add starter tables',
    summary: 'Add starter measurement tables',
    description:
      'Adds the starter measurement tables the workspace does not have yet (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`); leave the list out for all of them. They are ordinary tables people can change. Needs to edit tables. Returns the keys added.',
    kind: 'write',
    inputs: [
      workspace(),
      note(
        'p_keys',
        'text[]',
        'Which starter tables; leave out for all.',
        false,
        true,
      ),
    ],
    result: 'list:text',
    assistant: card('sheetbase.workspace.add_starter_tables'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'set_join_domains',
    label: 'Set who can join by email domain',
    summary: 'Set the email domains whose people can join',
    description:
      'Replaces the list of email domains whose people can join the workspace themselves, and the role they join as (`scientist`, `analyst`, `reviewer` or `viewer`). An empty list turns it off. You can only add your own verified email domain; public mail domains and domains another workspace has are refused. Needs to manage members. Returns `{ domains, role }`. Sends `workspace.join_domains.changed`.',
    kind: 'write',
    inputs: [
      workspace(),
      note('p_domains', 'text[]', 'Email domains, such as `example.com`.'),
      note('p_role', 'text', 'The role people join as.', false),
    ],
    result: 'json',
    assistant: card('sheetbase.workspace.join_domains'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'set_regulated_lab',
    label: 'Turn regulated-lab rules on or off',
    summary: 'Turn the regulated-lab rules on or off',
    description:
      'Turns on or off the rules regulated labs need (such as approving parsers before regulated data uses them). Needs to manage General settings. Returns the settings. Sends `workspace.regulated_lab.changed`.',
    kind: 'write',
    inputs: [workspace(), note('p_regulated', 'bool', 'On or off.')],
    result: 'row:workspace_settings',
    assistant: card('sheetbase.workspace.regulated_lab'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'list_capabilities',
    label: 'List what you may do',
    summary: 'List the capabilities you have in the workspace',
    description:
      'The capabilities you hold here, such as `schema.edit`, `pipelines.manage` or `sample.release`, from your role and groups.',
    kind: 'read',
    inputs: [workspace()],
    result: 'list:text',
    docsPage: DOCS,
  },
  {
    name: 'list_configuration_vocabularies',
    label: 'List category fields and their terms',
    summary: 'List every category field and its terms',
    description:
      'Every category field in record types, measurement tables and sheet templates, with where it is, its terms and their lifecycle, a page at a time (up to 200). Returns `{ items, hasMore }`.',
    kind: 'read',
    inputs: [
      workspace(),
      note('p_limit', 'int', 'Page size, 1 to 200.', false),
      note('p_offset', 'int', 'How many to skip.', false),
    ],
    result: 'json',
    docsPage: DOCS,
  },
  // -- search helpers ------------------------------------------------------------
  {
    name: 'search_cells',
    label: 'Search inside dataset cells',
    summary: 'Find words inside dataset cells',
    description:
      'Finds words in the text cells of datasets you can see, with the dataset, the row, the field and a snippet, best match first.',
    kind: 'read',
    inputs: [
      note('p_query', 'text', 'The words to find.'),
      note('p_limit', 'int', 'At most this many.', false),
    ],
    result:
      'rows:dataset_id=uuid,dataset_version_id=uuid,dataset_name=text,row_id=uuid,field_label=text,value_text=text,snippet=text,rank=num',
    docsPage: DOCS,
  },
  {
    name: 'search_did_you_mean',
    label: 'Suggest close matches',
    summary: 'Suggest things with a name close to the words',
    description:
      'Records, projects and other things whose name or ID is close to what was typed, for a search that found nothing. Most similar first.',
    kind: 'read',
    inputs: [
      note('p_query', 'text', 'What was typed.'),
      note('p_limit', 'int', 'At most this many.', false),
      note('p_include_archived', 'bool', 'Include archived things.', false),
    ],
    result: 'rows:id=uuid,kind=text,identifier=text,title=text,similarity=num',
    docsPage: DOCS,
  },
  {
    name: 'search_facets',
    label: 'Count search results by kind',
    summary: 'Count search matches by type, kind and project',
    description:
      'How many things match a search, grouped by result type, kind and project, with the same filters as the search page. Leave a filter out to not filter on it.',
    kind: 'read',
    inputs: [
      note('p_query', 'text', 'The words to find.', false, true),
      note('p_project_id', 'uuid', 'Only this project.', false, true),
      note('p_kind', 'text', 'Only this kind.', false, true),
      note('p_status', 'text', 'Only this status.', false, true),
      note('p_owner_id', 'text', 'Only this owner (user id).', false, true),
      note('p_date_from', 'ts', 'Changed on or after.', false, true),
      note('p_date_to', 'ts', 'Changed on or before.', false, true),
      note('p_result_type', 'text', 'Only this result type.', false, true),
      note('p_include_archived', 'bool', 'Include archived.', false),
      note('p_filter', 'json', 'JSON field filter.', false, true),
    ],
    result:
      'rows:result_type=text,kind=text,project_id=uuid,in_text=bool,match_count=bigint',
    docsPage: DOCS,
  },
  // -- sheets, planning and samples --------------------------------------------
  {
    name: 'resolve_cell_conflict',
    label: 'Settle a cell conflict',
    summary: 'Settle a sheet cell that two people changed at once',
    description:
      'Settles a cell that changed in two places while one was offline: the value to keep (either side’s, or another) and why. The decision goes into the sheet’s history under your name. Needs to edit the sheet. Returns the conflict.',
    kind: 'write',
    inputs: [
      note('p_conflict_id', 'uuid', 'Conflict id.'),
      note('p_value', 'json', 'The value to keep, as JSON.', true, true),
      note('p_reason', 'text', 'Why this value.'),
    ],
    result: 'row:sheet_cell_conflicts',
    assistant: card('sheetbase.sheet.resolve_conflict'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'assign_planner_item_to_study',
    label: 'File planner work under a study',
    summary: 'File a planner workstream or task under a study',
    description:
      'Puts a workstream (with its tasks that have no study) or a single task under a study. Give exactly one of the workstream and the task. Needs to edit both.',
    kind: 'write',
    inputs: [
      note('p_study_record_id', 'uuid', 'The study’s record id.'),
      note('p_workstream_id', 'uuid', 'A workstream.', false, true),
      note('p_task_id', 'uuid', 'A task.', false, true),
    ],
    result: 'void',
    assistant: card('sheetbase.study.assign_item'),
    pipeline: {},
    docsPage: DOCS,
  },
  {
    name: 'sample_storage_locations',
    label: 'List the storage places samples use',
    summary: 'List the storage places samples name',
    description:
      'Every storage place named on a sample you can see that is not archived, once each.',
    kind: 'read',
    inputs: [],
    result: 'rows:location=text',
    docsPage: DOCS,
  },
])
