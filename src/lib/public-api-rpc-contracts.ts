/**
 * Concrete request/result contracts for every API-07 allowlisted RPC.
 * OpenAPI is generated from this catalogue so a developer can integrate
 * without reading SQL or application source.
 */
import { EXTERNAL_RPC_SCOPES } from '#/lib/external-token'
import { labRpcContracts } from '#/lib/lab-api-schemas'

export type JsonSchema = Record<string, unknown>

export interface RpcContract {
  summary: string
  description: string
  required: string[]
  properties: Record<string, JsonSchema>
  result: JsonSchema
}

const UUID: JsonSchema = { type: 'string', format: 'uuid' }
const TEXT: JsonSchema = { type: 'string' }
const BOOL: JsonSchema = { type: 'boolean' }
const INT: JsonSchema = { type: 'integer' }
const BIGINT: JsonSchema = { type: 'integer', format: 'int64' }
const TIMESTAMPTZ: JsonSchema = { type: 'string', format: 'date-time' }
const TEXT_ARRAY: JsonSchema = { type: 'array', items: { type: 'string' } }

/** One entry of the (id, order) block list the block RPCs return. */
const BLOCK_ORDER_ENTRY: JsonSchema = obj(
  {
    id: { ...UUID, description: 'Block UUID.' },
    order: { type: 'number', description: 'Fractional position.' },
  },
  ['id', 'order'],
)
const BLOCK_ORDER_LIST: JsonSchema = {
  type: 'array',
  items: BLOCK_ORDER_ENTRY,
  description: 'Full (id, order) list for the record after the operation.',
}

function uuid(description: string): JsonSchema {
  return { ...UUID, description }
}
function text(description: string, extras: JsonSchema = {}): JsonSchema {
  return { ...TEXT, description, ...extras }
}
function bool(description: string): JsonSchema {
  return { ...BOOL, description }
}
function int(
  description: string,
  extras: { minimum?: number; maximum?: number; default?: number } = {},
): JsonSchema {
  return { ...INT, description, ...extras }
}
function bigint(description: string): JsonSchema {
  return { ...BIGINT, description }
}
function obj(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  description?: string,
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(description ? { description } : {}),
  }
}

function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` }
}

function jsonMap(description: string): JsonSchema {
  return {
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/JsonValue' },
    description,
  }
}

function jsonArray(description: string): JsonSchema {
  return {
    type: 'array',
    items: { $ref: '#/components/schemas/JsonValue' },
    description,
  }
}

const parameterInputs: JsonSchema = {
  type: 'array',
  maxItems: 64,
  items: ref('SheetParameterInput'),
  description:
    'JSON array of `{ parameterId, kind, … }` inputs. Empty array when unused. Not a map.',
}

const sheetDefinitionDecisions: JsonSchema = {
  type: 'array',
  maxItems: 512,
  items: ref('SheetDefinitionUpgradeDecision'),
  description:
    'One decision per preview conflict. Outcomes: retain-local, map (+ targetId), defer.',
}

const notebookDecisions: JsonSchema = {
  type: 'array',
  items: ref('NotebookUpgradeDecision'),
  description:
    'One decision per notebook upgrade conflict. Outcomes: keep or retarget (with optional instanceDecisions).',
}

const datasetFilter = obj(
  {
    fieldId: uuid('Active Dataset Schema field UUID.'),
    operator: {
      type: 'string',
      enum: ['eq', 'gt', 'gte', 'lt', 'lte'],
      description:
        '`eq` is valid for every logical type. `gt`/`gte`/`lt`/`lte` are valid only for integer, decimal, date and timestamp fields.',
    },
    value: {
      $ref: '#/components/schemas/JsonScalar',
      description:
        'Scalar matching the field logical type (string/number/boolean). Category and reference fields take UUIDs.',
    },
  },
  ['fieldId', 'operator', 'value'],
)

const datasetQuery = obj(
  {
    filters: {
      type: 'array',
      maxItems: 8,
      items: datasetFilter,
      description: 'At most eight filters. Combined with AND.',
    },
    sort: obj(
      {
        fieldId: uuid('Active field to sort by.'),
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
      ['fieldId', 'direction'],
    ),
  },
  [],
  'Only `filters` and `sort` are allowed. Pagination is `p_limit` / `p_offset`, not inside this object.',
)

const datasetBatchRow = obj(
  {
    operation: { type: 'string', enum: ['create', 'update'] },
    rowId: uuid('Caller-supplied row UUID. Creates must use a fresh id.'),
    expectedRevision: {
      type: 'integer',
      minimum: 1,
      description: 'Required for `update`. Must be omitted for `create`.',
    },
    values: jsonMap(
      'Map of Schema field UUID → canonical cell value (or null). Keys must be field UUIDs on the Dataset’s current Schema Version.',
    ),
  },
  ['operation', 'rowId', 'values'],
)

const datasetBatchError = obj({
  rowIndex: INT,
  rowId: UUID,
  fieldId: UUID,
  code: TEXT,
  expectedRevision: BIGINT,
  actualRevision: BIGINT,
})

const datasetQueryResult = obj(
  {
    datasetId: UUID,
    datasetRevision: BIGINT,
    offset: INT,
    limit: INT,
    totalCount: INT,
    hasMore: BOOL,
    rows: {
      type: 'array',
      items: obj(
        {
          rowId: UUID,
          revision: BIGINT,
          values: jsonMap(
            'Field UUID → canonical value (arrays when cardinality is many).',
          ),
        },
        ['rowId', 'revision', 'values'],
      ),
    },
  },
  [
    'datasetId',
    'datasetRevision',
    'offset',
    'limit',
    'totalCount',
    'hasMore',
    'rows',
  ],
)

const datasetCommitSuccess = obj(
  {
    ok: { type: 'boolean', const: true },
    datasetId: UUID,
    datasetRevision: BIGINT,
    rows: {
      type: 'array',
      items: obj(
        {
          rowId: UUID,
          revision: BIGINT,
          operation: { type: 'string', enum: ['create', 'update'] },
        },
        ['rowId', 'revision', 'operation'],
      ),
    },
    idempotent: {
      type: 'boolean',
      description:
        '`false` on the first successful commit. `true` when the same actor retries the same `p_idempotency_key` with an identical request digest. A reused key with a different digest fails with conflict.',
    },
  },
  ['ok', 'datasetId', 'datasetRevision', 'rows', 'idempotent'],
)

const datasetValidateResult = {
  oneOf: [
    obj({ ok: { type: 'boolean', const: true } }, ['ok']),
    obj(
      {
        ok: { type: 'boolean', const: false },
        errors: { type: 'array', items: datasetBatchError, minItems: 1 },
      },
      ['ok', 'errors'],
    ),
  ],
}

const recordRow = ref('RecordsRow')
const blockRow = ref('BlocksRow')
const projectRow = ref('ProjectsRow')
const datasetRow = ref('DatasetsRow')
const datasetVersionRow = ref('DatasetVersionsRow')
const sheetInstanceRow = ref('SheetInstancesRow')
const recordLinkRow = ref('RecordLinksRow')
const revisionRow = ref('RevisionsRow')
const webhookSubscriptionRow = ref('WebhookSubscriptionsRow')
const webhookDeliveryRow = ref('WebhookDeliveriesRow')
const pipelineVersionRow = ref('PipelineDefinitionVersionsRow')
const memberAbsenceRow = ref('MemberAbsencesRow')
const groupMappingRow = ref('IdpGroupMappingsRow')
const scimTokenRow = ref('ScimTokensRow')
const signatureTimestampRow = ref('SignatureTimestampsRow')
const ontologyAnnotationRow = ref('OntologyAnnotationsRow')
const publicationTargetRow = ref('PublicationTargetsRow')
const publicationRow = ref('PublicationsRow')

const lakeSettingsResult: JsonSchema = obj(
  {
    enabled: bool('Whether open tables are written.'),
    exporterUserId: { type: ['string', 'null'], description: 'Whose access the tables follow.' },
    lastRunAt: { type: ['string', 'null'], description: 'When the last pass finished.' },
    lastStatus: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
    refreshRequestedAt: { type: ['string', 'null'] },
    canIssueLogins: bool('Whether this installation can issue table logins.'),
    tableCount: int('Tables written, not counting retired ones.'),
  },
  ['enabled'],
  'Open-table settings and the last pass.',
)

const ontologySettingsResult: JsonSchema = obj(
  {
    enabled: bool('Whether ontology search is allowed.'),
    ontologies: { type: 'array', items: { type: 'string' }, description: 'Ontologies that may be searched.' },
  },
  ['enabled'],
  'Ontology lookup settings.',
)

const lakeLoginRow = obj(
  {
    id: uuid('Login UUID.'),
    name: text('Name given to the login.'),
    username: text('The database user name.'),
    user_id: text('Who owns it.'),
    created_at: { type: 'string', format: 'date-time' },
    expires_at: { type: ['string', 'null'], format: 'date-time' },
    revoked_at: { type: ['string', 'null'], format: 'date-time' },
    last_used_at: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: ['active', 'expired', 'revoked', 'suspended'] },
  },
  ['id', 'name', 'username', 'status'],
  'A table login. The password is never returned.',
)

const timestampSettingsResult: JsonSchema = obj(
  {
    enabled: bool('Whether signatures are sent for timestamping.'),
    authority: {
      type: ['string', 'null'],
      enum: ['dfn', 'digicert', 'custom', null],
    },
    url: { type: ['string', 'null'], description: 'The service address.' },
  },
  ['enabled'],
  'Which time-stamping service the workspace uses.',
)

const pgrstRow = (row: JsonSchema, description: string): JsonSchema => ({
  description: `${description} PostgREST returns a JSON array of composite rows by default.`,
  oneOf: [row, { type: 'array', items: row }],
})

const sheetRecordWriteTarget = ref('SheetRecordWriteTarget')

const localFieldChange: JsonSchema = {
  oneOf: [
    obj(
      {
        operation: { type: 'string', const: 'add' },
        field: ref('SheetFieldDefinition'),
      },
      ['operation', 'field'],
    ),
    obj(
      {
        operation: { type: 'string', const: 'edit' },
        field: ref('SheetFieldDefinition'),
      },
      ['operation', 'field'],
    ),
    obj(
      {
        operation: { type: 'string', const: 'retire' },
        fieldId: UUID,
      },
      ['operation', 'fieldId'],
    ),
  ],
}

const addressedRow: JsonSchema = {
  oneOf: [
    obj(
      {
        kind: { type: 'string', const: 'composed' },
        rowKey: text('Composed row key (`sb-row-v1:<hex>`).'),
        identityValues: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { $ref: '#/components/schemas/JsonValue' },
        },
        compositionOffset: int('Current composition page offset.', {
          minimum: 0,
          maximum: 10_000,
        }),
      },
      ['kind', 'rowKey', 'identityValues', 'compositionOffset'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'local' },
        rowKey: UUID,
      },
      ['kind', 'rowKey'],
    ),
  ],
}

export const RPC_CONTRACTS: Record<string, RpcContract> = {
  preview_member_handover: {
    summary: 'Preview the open work that could be handed over',
    description:
      'Counts what a member still has open: assigned records by kind, reviewer names, tasks, reviews waiting, instruments and default project reviews. Allowed for members access, or for the person themselves.',
    required: ['p_workspace_id', 'p_user_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_user_id: text('The member whose open work to count.'),
    },
    result: {
      type: 'array',
      items: obj(
        {
          category: text(
            '`record`, `record_reviewer`, `task`, `review`, `instrument` or `project_reviewer`.',
          ),
          record_kind: { ...TEXT, nullable: true },
          n: int('How many are open.'),
        },
        ['category', 'n'],
      ),
    },
  },
  hand_over_member_work: {
    summary: 'Hand a member’s open work to a colleague',
    description:
      'Moves the chosen open work and reports `moved` and `kept` counts. Signed, locked, archived and finished work stays, as does anything the colleague cannot see or review. Selection names: `record:<kind>`, `record_reviewer`, `task`, `review`, `instrument`, `project_reviewer`.',
    required: [
      'p_workspace_id',
      'p_from_user_id',
      'p_to_user_id',
      'p_selection',
    ],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_from_user_id: text('The member whose work moves.'),
      p_to_user_id: text('The colleague who takes over.'),
      p_selection: { ...TEXT_ARRAY, description: 'What to move.' },
    },
    result: obj(
      {
        moved: jsonMap('Counts moved, by selection name.'),
        kept: jsonMap('Counts that had to stay, by selection name.'),
      },
      ['moved', 'kept'],
    ),
  },
  set_member_absence: {
    summary: 'Set an out of office',
    description:
      'Names the days a member is away and, optionally, the colleague who covers reviews waiting on them. Replaces any absence that overlaps. Omit `p_user_id` to set your own; setting someone else’s needs members access.',
    required: [
      'p_workspace_id',
      'p_starts_on',
      'p_ends_on',
      'p_delegate_user_id',
    ],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_starts_on: {
        type: 'string',
        format: 'date',
        description: 'First day away.',
      },
      p_ends_on: {
        type: 'string',
        format: 'date',
        description: 'Last day away.',
      },
      p_delegate_user_id: {
        ...TEXT,
        nullable: true,
        description: 'The covering colleague, or null for none.',
      },
      p_note: { ...TEXT, nullable: true, description: 'Shown to colleagues.' },
      p_user_id: {
        ...TEXT,
        nullable: true,
        description: 'Who is away. Defaults to the caller.',
      },
    },
    result: pgrstRow(memberAbsenceRow, 'The absence.'),
  },
  cancel_member_absence: {
    summary: 'Cancel an out of office',
    description: 'Ends the absence and withdraws the cover it added.',
    required: ['p_absence_id'],
    properties: { p_absence_id: uuid('Absence UUID.') },
    result: pgrstRow(memberAbsenceRow, 'The cancelled absence.'),
  },
  set_idp_group_mapping: {
    summary: 'Map a sign-in group to a role',
    description:
      'Needs members access. People in the group get the role the next time they sign in through the identity provider; the highest mapped role wins and anyone in no mapped group becomes a viewer.',
    required: ['p_workspace_id', 'p_group_name', 'p_role'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_group_name: text('The group as the identity provider spells it.'),
      p_role: text(
        '`admin`, `steward`, `scientist`, `analyst`, `reviewer` or `viewer`.',
      ),
    },
    result: pgrstRow(groupMappingRow, 'The mapping.'),
  },
  remove_idp_group_mapping: {
    summary: 'Remove a sign-in group mapping',
    description: 'Needs members access.',
    required: ['p_id'],
    properties: { p_id: uuid('Mapping UUID.') },
    result: { description: 'No content.', type: 'null' },
  },
  adopt_group_roles: {
    summary: 'Let sign-in groups decide roles',
    description:
      'Needs members access. Hands everyone except owners and client accounts over to group control and returns how many people changed.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: { type: 'integer', description: 'People now decided by groups.' },
  },
  directory_sync_status: {
    summary: 'Directory sync status',
    description:
      'Needs members access. Whether an identity provider keeps people and groups in step through SCIM: live tokens, when it last called, people and groups it manages, and how many of those groups give a role.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        active_tokens: { type: 'integer' },
        last_called_at: { type: 'string', format: 'date-time', nullable: true },
        people_managed: { type: 'integer' },
        people_switched_off: { type: 'integer' },
        groups: { type: 'integer' },
        groups_giving_a_role: { type: 'integer' },
      },
    },
  },
  revoke_scim_token: {
    summary: 'Revoke a directory sync token',
    description:
      'Needs members access. The identity provider that held the token can no longer call the SCIM endpoint. People it already created stay as they are. Making a token is done at the settings page, where the secret is shown once.',
    required: ['p_id'],
    properties: { p_id: uuid('Token UUID.') },
    result: pgrstRow(scimTokenRow, 'The revoked token.'),
  },

  event_stream_page: {
    summary: 'Read a page of the event stream',
    description:
      'Changes in the workspace in order, after the sequence in `p_after`, that the caller could see in the app. Returns `events` (rows with `sequence`, `entity_type`, `operation` and `payload`), `nextCursor`, `hasMore`, the `earliest` and `latest` kept, `expired` (the cursor is older than the events kept) and `retentionDays`. `GET /api/events/stream` serves the same thing as CloudEvents and a live stream.',
    required: [],
    properties: {
      p_after: bigint('Last sequence handled; 0 starts at the oldest kept.'),
      p_limit: int('Events per page.', {
        minimum: 1,
        maximum: 1000,
        default: 200,
      }),
      p_entity_types: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Only these kinds of change, such as `pipeline_reproduction`.',
      },
    },
    result: obj(
      {
        events: jsonArray('The events.'),
        nextCursor: bigint('Pass as `p_after` for the next page.'),
        hasMore: bool('More events are waiting.'),
        earliest: { type: ['integer', 'null'] },
        latest: { type: ['integer', 'null'] },
        expired: bool('The cursor was older than the events kept.'),
        retentionDays: int('Days of history kept.'),
      },
      ['events', 'nextCursor', 'hasMore'],
      'A page of the event stream.',
    ),
  },
  timestamp_settings: {
    summary: 'Read the time-stamping service',
    description:
      'Which independent time-stamping service signatures are sent to for a trusted timestamp, if any. Only a SHA-256 fingerprint of each signature record is sent.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: timestampSettingsResult,
  },
  set_timestamp_settings: {
    summary: 'Choose the time-stamping service',
    description:
      'Needs audit access and a personal token. `dfn` and `digicert` use the services named; `custom` needs the address of an RFC 3161 service. Turning it on sends a fingerprint of each new signature to that service.',
    required: ['p_workspace_id', 'p_enabled'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_enabled: bool('false stops sending signatures for timestamping.'),
      p_authority: text('`dfn`, `digicert` or `custom`.', { nullable: true }),
      p_url: text('The service address, for `custom`.', { nullable: true }),
    },
    result: timestampSettingsResult,
  },
  request_signature_timestamp: {
    summary: 'Ask for a signature to be timestamped again',
    description:
      'Needs audit access. Queues a signature whose timestamp is missing or gave up; the server asks the service within a minute. A signature already stamped is left as it is.',
    required: ['p_signature_id'],
    properties: { p_signature_id: uuid('Signature UUID.') },
    result: pgrstRow(signatureTimestampRow, 'The timestamp record.'),
  },
  lake_settings: {
    summary: 'Read the open-table settings',
    description:
      'Whether the workspace writes open tables, whose access they follow, and how the last pass went.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: lakeSettingsResult,
  },
  set_lake_settings: {
    summary: 'Turn open tables on or off',
    description:
      'Needs integrations access and data access, and a personal token. The tables hold what the person who turns them on can see, so that person needs data access. Turning them off stops updates; files already written stay on storage.',
    required: ['p_workspace_id', 'p_enabled'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_enabled: bool('false stops writing open tables.'),
    },
    result: lakeSettingsResult,
  },
  request_lake_refresh: {
    summary: 'Ask for open tables to be refreshed now',
    description: 'Queues a pass; the server runs it within a minute.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: lakeSettingsResult,
  },
  list_lake_credentials: {
    summary: 'List table logins',
    description: 'Needs data access. Lists logins that can read the open tables; passwords are never returned.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: { type: 'array', items: lakeLoginRow },
  },
  revoke_lake_credential: {
    summary: 'Revoke a table login',
    description: 'The login stops working straight away. Making a login is done at the settings page, where the password is shown once.',
    required: ['p_workspace_id', 'p_credential_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_credential_id: uuid('Login UUID.'),
    },
    result: { description: 'No content.', type: 'null' },
  },
  ontology_settings: {
    summary: 'Read the ontology lookup settings',
    description: 'Whether searching the EBI Ontology Lookup Service is allowed, and which ontologies.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: ontologySettingsResult,
  },
  set_ontology_settings: {
    summary: 'Allow or stop ontology lookup',
    description:
      'Needs integrations access. When on, what people type in the term search is sent to the EBI Ontology Lookup Service.',
    required: ['p_workspace_id', 'p_enabled'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_enabled: bool('false turns lookup off.'),
      p_ontologies: {
        type: ['array', 'null'],
        items: { type: 'string' },
        description: 'Short names of the ontologies to search. Null keeps the current list.',
      },
    },
    result: ontologySettingsResult,
  },
  link_ontology_term: {
    summary: 'Attach an ontology term to a field',
    description: 'Needs schema access. Linking the same term twice returns the existing link.',
    required: ['p_workspace_id', 'p_target_kind', 'p_target_id', 'p_ontology', 'p_iri', 'p_label'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_target_kind: text('`model_field`, `schema_field`, `definition_field` or `vocabulary_term`.'),
      p_target_id: uuid('The field or term UUID.'),
      p_ontology: text('Short ontology name, for example `chebi`.'),
      p_iri: text('The term’s IRI.'),
      p_label: text('The term’s label.'),
      p_short_form: text('The term’s short id, for example `CHEBI_15377`.', { nullable: true }),
    },
    result: pgrstRow(ontologyAnnotationRow, 'The link.'),
  },
  unlink_ontology_term: {
    summary: 'Remove an ontology term from a field',
    description: 'Needs schema access.',
    required: ['p_annotation_id'],
    properties: { p_annotation_id: uuid('Link UUID.') },
    result: { description: 'No content.', type: 'null' },
  },
  save_publication_target: {
    summary: 'Add or change a publishing repository',
    description:
      'Needs integrations access. Pass `p_id` null to add one. The access token is set at the settings page, never over the API.',
    required: ['p_workspace_id', 'p_kind', 'p_name', 'p_base_url'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_id: uuid('Repository UUID to change, or null to add.'),
      p_kind: text('`zenodo`, `invenio`, `figshare` or `dataverse`.'),
      p_name: text('A name people recognise.'),
      p_base_url: text('The repository’s web address.'),
      p_collection: text('Dataverse alias or InvenioRDM community.', { nullable: true }),
      p_license: text('Default licence id, for example `cc-by-4.0`.'),
      p_enabled: bool('Whether it is offered when publishing.'),
    },
    result: pgrstRow(publicationTargetRow, 'The repository.'),
  },
  delete_publication_target: {
    summary: 'Remove a publishing repository',
    description: 'Needs integrations access. Existing publications keep their DOI.',
    required: ['p_id'],
    properties: { p_id: uuid('Repository UUID.') },
    result: { description: 'No content.', type: 'null' },
  },
  request_publication: {
    summary: 'Ask to publish an experiment or dataset version',
    description:
      'Packages the object as an RO-Crate (with a Workflow Run Crate when a pipeline run produced it) and sends a draft to the repository, which reserves a DOI. Nothing is public until a person publishes it in the app.',
    required: ['p_target_id', 'p_object_kind', 'p_object_id'],
    properties: {
      p_target_id: uuid('Repository UUID.'),
      p_object_kind: text('`experiment` or `dataset_version`.'),
      p_object_id: uuid('The experiment or dataset version UUID.'),
      p_title: text('Title of the record. Defaults to the object’s name.', { nullable: true }),
      p_license: text('Licence id. Defaults to the repository’s.', { nullable: true }),
    },
    result: pgrstRow(publicationRow, 'The publication, queued.'),
  },
  discard_publication: {
    summary: 'Discard a publication draft',
    description: 'Only a draft that is not public can be discarded.',
    required: ['p_id'],
    properties: { p_id: uuid('Publication UUID.') },
    result: pgrstRow(publicationRow, 'The publication.'),
  },
  retry_publication: {
    summary: 'Try a failed publication again',
    description: 'Queues a publication that gave up.',
    required: ['p_id'],
    properties: { p_id: uuid('Publication UUID.') },
    result: pgrstRow(publicationRow, 'The publication.'),
  },

  workspace_signing_key: {
    summary: 'Read the key that signs export bundles',
    description:
      'The public half of the workspace’s Ed25519 export key and its fingerprint, or null before the first signed bundle is downloaded. Compare the fingerprint with the one inside a bundle.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: {
      description: 'The key, or null.',
      type: ['object', 'null'],
      properties: {
        algorithm: { type: 'string', const: 'ed25519' },
        publicKeyPem: { type: 'string' },
        fingerprint: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  },

  create_project: {
    summary: 'Create a project',
    description:
      'Inserts a project in the JWT workspace. Returns the `api.projects` row.',
    required: ['p_title'],
    properties: { p_title: text('Project title.') },
    result: pgrstRow(projectRow, 'Created project.'),
  },
  create_record: {
    summary: 'Create a model record',
    description:
      'Creates a record and assigns a stable `{PREFIX}-YYYY-NNNN` identifier. Direct POST to `records` is also allowlisted; prefer this RPC.',
    required: [
      'p_project_id',
      'p_kind',
      'p_title',
      'p_status',
      'p_tags',
      'p_properties',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_kind: text('Record kind, e.g. experiment, sample, material.'),
      p_title: text('Record title.'),
      p_status: text('Lifecycle status string.'),
      p_tags: { ...TEXT_ARRAY, description: 'Tags. Pass `[]` when unused.' },
      p_properties: jsonMap(
        'Kind-specific properties object. Pass `{}` when unused.',
      ),
    },
    result: pgrstRow(recordRow, 'Created record.'),
  },
  create_record_with_blocks: {
    summary: 'Create a record with initial blocks',
    description:
      'One transaction: `create_record` plus initial notebook blocks. Use `p_expected_structure_version` on later block RPCs.',
    required: [
      'p_project_id',
      'p_kind',
      'p_title',
      'p_status',
      'p_tags',
      'p_blocks',
      'p_properties',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_kind: text('Record kind.'),
      p_title: text('Record title.'),
      p_status: text('Status.'),
      p_tags: TEXT_ARRAY,
      p_blocks: {
        type: 'array',
        items: obj(
          {
            type: text('Block type, e.g. rich_text.'),
            payload: jsonMap('Type-specific payload.'),
            order: { type: 'number' },
          },
          ['type', 'payload'],
        ),
      },
      p_properties: jsonMap('Kind-specific properties. Pass `{}` when unused.'),
    },
    result: obj(
      {
        record: recordRow,
        blocks: { type: 'array', items: blockRow },
      },
      ['record', 'blocks'],
    ),
  },
  update_block_payload: {
    summary: 'Update a block payload',
    description:
      'Fails with `stale_version` (SB001) when `p_expected_version` does not match `blocks.version`.',
    required: [
      'p_block_id',
      'p_payload',
      'p_expected_version',
      'p_payload_schema_version',
    ],
    properties: {
      p_block_id: uuid('Block UUID.'),
      p_payload: jsonMap('Replacement payload for this block type.'),
      p_expected_version: int('Current `blocks.version`.', { minimum: 1 }),
      p_payload_schema_version: int('Payload schema version.', { minimum: 1 }),
    },
    result: pgrstRow(blockRow, 'Updated block.'),
  },
  move_block: {
    summary: 'Move a block',
    description:
      'Reorders a block. Supply the neighbours that should sit after the move. Concurrency: `p_expected_structure_version`.',
    required: [
      'p_block_id',
      'p_expected_structure_version',
      'p_after_block_id',
      'p_before_block_id',
    ],
    properties: {
      p_block_id: uuid('Block to move.'),
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
      p_after_block_id: {
        ...UUID,
        description: 'Block that should precede this one, or null.',
        nullable: true,
      },
      p_before_block_id: {
        ...UUID,
        description: 'Block that should follow this one, or null.',
        nullable: true,
      },
    },
    result: obj(
      {
        block: blockRow,
        structure_version: INT,
        rebalanced: BOOL,
        order: BLOCK_ORDER_LIST,
      },
      ['block', 'structure_version'],
    ),
  },
  archive_record: {
    summary: 'Archive a record',
    description: 'Soft-archive. Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Archived record.'),
  },
  restore_record: {
    summary: 'Restore an archived record',
    description:
      'Clears `archived_at`. Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Restored record.'),
  },
  create_record_link: {
    summary: 'Create a record link',
    description:
      'Links a source record to a target in the workspace. Unresolved targets fail as `missing_link`.',
    required: [
      'p_source_record_id',
      'p_target_kind',
      'p_target_identifier',
      'p_link_type',
      'p_target_record_id',
      'p_label',
    ],
    properties: {
      p_source_record_id: uuid('Source record.'),
      p_target_kind: text('Target kind.'),
      p_target_identifier: text('Target public identifier.'),
      p_link_type: text('Link type, e.g. protocol.'),
      p_target_record_id: {
        ...UUID,
        nullable: true,
        description: 'Target record UUID when resolved.',
      },
      p_label: {
        ...TEXT,
        nullable: true,
        description: 'Optional display label.',
      },
    },
    result: pgrstRow(recordLinkRow, 'Created link.'),
  },
  insert_block: {
    summary: 'Insert a notebook block',
    description:
      'Inserts between the supplied anchors: `p_after_block_id` only inserts after it (null appends), `p_before_block_id` only inserts before it (start), both anchors insert strictly between them (23514 if inverted). Concurrency: `p_expected_structure_version`.',
    required: [
      'p_record_id',
      'p_type',
      'p_payload',
      'p_payload_schema_version',
      'p_after_block_id',
      'p_expected_structure_version',
      'p_before_block_id',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_type: text('Block type.'),
      p_payload: jsonMap('Block payload for this type.'),
      p_payload_schema_version: int('Payload schema version.', { minimum: 1 }),
      p_after_block_id: {
        ...UUID,
        nullable: true,
        description: 'Block that should precede this one, or null to append.',
      },
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
      p_before_block_id: {
        ...UUID,
        nullable: true,
        description: 'Block that should follow this one, or null.',
      },
    },
    result: obj(
      {
        block: blockRow,
        structure_version: INT,
        rebalanced: BOOL,
        order: BLOCK_ORDER_LIST,
      },
      ['block', 'structure_version'],
    ),
  },
  delete_block: {
    summary: 'Delete a notebook block',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: ['p_block_id', 'p_expected_structure_version'],
    properties: {
      p_block_id: uuid('Block UUID.'),
      p_expected_structure_version: int(
        'Current `records.structure_version`.',
        {
          minimum: 1,
        },
      ),
    },
    result: obj(
      {
        structure_version: INT,
        order: BLOCK_ORDER_LIST,
      },
      ['structure_version'],
    ),
  },
  transition_record_status: {
    summary: 'Transition record status',
    description:
      'Allowed transitions are kind-specific. Disallowed transitions return `invalid_transition` (SB004). Concurrency: `p_expected_metadata_version`.',
    required: ['p_record_id', 'p_target_status', 'p_expected_metadata_version'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_target_status: text('Target status.'),
      p_expected_metadata_version: int('Current `records.metadata_version`.', {
        minimum: 1,
      }),
    },
    result: pgrstRow(recordRow, 'Updated record.'),
  },
  instantiate_template: {
    summary: 'Instantiate a protocol/notebook record template',
    description:
      'Copies a template record into a project. Notebook Template Version instantiation is `instantiate_notebook_template_version`.',
    required: [
      'p_template_record_id',
      'p_target_project_id',
      'p_target_kind',
      'p_title',
    ],
    properties: {
      p_template_record_id: uuid('Template record UUID.'),
      p_target_project_id: uuid('Destination project.'),
      p_target_kind: text('Kind for the new record.'),
      p_title: text('Title for the new record.'),
    },
    result: obj(
      {
        record: recordRow,
        blocks: { type: 'array', items: blockRow },
        revision: revisionRow,
        link: recordLinkRow,
      },
      ['record', 'blocks'],
    ),
  },
  query_dataset_rows: {
    summary: 'Query live Dataset rows',
    description:
      'Bounded window over the live Dataset. `p_query` may contain only `filters` (max 8) and `sort`. `p_limit` is 1–1000 (default 200). `p_offset` ≥ 0.',
    required: ['p_dataset_id'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_query: datasetQuery,
      p_limit: int('Page size.', { minimum: 1, maximum: 1000, default: 200 }),
      p_offset: int('Row offset.', { minimum: 0, default: 0 }),
    },
    result: datasetQueryResult,
  },
  query_dataset_version_rows: {
    summary: 'Query immutable Dataset Version rows',
    description:
      '`p_limit` 1–1000 (default 200). `p_offset` ≥ 0. No field filters; historical projection is fixed.',
    required: ['p_dataset_version_id'],
    properties: {
      p_dataset_version_id: uuid('Dataset Version UUID.'),
      p_limit: int('Page size.', { minimum: 1, maximum: 1000, default: 200 }),
      p_offset: int('Row offset.', { minimum: 0, default: 0 }),
    },
    result: obj(
      {
        datasetVersionId: UUID,
        datasetId: UUID,
        schemaVersionId: UUID,
        sourceDatasetRevision: BIGINT,
        offset: INT,
        limit: INT,
        totalCount: INT,
        rows: {
          type: 'array',
          items: obj({
            rowId: UUID,
            revision: BIGINT,
            values: jsonMap('Field UUID → canonical value.'),
          }),
        },
      },
      [
        'datasetVersionId',
        'datasetId',
        'schemaVersionId',
        'sourceDatasetRevision',
        'offset',
        'limit',
        'totalCount',
        'rows',
      ],
    ),
  },
  query_dataset_version_transfer: {
    summary: 'Read a lossless immutable Dataset Version transfer page',
    description:
      'Versioned transfer envelope, requiring datasets:read and schema:read. metadataJson and each row canonicalJson are authoritative UTF-8 JSON strings with every numeric atom encoded as an exact decimal string. Full pinned field metadata, ordered many-values and all frozen QC flags are retained. Values are raw, not filtered by flags. Verify SHA-256 of the supplied byte strings. pageChecksum and terminal snapshotChecksum hash metadataChecksum + LF + ordered row SHA-256 hex strings, each followed by LF. Ordinary row-query and file-export formats are unchanged.',
    required: ['p_dataset_version_id'],
    properties: {
      p_dataset_version_id: uuid('Immutable Dataset Version UUID.'),
      p_limit: int('Page size.', { minimum: 1, maximum: 1000, default: 1000 }),
      p_offset: int('Row offset, at most totalCount.', {
        minimum: 0,
        default: 0,
      }),
    },
    result: obj(
      {
        format: {
          type: 'string',
          const: 'sheetbase.dataset-version-transfer/1',
        },
        metadataJson: text(
          'Canonical JSON metadata, including stable IDs, complete pinned fields and population semantics.',
        ),
        metadataChecksum: text('SHA-256 of metadataJson UTF-8 bytes.'),
        offset: INT,
        limit: INT,
        totalCount: INT,
        hasMore: BOOL,
        rows: {
          type: 'array',
          items: obj(
            {
              rowId: UUID,
              canonicalJson: text(
                'Canonical JSON {rowId,revision,values,flags}. Numeric atoms are exact strings; arrays preserve ordinals.',
              ),
              sha256: text('SHA-256 of canonicalJson UTF-8 bytes.'),
            },
            ['rowId', 'canonicalJson', 'sha256'],
          ),
        },
        pageChecksum: TEXT,
        snapshotChecksum: {
          type: ['string', 'null'],
          description:
            'Full snapshot checksum on the terminal page, null otherwise.',
        },
      },
      [
        'format',
        'metadataJson',
        'metadataChecksum',
        'offset',
        'limit',
        'totalCount',
        'hasMore',
        'rows',
        'pageChecksum',
        'snapshotChecksum',
      ],
    ),
  },
  validate_dataset_row_batch: {
    summary: 'Validate a Dataset row batch',
    description:
      'Does not write. Requires `p_expected_dataset_revision` equal to `datasets.revision`. `p_rows` length 1–1000. Stale dataset revision returns `{ ok:false, errors:[{ code:"stale_dataset_revision" }] }` rather than throwing.',
    required: ['p_dataset_id', 'p_expected_dataset_revision', 'p_rows'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: datasetBatchRow,
      },
    },
    result: datasetValidateResult,
  },
  commit_dataset_row_batch: {
    summary: 'Commit a Dataset row batch',
    description:
      'Writes rows after the same validation as `validate_dataset_row_batch`. Idempotency field is `p_idempotency_key` (1–128 characters), scoped to the credential (or user) in the workspace. The request digest covers dataset id, expected revision and `p_rows`. Same key + same digest returns the stored result with `idempotent: true`. Same key + different digest is a conflict. Retry the identical body after transport failure; on `stale_version` / `stale_dataset_revision` re-read `datasets.revision` and use a new key.',
    required: [
      'p_dataset_id',
      'p_expected_dataset_revision',
      'p_rows',
      'p_idempotency_key',
    ],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: datasetBatchRow,
      },
      p_idempotency_key: text('Client command id. Length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: datasetCommitSuccess,
  },
  snapshot_dataset: {
    summary: 'Snapshot a Dataset Version',
    description:
      'Publishes an immutable Dataset Version. Concurrency: `p_expected_dataset_revision`.',
    required: ['p_dataset_id', 'p_expected_dataset_revision', 'p_label'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_dataset_revision: bigint('Current `datasets.revision`.'),
      p_label: text('Version label.'),
    },
    result: pgrstRow(datasetVersionRow, 'Created Dataset Version.'),
  },
  archive_dataset: {
    summary: 'Archive a Dataset',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_dataset_id', 'p_expected_revision'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_revision: bigint('Current `datasets.revision`.'),
    },
    result: pgrstRow(datasetRow, 'Archived Dataset.'),
  },
  restore_dataset: {
    summary: 'Restore an archived Dataset',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_dataset_id', 'p_expected_revision'],
    properties: {
      p_dataset_id: uuid('Dataset UUID.'),
      p_expected_revision: bigint('Current `datasets.revision`.'),
    },
    result: pgrstRow(datasetRow, 'Restored Dataset.'),
  },
  query_sheet_instance_rows: {
    summary: 'Query composed Sheet Instance rows',
    description:
      '`p_limit` 1–200 (default 50). `p_offset` 0–10000. Server-side composition window; there is no client filter object. Unresolved instances fail.',
    required: ['p_instance_id'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_limit: int('Page size.', { minimum: 1, maximum: 200, default: 50 }),
      p_offset: int('Row offset.', { minimum: 0, maximum: 10_000, default: 0 }),
    },
    result: ref('QuerySheetInstanceRowsResult'),
  },
  read_sheet_instance_calculation_results: {
    summary: 'Read Sheet calculation results',
    description: '`p_row_keys` is a JSON array of row-key strings to fetch.',
    required: ['p_instance_id', 'p_row_keys'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_row_keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Row keys (`sb-row-v1:…` or UUID).',
      },
    },
    result: ref('SheetCalculationResultsPage'),
  },
  resolve_sheet_instance_row_identity: {
    summary: 'Resolve Sheet row identity',
    description:
      'Computes resolved row identity. Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current `sheet_instances.revision`.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  preview_sheet_instance_composition_adoption: {
    summary: 'Preview composition adoption',
    description:
      'Read-only preview. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_parameter_inputs',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Sheet Definition Version.'),
      p_parameter_inputs: parameterInputs,
    },
    result: ref('CompositionAdoptionPreview'),
  },
  preview_sheet_materialization: {
    summary: 'Preview Sheet materialization',
    description: 'Read-only. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_output_schema_version_id',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_output_schema_version_id: uuid('Output Dataset Schema Version.'),
    },
    result: ref('MaterializationPreview'),
  },
  preview_sheet_instance_definition_upgrade: {
    summary: 'Preview Sheet Definition upgrade',
    description: 'Read-only. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
    },
    result: ref('SheetDefinitionUpgradePreview'),
  },
  create_sheet_instance: {
    summary: 'Create a Sheet Instance',
    description:
      '`p_state` is the instance state object (presentation, bindings, …). Does not author a Sheet Definition.',
    required: [
      'p_workspace_id',
      'p_name',
      'p_description',
      'p_source_definition_version_id',
      'p_project_id',
      'p_notebook_record_id',
      'p_state',
    ],
    properties: {
      p_workspace_id: uuid('Must match the JWT workspace_id.'),
      p_name: text('Instance name.'),
      p_description: { ...TEXT, nullable: true },
      p_source_definition_version_id: {
        ...UUID,
        nullable: true,
        description: 'Published Definition Version, or null for ad-hoc.',
      },
      p_project_id: { ...UUID, nullable: true },
      p_notebook_record_id: { ...UUID, nullable: true },
      p_state: ref('SheetInstanceState'),
    },
    result: pgrstRow(sheetInstanceRow, 'Created instance.'),
  },
  create_sheet_instance_from_definition: {
    summary: 'Create a Sheet Instance from a published Definition',
    description:
      'Source Definition Version must be published and active in the workspace.',
    required: [
      'p_workspace_id',
      'p_name',
      'p_description',
      'p_source_definition_version_id',
      'p_project_id',
      'p_notebook_record_id',
      'p_state',
      'p_parameter_inputs',
    ],
    properties: {
      p_workspace_id: uuid('JWT workspace.'),
      p_name: text('Instance name.'),
      p_description: { ...TEXT, nullable: true },
      p_source_definition_version_id: uuid('Published Definition Version.'),
      p_project_id: { ...UUID, nullable: true },
      p_notebook_record_id: { ...UUID, nullable: true },
      p_state: ref('SheetInstanceState'),
      p_parameter_inputs: parameterInputs,
    },
    result: pgrstRow(sheetInstanceRow, 'Created instance.'),
  },
  update_sheet_instance: {
    summary: 'Replace Sheet Instance state',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision', 'p_state'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_state: ref('SheetInstanceState'),
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  archive_sheet_instance: {
    summary: 'Archive a Sheet Instance',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Archived instance.'),
  },
  restore_sheet_instance: {
    summary: 'Restore a Sheet Instance',
    description: 'Concurrency: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision'],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
    },
    result: pgrstRow(sheetInstanceRow, 'Restored instance.'),
  },
  duplicate_sheet_instance: {
    summary: 'Duplicate a Sheet Instance',
    description: 'Concurrency on the source: `p_expected_revision`.',
    required: ['p_instance_id', 'p_expected_revision', 'p_name'],
    properties: {
      p_instance_id: uuid('Source instance.'),
      p_expected_revision: bigint('Current source revision.'),
      p_name: text('Name for the copy.'),
    },
    result: pgrstRow(sheetInstanceRow, 'New instance.'),
  },
  mutate_sheet_instance_local_state: {
    summary: 'Mutate local Sheet cells/fields/rows',
    description:
      'Concurrency: `p_expected_revision`. `p_retry_token` is a UUID used to retry the same mutation. `p_field_changes` max 32, `p_rows` max 200, `p_cells` max 1000.',
    required: [
      'p_instance_id',
      'p_expected_revision',
      'p_retry_token',
      'p_field_changes',
      'p_rows',
      'p_cells',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_retry_token: uuid('Caller-generated retry token.'),
      p_field_changes: {
        type: 'array',
        maxItems: 32,
        items: localFieldChange,
      },
      p_rows: { type: 'array', maxItems: 200, items: addressedRow },
      p_cells: {
        type: 'array',
        maxItems: 1000,
        items: obj(
          {
            rowKey: TEXT,
            fieldId: UUID,
            value: {
              $ref: '#/components/schemas/JsonValue',
              description: 'Canonical cell value.',
            },
          },
          ['rowKey', 'fieldId', 'value'],
        ),
      },
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  mutate_sheet_instance_calculations: {
    summary: 'Mutate Sheet calculations',
    description: 'Concurrency: `p_expected_revision`. `p_retry_token` UUID.',
    required: [
      'p_instance_id',
      'p_expected_revision',
      'p_retry_token',
      'p_changes',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_revision: bigint('Current revision.'),
      p_retry_token: uuid('Retry token.'),
      p_changes: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        description:
          'JSON array of add/edit `{ operation, calculation }` or retire `{ operation, calculationId }`.',
        items: ref('SheetCalculationChange'),
      },
    },
    result: pgrstRow(sheetInstanceRow, 'Updated instance.'),
  },
  insert_sheet_instance_block: {
    summary: 'Insert a Sheet Instance notebook block',
    description:
      'Concurrency: `p_expected_structure_version` on the notebook record.',
    required: [
      'p_record_id',
      'p_after_block_id',
      'p_expected_structure_version',
      'p_instance_id',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_after_block_id: { ...UUID, nullable: true },
      p_expected_structure_version: int('Current structure version.', {
        minimum: 1,
      }),
      p_instance_id: uuid('Sheet Instance to embed.'),
    },
    result: ref('InsertSheetInstanceBlockResult'),
  },
  duplicate_sheet_instance_block: {
    summary: 'Duplicate a Sheet Instance block',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: ['p_block_id', 'p_expected_structure_version'],
    properties: {
      p_block_id: uuid('Sheet block UUID.'),
      p_expected_structure_version: int('Current structure version.', {
        minimum: 1,
      }),
    },
    result: ref('InsertSheetInstanceBlockResult'),
  },
  apply_sheet_instance_composition_adoption: {
    summary: 'Apply composition adoption',
    description:
      'Concurrency: `p_expected_instance_revision`. `p_retry_token` UUID.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_parameter_inputs',
      'p_retry_token',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
      p_parameter_inputs: parameterInputs,
      p_retry_token: uuid('Retry token.'),
    },
    result: ref('CompositionAdoptionApplyResult'),
  },
  materialize_sheet_instance: {
    summary: 'Materialize a Sheet into a Dataset',
    description:
      'Idempotency field is `p_idempotency_key` (UUID). Same key + same digest returns `{ idempotent: true, materializationId, datasetId, datasetVersionId }`. Pass `p_preview_digest` from `preview_sheet_materialization`. Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_output_name',
      'p_output_schema_version_id',
      'p_preview_digest',
      'p_idempotency_key',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_output_name: text('Output Dataset name.', {
        minLength: 1,
        maxLength: 200,
      }),
      p_output_schema_version_id: uuid('Output Schema Version.'),
      p_preview_digest: text('Digest from preview_sheet_materialization.'),
      p_idempotency_key: uuid('Command UUID.'),
    },
    result: ref('MaterializationResult'),
  },
  apply_sheet_instance_definition_upgrade: {
    summary: 'Apply Sheet Definition upgrade',
    description: 'Concurrency: `p_expected_instance_revision`.',
    required: [
      'p_instance_id',
      'p_expected_instance_revision',
      'p_target_definition_version_id',
      'p_decisions',
      'p_parameter_inputs',
    ],
    properties: {
      p_instance_id: uuid('Sheet Instance UUID.'),
      p_expected_instance_revision: bigint('Current revision.'),
      p_target_definition_version_id: uuid('Target Definition Version.'),
      p_decisions: sheetDefinitionDecisions,
      p_parameter_inputs: parameterInputs,
    },
    result: ref('SheetDefinitionUpgradeApplyResult'),
  },
  validate_sheet_record_batch: {
    summary: 'Validate a Sheet→Record batch',
    description:
      'Does not write. `p_rows` are mapping preview rows for `p_model_key` in `p_project_id`. Result `rows[].classification` is `create`, `match` or `invalid`.',
    required: ['p_project_id', 'p_model_key', 'p_rows'],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key, e.g. sample.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: ref('SheetRecordBatchRow'),
      },
    },
    result: ref('SheetRecordBatchValidateResult'),
  },
  search: {
    summary: 'Workspace search',
    description:
      'All filters optional. `p_limit` clamped to 1–100 (default 20). `p_offset` default 0. Empty `p_query` browses. Returns a JSON array; `total_count` is repeated on each row.',
    required: [],
    properties: {
      p_query: text('Plain search text. No tsquery syntax.', { default: '' }),
      p_project_id: {
        ...UUID,
        nullable: true,
        description: 'Filter by project.',
      },
      p_kind: {
        ...TEXT,
        nullable: true,
        description:
          'experiment, sample, material, protocol_template, report, file, notebook_template.',
      },
      p_status: { ...TEXT, nullable: true },
      p_owner_id: {
        ...TEXT,
        nullable: true,
        description: 'created_by_user_id.',
      },
      p_date_from: {
        ...TIMESTAMPTZ,
        nullable: true,
        description: 'created_at >=.',
      },
      p_date_to: {
        ...TIMESTAMPTZ,
        nullable: true,
        description: 'created_at <=.',
      },
      p_limit: int('Page size, clamped 1–100.', {
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
      p_offset: int('Offset.', { minimum: 0, default: 0 }),
    },
    result: {
      type: 'array',
      items: obj(
        {
          result_type: TEXT,
          record_id: UUID,
          kind: TEXT,
          identifier: TEXT,
          title: TEXT,
          status: TEXT,
          project_id: UUID,
          archived: BOOL,
          created_by_user_id: TEXT,
          created_at: TIMESTAMPTZ,
          updated_at: TIMESTAMPTZ,
          matched_context: TEXT,
          matched_field: TEXT,
          rank: { type: 'number' },
          deep_link: TEXT,
          total_count: BIGINT,
        },
        [
          'result_type',
          'record_id',
          'kind',
          'identifier',
          'title',
          'total_count',
        ],
      ),
    },
  },
  semantic_search: {
    summary: 'Search by meaning with your own vector',
    description:
      'Ranks the stored passages closest to a vector you supply, through the caller’s own access, so work they cannot see never appears. The vector must be exactly 1024 numbers, unit length, made with the same model the workspace uses (see the AI settings); to search with words instead, use the MCP tool `sheetbase.search.semantic`. `p_limit` is clamped to 1–100. `p_types` limits the kinds of object (record, file, dataset, sheet, template, comment, project, analysis, deviation). Returns the closest passage per object, closest first.',
    required: ['p_embedding'],
    properties: {
      p_embedding: {
        type: 'array',
        items: { type: 'number' },
        minItems: 1024,
        maxItems: 1024,
        description: 'The query as exactly 1024 numbers.',
      },
      p_limit: int('How many objects, clamped 1–100.', {
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
      p_types: {
        ...TEXT_ARRAY,
        nullable: true,
        description: 'Kinds of object to include. Omit for the usual set.',
      },
    },
    result: {
      type: 'array',
      items: obj(
        {
          object_type: TEXT,
          object_id: UUID,
          title: TEXT,
          identifier: TEXT,
          kind: TEXT,
          status: TEXT,
          archived: BOOL,
          deep_link: TEXT,
          project_id: UUID,
          parent_type: TEXT,
          parent_id: UUID,
          passage: TEXT,
          chunk_no: { type: 'integer' },
          similarity: { type: 'number' },
        },
        ['object_type', 'object_id', 'similarity'],
      ),
    },
  },
  similar_work: {
    summary: 'Find work that reads like an experiment, dataset or file',
    description:
      'Returns the work closest in meaning to one object, using the vectors already stored (no model call). Only work the caller can see appears. `p_object_type` is record, file, dataset, sheet, template, analysis, project or deviation.',
    required: ['p_object_type', 'p_object_id'],
    properties: {
      p_object_type: text('Kind of object.'),
      p_object_id: uuid('The object’s UUID.'),
      p_limit: int('How many, clamped 1–50.', {
        minimum: 1,
        maximum: 50,
        default: 8,
      }),
      p_types: {
        ...TEXT_ARRAY,
        nullable: true,
        description: 'Kinds of object to include.',
      },
    },
    result: {
      type: 'array',
      items: obj(
        {
          object_type: TEXT,
          object_id: UUID,
          title: TEXT,
          identifier: TEXT,
          kind: TEXT,
          status: TEXT,
          archived: BOOL,
          deep_link: TEXT,
          project_id: UUID,
          parent_type: TEXT,
          parent_id: UUID,
          passage: TEXT,
          chunk_no: { type: 'integer' },
          similarity: { type: 'number' },
        },
        ['object_type', 'object_id', 'similarity'],
      ),
    },
  },
  semantic_search_settings: {
    summary: 'Whether search by meaning is on for a workspace',
    description:
      'Returns whether search by meaning and literature search are on, which embeddings model is chosen, and how many documents have been read so far.',
    required: ['p_workspace_id'],
    properties: { p_workspace_id: uuid('Workspace UUID.') },
    result: obj(
      {
        enabled: BOOL,
        profile: { ...TEXT, nullable: true },
        literatureEnabled: BOOL,
        indexedDocuments: BIGINT,
        totalDocuments: BIGINT,
      },
      ['enabled', 'literatureEnabled', 'indexedDocuments', 'totalDocuments'],
    ),
  },
  run_saved_search: {
    summary: 'Run a saved search',
    description:
      'Runs a saved search you can see and returns its results as `search` would. Shared searches are visible to everyone in the workspace; private ones only to their owner. `p_limit` is clamped to 1–100 (default 20).',
    required: ['p_id'],
    properties: {
      p_id: uuid('Saved search UUID.'),
      p_limit: int('Page size, clamped 1–100.', {
        minimum: 1,
        maximum: 100,
        default: 20,
      }),
      p_offset: int('Offset.', { minimum: 0, default: 0 }),
    },
    result: {
      type: 'array',
      items: obj(
        {
          result_type: TEXT,
          record_id: UUID,
          kind: TEXT,
          identifier: TEXT,
          title: TEXT,
          status: TEXT,
          project_id: UUID,
          archived: BOOL,
          created_by_user_id: TEXT,
          created_at: TIMESTAMPTZ,
          updated_at: TIMESTAMPTZ,
          matched_context: TEXT,
          matched_field: TEXT,
          rank: { type: 'number' },
          deep_link: TEXT,
          total_count: BIGINT,
        },
        [
          'result_type',
          'record_id',
          'kind',
          'identifier',
          'title',
          'total_count',
        ],
      ),
    },
  },
  save_search: {
    summary: 'Save a search',
    description:
      'Saves a search for the person the token belongs to (needs a personal token). `p_visibility` is `private` (default) or `workspace`; anyone except a viewer can share. Saving the same search again replaces it. A person keeps their newest 20 private searches; a workspace keeps up to 100 shared ones with unique names. `p_arguments` takes the inputs `search` takes (`p_query`, `p_filter`, `p_sort`, `p_kind`, `p_status`, `p_project_id`, `p_owner_id`, `p_date_from`, `p_date_to`, `p_result_type`, `p_include_archived`).',
    required: ['p_name', 'p_query'],
    properties: {
      p_name: text('Name, up to 120 characters.'),
      p_query: text('Search text, up to 500 characters.'),
      p_facets: jsonMap(
        'Filters the results page restores when it opens the search. Optional.',
      ),
      p_visibility: text('`private` (default) or `workspace`.', {
        default: 'private',
      }),
      p_arguments: jsonMap(
        'Inputs for `search`, used by `run_saved_search`. Optional.',
      ),
    },
    result: ref('SavedSearchesRow'),
  },
  update_saved_search: {
    summary: 'Rename or share a saved search',
    description:
      'Renames a saved search or moves it between private and shared. The person who saved it can, and so can a workspace owner, admin or steward for a shared one. Omit a field to leave it as it is.',
    required: ['p_id'],
    properties: {
      p_id: uuid('Saved search UUID.'),
      p_name: text('New name.'),
      p_visibility: text('`private` or `workspace`.'),
    },
    result: ref('SavedSearchesRow'),
  },
  delete_saved_search: {
    summary: 'Delete a saved search',
    description:
      'Deletes a saved search. The person who saved it can, and so can a workspace owner, admin or steward for a shared one. Deleting one that is not yours does nothing.',
    required: ['p_id'],
    properties: { p_id: uuid('Saved search UUID.') },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  search_sheet_records: {
    summary: 'Search Model records for Sheet write-back',
    description:
      '`p_limit` is clamped to 1–50 (default 25). `p_query` matches identifier, title and custom field text (ILIKE). No offset; raise limit or narrow `p_query`.',
    required: ['p_model_key'],
    properties: {
      p_model_key: text('Model key backed by `api.records`.'),
      p_query: text('Substring match. Empty browses.', { default: '' }),
      p_limit: int('Clamped 1–50.', { minimum: 1, maximum: 50, default: 25 }),
      p_include_archived: bool('Include archived records.'),
    },
    result: {
      type: 'array',
      items: obj(
        {
          id: UUID,
          kind: TEXT,
          identifier: TEXT,
          title: TEXT,
          status: TEXT,
          archived: BOOL,
        },
        ['id', 'kind', 'identifier', 'title'],
      ),
    },
  },
  update_record_custom_fields: {
    summary: 'Update record custom fields',
    description:
      'Concurrency: `p_expected_metadata_version`. `p_values` is field-name → value.',
    required: ['p_record_id', 'p_expected_metadata_version', 'p_values'],
    properties: {
      p_record_id: uuid('Record UUID.'),
      p_expected_metadata_version: int('Current metadata_version.', {
        minimum: 1,
      }),
      p_values: jsonMap('Model field name → canonical value.'),
    },
    result: pgrstRow(recordRow, 'Updated record.'),
  },
  create_and_link_sheet_record: {
    summary: 'Create a Model record and write it into a Sheet/Dataset cell',
    description:
      'Atomic create + identifier write-back. `p_write_target` identifies the Dataset cell.',
    required: [
      'p_project_id',
      'p_model_key',
      'p_title',
      'p_custom_fields',
      'p_write_target',
    ],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key.'),
      p_title: text('New record title.'),
      p_custom_fields: jsonMap('Model field name → canonical value.'),
      p_write_target: sheetRecordWriteTarget,
    },
    result: obj(
      {
        ok: { type: 'boolean', const: true },
        recordId: UUID,
        identifier: TEXT,
        title: TEXT,
        notebookRecordLink: BOOL,
      },
      ['ok', 'recordId', 'identifier', 'title'],
    ),
  },
  commit_sheet_record_batch: {
    summary: 'Commit a Sheet→Record batch',
    description:
      'Idempotency field is `p_idempotency_key` (1–128 characters). Same actor + same key + same digest returns the stored result; a different digest conflicts.',
    required: ['p_project_id', 'p_model_key', 'p_rows', 'p_idempotency_key'],
    properties: {
      p_project_id: uuid('Project UUID.'),
      p_model_key: text('Model key.'),
      p_rows: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: ref('SheetRecordBatchRow'),
      },
      p_idempotency_key: text('Command id, length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: ref('SheetRecordBatchCommitResult'),
  },
  preview_submission_digest: {
    summary: 'Preview a submission digest',
    description:
      'Safe read. Returns the SHA-256 source digest a human would confirm before submit. Does not submit, sign, amend or run revision checks. `reviews:write` is not used.',
    required: ['p_record_id'],
    properties: { p_record_id: uuid('Notebook record UUID.') },
    result: obj(
      {
        recordId: UUID,
        sourceDigest: text('64-character lowercase SHA-256 hex.'),
        structureVersion: INT,
        metadataVersion: INT,
        calculationInputRevision: BIGINT,
      },
      [
        'recordId',
        'sourceDigest',
        'structureVersion',
        'metadataVersion',
        'calculationInputRevision',
      ],
    ),
  },
  instantiate_notebook_template_version: {
    summary: 'Instantiate a Notebook Template Version',
    description:
      'Idempotency field is `p_idempotency_key` (1–128 characters). Template must be instantiable (`template_not_instantiable` otherwise). Missing required parameters fail closed naming the parameter keys; duplicate or unknown inputs are rejected before any write, so a failed call creates nothing. Each sheet placement creates an independent Sheet Instance (no composed part mutates another). The result carries per-placement composition pins — governed Definition versions alongside the working-state IDs — for upgrade detection to read.',
    required: [
      'p_version_id',
      'p_target_project_id',
      'p_title',
      'p_parameter_inputs',
      'p_idempotency_key',
    ],
    properties: {
      p_version_id: uuid('Template Version UUID.'),
      p_target_project_id: uuid('Destination project.'),
      p_title: text('New notebook title.'),
      p_parameter_inputs: parameterInputs,
      p_idempotency_key: text('Command id, length 1–128.', {
        minLength: 1,
        maxLength: 128,
      }),
    },
    result: ref('InstantiateNotebookTemplateResult'),
  },
  preview_notebook_template_upgrade: {
    summary: 'Preview notebook template upgrade',
    description: 'Read-only preview against `p_target_version_id`.',
    required: ['p_record_id', 'p_target_version_id'],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_target_version_id: uuid('Target Template Version.'),
    },
    result: ref('NotebookUpgradePreview'),
  },
  apply_notebook_template_upgrade: {
    summary: 'Apply notebook template upgrade',
    description: 'Concurrency: `p_expected_structure_version`.',
    required: [
      'p_record_id',
      'p_expected_structure_version',
      'p_target_version_id',
      'p_decisions',
      'p_parameter_inputs',
    ],
    properties: {
      p_record_id: uuid('Notebook record.'),
      p_expected_structure_version: int('Current structure_version.', {
        minimum: 1,
      }),
      p_target_version_id: uuid('Target Template Version.'),
      p_decisions: notebookDecisions,
      p_parameter_inputs: parameterInputs,
    },
    result: ref('NotebookUpgradeApplyResult'),
  },
  // -- AUTO-04/05: Agent operations and workflows ---------------------------
  propose_agent_operation: {
    summary: 'Propose one canonical agent-authored operation',
    description:
      'Creates a durable AUTO-04 proposal after server-side contract, target, permission, preview, impact, risk and policy evaluation. It does not bypass human approval or canonical execution rules.',
    required: [
      'p_workspace_id',
      'p_title',
      'p_summary',
      'p_operation',
      'p_provenance',
      'p_idempotency_key',
    ],
    properties: {
      p_workspace_id: uuid('Workspace UUID; must match the bearer token.'),
      p_title: text('Proposal title (1–200 characters).', {
        minLength: 1,
        maxLength: 200,
      }),
      p_summary: text('Proposal summary (1–2000 characters).', {
        minLength: 1,
        maxLength: 2000,
      }),
      p_operation: ref('AgentOperation'),
      p_provenance: ref('AgentProvenance'),
      p_idempotency_key: text(
        'Actor-scoped idempotency key (1–128 characters).',
        {
          minLength: 1,
          maxLength: 128,
        },
      ),
    },
    result: pgrstRow(
      ref('AgentOperationProposalsRow'),
      'Created or idempotently reused proposal.',
    ),
  },
  create_agent_workflow: {
    summary: 'Create a bounded sequential agent workflow',
    description:
      'Pins a two-to-twenty-step AUTO-05 plan and immediately proposes its first AUTO-04 operation. Tools are allowlisted, input versions are validated, and token/cost/operation budgets are durable. Reusing an idempotency key with different content fails.',
    required: [
      'p_workspace_id',
      'p_goal',
      'p_plan',
      'p_budget',
      'p_initial_usage',
      'p_provenance',
      'p_idempotency_key',
    ],
    properties: {
      p_workspace_id: uuid('Workspace UUID; must match the bearer token.'),
      p_goal: text('Workflow goal (1–2000 characters).', {
        minLength: 1,
        maxLength: 2000,
      }),
      p_plan: ref('AgentWorkflowPlan'),
      p_budget: ref('AgentWorkflowBudget'),
      p_initial_usage: ref('AgentWorkflowUsage'),
      p_provenance: ref('AgentProvenance'),
      p_idempotency_key: text(
        'Actor-scoped idempotency key (1–128 characters).',
        {
          minLength: 1,
          maxLength: 128,
        },
      ),
    },
    result: pgrstRow(
      ref('AgentWorkflowsRow'),
      'Created or idempotently reused workflow.',
    ),
  },
  advance_agent_workflow: {
    summary: 'Advance a workflow after its current proposal settles',
    description:
      'Observes the current AUTO-04 proposal at the expected workflow revision. A succeeded proposal advances to the next pinned step; rejection, failure or cancellation pauses the workflow. It never approves or executes a proposal.',
    required: ['p_workflow_id', 'p_expected_revision'],
    properties: {
      p_workflow_id: uuid('Workflow UUID.'),
      p_expected_revision: bigint('Current workflow revision.'),
    },
    result: pgrstRow(ref('AgentWorkflowsRow'), 'Updated workflow.'),
  },
  report_agent_workflow_usage: {
    summary: 'Report incremental workflow token and cost usage',
    description:
      'Adds usage at the expected revision. Both increments must be non-negative and at least one must be greater than zero. Exceeding a durable token or cost budget stops the workflow and cancels a still-pending current proposal.',
    required: [
      'p_workflow_id',
      'p_expected_revision',
      'p_tokens',
      'p_cost_microusd',
    ],
    properties: {
      p_workflow_id: uuid('Workflow UUID.'),
      p_expected_revision: bigint('Current workflow revision.'),
      p_tokens: {
        ...bigint(
          'Non-negative token increment; this or p_cost_microusd must be greater than zero.',
        ),
        minimum: 0,
      },
      p_cost_microusd: {
        ...bigint(
          'Non-negative cost increment in millionths of a US dollar; this or p_tokens must be greater than zero.',
        ),
        minimum: 0,
      },
    },
    result: pgrstRow(ref('AgentWorkflowsRow'), 'Usage-updated workflow.'),
  },
  cancel_agent_workflow: {
    summary: 'Cancel an active agent workflow',
    description:
      'Cancels remaining steps and a pending or approved current proposal at the expected revision. Completed and already-cancelled workflows fail closed.',
    required: ['p_workflow_id', 'p_expected_revision', 'p_reason'],
    properties: {
      p_workflow_id: uuid('Workflow UUID.'),
      p_expected_revision: bigint('Current workflow revision.'),
      p_reason: text('Cancellation reason (1–1000 characters).', {
        minLength: 1,
        maxLength: 1000,
      }),
    },
    result: pgrstRow(ref('AgentWorkflowsRow'), 'Cancelled workflow.'),
  },
  // -- API-06: Webhooks -------------------------------------------------------
  create_webhook_subscription: {
    summary: 'Create a webhook subscription',
    description:
      'Creates a subscription in the JWT workspace. Returns the subscription row and, for a webhook or Teams destination, a generated signing secret (returned exactly once). An email destination names a recipient instead of a URL and gets no secret. rate_limit_per_minute caps delivery attempts per rolling minute (deferred, never dropped); null = unlimited.',
    required: ['p_workspace_id', 'p_key'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_key: text('Subscription key (lowercase, hyphenated, max 49 chars).'),
      p_url: text(
        'HTTPS webhook endpoint URL. Required for webhook and Teams destinations; must be omitted for an email destination.',
      ),
      p_channel_type: text(
        "Destination type: 'webhook' (default), 'teams', or 'email'.",
      ),
      p_recipient_user_id: text(
        'User id of the recipient. Required for an email destination and must be omitted otherwise.',
      ),
      p_event_types: jsonArray(
        'JSON array of stable event type filters. Empty = all events.',
      ),
      p_description: text('Human-readable description.'),
      p_max_retries: int('Maximum delivery retries (0–25).', {
        minimum: 0,
        maximum: 25,
      }),
      p_failure_threshold: int(
        'Auto-disable after this many consecutive failures (0 = never).',
        { minimum: 0, maximum: 100 },
      ),
      p_signing_secret: text(
        'Optional signing secret (auto-generated if omitted).',
      ),
      p_rate_limit_per_minute: int(
        'Max delivery attempts per rolling minute (1–60000, null = unlimited).',
        { minimum: 1, maximum: 60000 },
      ),
    },
    result: ref('WebhookSubscriptionResult'),
  },
  update_webhook_subscription: {
    summary: 'Update a webhook subscription',
    description:
      'Updates URL, event types, description, status, retry config, or rate limit (null leaves the rate limit unchanged). Re-enabling a disabled/paused subscription resets consecutive_failures.',
    required: ['p_workspace_id', 'p_subscription_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid('Subscription UUID.'),
      p_url: text('New HTTPS webhook endpoint URL.'),
      p_event_types: jsonArray('JSON array of stable event type filters.'),
      p_description: text('Human-readable description.'),
      p_status: text(
        'Subscription status (active, paused, disabled, archived).',
      ),
      p_max_retries: int('Maximum delivery retries (0–25).', {
        minimum: 0,
        maximum: 25,
      }),
      p_failure_threshold: int(
        'Auto-disable after this many consecutive failures.',
        { minimum: 0, maximum: 100 },
      ),
      p_rate_limit_per_minute: int(
        'Max delivery attempts per rolling minute (1–60000). Null leaves unchanged.',
        { minimum: 1, maximum: 60000 },
      ),
    },
    result: pgrstRow(webhookSubscriptionRow, 'Updated subscription.'),
  },
  delete_webhook_subscription: {
    summary: 'Archive a webhook subscription',
    description: 'Soft-archives the subscription (status → archived).',
    required: ['p_workspace_id', 'p_subscription_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid('Subscription UUID.'),
    },
    result: pgrstRow(webhookSubscriptionRow, 'Archived subscription.'),
  },
  rotate_webhook_secret: {
    summary: 'Rotate the webhook signing secret',
    description:
      'Generates a new signing secret and stores it. The new secret is returned exactly once.',
    required: ['p_workspace_id', 'p_subscription_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid('Subscription UUID.'),
      p_new_secret: text('Optional new secret (auto-generated if omitted).'),
    },
    result: ref('WebhookSecretRotationResult'),
  },
  list_webhook_deliveries: {
    summary: 'List webhook delivery history',
    description:
      'Returns paginated delivery history for the workspace, optionally filtered by subscription, status (including dead_letter), event type, or time window.',
    required: ['p_workspace_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid('Optional subscription UUID filter.'),
      p_limit: int('Page size (1–200, default 50).', {
        minimum: 1,
        maximum: 200,
      }),
      p_offset: int('Page offset (default 0).', { minimum: 0 }),
      p_status: text(
        'Optional status filter (pending, delivered, failed, retrying, dead_letter).',
      ),
      p_event_type: text(
        'Optional stable event type filter (e.g. record.created).',
      ),
      p_since: {
        ...TIMESTAMPTZ,
        description: 'Optional lower bound on delivery creation time.',
      },
      p_until: {
        ...TIMESTAMPTZ,
        description: 'Optional upper bound on delivery creation time.',
      },
    },
    result: ref('WebhookDeliveryListResult'),
  },
  replay_webhook_delivery: {
    summary: 'Replay a webhook delivery',
    description:
      'Creates a new pending delivery from an existing terminal one (delivered, failed, dead_letter), reusing the original payload, body, and signature — the same idempotency key, so receivers that deduplicate never see a duplicate effect. Audited via replay lineage plus a change event.',
    required: ['p_workspace_id', 'p_delivery_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_delivery_id: uuid('Terminal delivery UUID to replay.'),
    },
    result: pgrstRow(webhookDeliveryRow, 'New pending delivery row.'),
  },
  replay_webhook_deliveries: {
    summary: 'Replay webhook deliveries by subscription and/or time window',
    description:
      'Operator-invoked bulk replay of terminal deliveries (default dead_letter) for a subscription and/or creation window. Each replay reuses the original idempotency key. Originals with a pending/retrying replay already queued are skipped, so re-running a window is safe. One summary change event audits the action; never automatic.',
    required: ['p_workspace_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid(
        'Optional subscription UUID filter (null = all subscriptions).',
      ),
      p_since: {
        ...TIMESTAMPTZ,
        description: 'Optional lower bound on original delivery creation time.',
      },
      p_until: {
        ...TIMESTAMPTZ,
        description: 'Optional upper bound on original delivery creation time.',
      },
      p_status: text(
        'Which terminal status to replay (dead_letter, failed, delivered; default dead_letter).',
      ),
      p_limit: int('Max deliveries to replay (1–500, default 50).', {
        minimum: 1,
        maximum: 500,
      }),
    },
    result: ref('WebhookBulkReplayResult'),
  },
  get_webhook_endpoint_health: {
    summary: 'Get webhook endpoint health',
    description:
      'Per-endpoint delivery health: 24h success-rate window, last error, consecutive failures, auto-disable state, retry debt, and rate limit. Re-enable a disabled endpoint via update_webhook_subscription (status active resets consecutive_failures).',
    required: ['p_workspace_id'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_subscription_id: uuid(
        'Optional subscription UUID (null = all subscriptions).',
      ),
    },
    result: ref('WebhookEndpointHealthResult'),
  },
  create_pipeline_definition_version: {
    summary: 'Create a draft pipeline version',
    description:
      'Creates the next version of a pipeline as a draft from a configuration. The configuration is validated exactly as the product validates it (`api.pipeline_config_errors`); a Python step must pin the runner’s runtime in `pythonRuntime` and may declare `pythonRequirements` and a per-step `contract`. Needs the caller’s own identity, so use a personal token: a service credential is refused. The draft is not runnable until a person publishes it.',
    required: ['p_workspace_id', 'p_definition_id', 'p_configuration'],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_definition_id: uuid('Pipeline definition UUID.'),
      p_configuration: jsonMap(
        'Pipeline configuration, format version 1 (parameters, inputs, transform, steps, output, pythonRuntime, pythonRequirements).',
      ),
    },
    result: pgrstRow(pipelineVersionRow, 'New draft version.'),
  },
  report_spend_lines: {
    summary: 'Spend on orders for a period',
    description:
      'One row per reagent order placed in the half-open period `[p_from, p_to)`: material, supplier, project, quantity, when it was ordered, and its price and currency. Runs with the caller’s rights, so a caller who may not see prices gets no price. Totals are per currency; there are no exchange rates. Needs a personal token.',
    required: ['p_workspace_id', 'p_from', 'p_to'],
    properties: {
      p_workspace_id: uuid('Workspace UUID; must match the token.'),
      p_from: { ...TIMESTAMPTZ, description: 'Start of the period, included.' },
      p_to: { ...TIMESTAMPTZ, description: 'End of the period, not included.' },
    },
    result: {
      type: 'array',
      items: jsonMap('One order placed in the period.'),
    },
  },
  report_usage_lines: {
    summary: 'Instrument bookings for a period',
    description:
      'One row per booking in the half-open period, with hours clipped to the period (cancelled bookings are left out) and the instrument’s rate and currency. Utilisation is booked hours over open hours: the weekdays in the period times the hours an instrument is open on a weekday. Needs a personal token.',
    required: ['p_workspace_id', 'p_from', 'p_to'],
    properties: {
      p_workspace_id: uuid('Workspace UUID; must match the token.'),
      p_from: { ...TIMESTAMPTZ, description: 'Start of the period, included.' },
      p_to: { ...TIMESTAMPTZ, description: 'End of the period, not included.' },
    },
    result: { type: 'array', items: jsonMap('One booking in the period.') },
  },
  report_project_status: {
    summary: 'Experiments by state for a period',
    description:
      'One row per project: experiments by state, what is late, what finished in the period, and orders still open. Needs a personal token.',
    required: ['p_workspace_id', 'p_from', 'p_to'],
    properties: {
      p_workspace_id: uuid('Workspace UUID; must match the token.'),
      p_project_id: {
        ...uuid('Limit to one project. Omit for all.'),
        nullable: true,
      },
      p_from: { ...TIMESTAMPTZ, description: 'Start of the period, included.' },
      p_to: { ...TIMESTAMPTZ, description: 'End of the period, not included.' },
    },
    result: { type: 'array', items: jsonMap('One project’s status.') },
  },
  set_model_supplier_list: {
    summary: 'Tick or untick a model as the supplier list',
    description:
      'Marks the records of a model as the companies the lab buys from, so an order can name one as its supplier. Needs permission to edit the schema and a personal token.',
    required: ['p_model_key', 'p_enabled'],
    properties: {
      p_model_key: text('Model key.'),
      p_enabled: bool('True to use the model as a supplier list.'),
    },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  create_supplier_model: {
    summary: 'Create the ready-made Supplier model',
    description:
      'Creates a record model for suppliers with the fields given and ticks it as a supplier list. Needs permission to edit the schema and a personal token.',
    required: ['p_key', 'p_name', 'p_prefix', 'p_description', 'p_fields'],
    properties: {
      p_key: text('Model key, lower case.'),
      p_name: text('Model name.'),
      p_prefix: text('Identifier prefix, such as SUP.'),
      p_description: text('What the model is for.'),
      p_fields: {
        type: 'array',
        items: jsonMap('A field: `field_name`, `label`, `show_in_list`.'),
      },
    },
    result: jsonMap('The created record model.'),
  },
  mark_reagent_ordered: {
    summary: 'Mark a reagent order as placed',
    description:
      'Moves a requested order to ordered, with the supplier, reference, expected date, price and currency. `p_supplier_record_id` must be a record of a model ticked as a supplier list; its title becomes the supplier. Needs permission to place orders and a personal token.',
    required: ['p_order_id'],
    properties: {
      p_order_id: uuid('Order UUID.'),
      p_order_reference: {
        ...text('Purchase order or reference.'),
        nullable: true,
      },
      p_expected_on: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'Expected arrival, YYYY-MM-DD.',
      },
      p_supplier: {
        ...text('Supplier name, when not from the list.'),
        nullable: true,
      },
      p_supplier_record_id: {
        ...uuid('A record from the supplier list.'),
        nullable: true,
      },
      p_total_price: {
        type: 'number',
        nullable: true,
        description: 'What the whole order cost.',
      },
      p_currency: {
        ...text('Three-letter currency code, needed with a price.'),
        nullable: true,
      },
    },
    result: jsonMap('The updated order.'),
  },
  set_reagent_order_price: {
    summary: 'Set or remove the price of an order',
    description:
      'Records what a reagent order cost. A null price removes it. Needs permission to place orders and a personal token.',
    required: ['p_order_id', 'p_total_price'],
    properties: {
      p_order_id: uuid('Order UUID.'),
      p_total_price: {
        type: 'number',
        nullable: true,
        description: 'Price, zero or more; null removes it.',
      },
      p_currency: { ...text('Three-letter currency code.'), nullable: true },
    },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  set_instrument_rate: {
    summary: 'Set or remove an instrument’s recharge rate',
    description:
      'What each booked hour is charged to the person or project that books it. A null rate stops charging. Needs permission to manage instruments and a personal token.',
    required: ['p_instrument_id', 'p_rate_per_hour'],
    properties: {
      p_instrument_id: uuid('Instrument UUID.'),
      p_rate_per_hour: {
        type: 'number',
        nullable: true,
        description: 'Rate, zero or more; null removes it.',
      },
      p_currency: { ...text('Three-letter currency code.'), nullable: true },
    },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  save_scheduled_report: {
    summary: 'Schedule a report, or change a schedule',
    description:
      'Emails a report on a rhythm with the detail attached as CSV. Pass an existing `p_id` to change a schedule. Recipients must be members of the workspace and are checked again at send time. Needs permission to edit the schema, or to manage instruments for the usage report, and a personal token.',
    required: [
      'p_name',
      'p_kind',
      'p_period',
      'p_frequency',
      'p_recipient_user_ids',
    ],
    properties: {
      p_id: {
        ...uuid('Existing schedule to change. Omit to create.'),
        nullable: true,
      },
      p_name: text('Name, up to 120 characters.'),
      p_kind: {
        type: 'string',
        enum: ['instrument_usage', 'spend', 'project_status'],
      },
      p_project_id: { ...uuid('Limit to one project.'), nullable: true },
      p_period: {
        type: 'string',
        enum: [
          'previous_week',
          'previous_month',
          'last_7_days',
          'last_30_days',
        ],
      },
      p_open_hours: {
        type: 'number',
        description: 'Open hours a weekday, for utilisation.',
        default: 10,
      },
      p_frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      p_weekday: int('0 is Sunday.', { minimum: 0, maximum: 6, default: 1 }),
      p_month_day: int('1 to 28.', { minimum: 1, maximum: 28, default: 1 }),
      p_send_hour: int('0 to 23, in `p_time_zone`.', {
        minimum: 0,
        maximum: 23,
        default: 8,
      }),
      p_time_zone: text('IANA time zone.', { default: 'UTC' }),
      p_recipient_user_ids: {
        ...TEXT_ARRAY,
        description: 'User ids of workspace members.',
      },
      p_active: bool('False to pause.'),
    },
    result: jsonMap('The saved schedule.'),
  },
  set_scheduled_report_active: {
    summary: 'Pause or resume a scheduled report',
    description:
      'Needs the same permission as scheduling it, and a personal token.',
    required: ['p_id', 'p_active'],
    properties: {
      p_id: uuid('Schedule UUID.'),
      p_active: bool('False to pause.'),
    },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  delete_scheduled_report: {
    summary: 'Delete a scheduled report',
    description: 'Nothing already sent is taken back. Needs a personal token.',
    required: ['p_id'],
    properties: { p_id: uuid('Schedule UUID.') },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  send_scheduled_report_now: {
    summary: 'Send a scheduled report now',
    description:
      'Queues the report; it is sent within a minute. Needs a personal token.',
    required: ['p_id'],
    properties: { p_id: uuid('Schedule UUID.') },
    result: { type: 'null', nullable: true, description: 'No content.' },
  },
  update_pipeline_definition_version_draft: {
    summary: 'Replace the configuration of a draft pipeline version',
    description:
      'Replaces the configuration of a draft version, guarded by its `revision` so two editors cannot overwrite each other (a stale revision is refused). Published and retired versions are immutable. Needs a personal token.',
    required: [
      'p_workspace_id',
      'p_version_id',
      'p_expected_revision',
      'p_configuration',
    ],
    properties: {
      p_workspace_id: uuid('Workspace UUID.'),
      p_version_id: uuid('Draft version UUID.'),
      p_expected_revision: bigint(
        'The `revision` last read from the draft; the update is refused if it moved.',
      ),
      p_configuration: jsonMap('Replacement configuration, format version 1.'),
    },
    result: pgrstRow(pipelineVersionRow, 'Updated draft version.'),
  },
}

Object.assign(RPC_CONTRACTS, labRpcContracts())

const missing = Object.keys(EXTERNAL_RPC_SCOPES).filter(
  (name) => !Object.hasOwn(RPC_CONTRACTS, name),
)
const extra = Object.keys(RPC_CONTRACTS).filter(
  (name) => !Object.hasOwn(EXTERNAL_RPC_SCOPES, name),
)
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `RPC_CONTRACTS must match EXTERNAL_RPC_SCOPES (missing ${missing.join(',')}; extra ${extra.join(',')})`,
  )
}

export const POSTGREST_FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'in',
  'is',
  'cs',
  'cd',
  'ov',
  'fts',
  'plfts',
  'phfts',
  'wfts',
  'not',
] as const

export const TOKEN_ERROR_CODES = [
  'invalid_request',
  'invalid_scope',
  'invalid_credential',
  'revoked',
  'expired',
  'insufficient_scope',
  'rate_limited',
  'server_error',
] as const
