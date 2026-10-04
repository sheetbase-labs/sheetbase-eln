/**
 * REV-008 review acceptance proof.
 *
 * Exercises the complete review lifecycle end-to-end through the ordinary
 * /api/db PostgREST proxy (the same surface the UI uses) against the live
 * Sheetbase database, plus direct database assertions for the SB-code-level
 * mutation-rejection contract that the proxy normalises away:
 *
 *   build Virus Stability experiment → submit R1 → make live draft changes →
 *   verify R1 evidence is frozen → submit R2 → diff text / table-cell /
 *   formula → anchored comment + resolve → run reviewer checks → approve →
 *   sign (approve-for-record) → lock → reconstruct timeline + evidence →
 *   verify prohibited mutations fail through REST and the database.
 *
 * Scientific content is created through canonical Dataset and Sheet RPCs.
 * Calculations use the existing safe worker and trusted result finalizer.
 * Only this suite's dedicated workspace is cleaned up; other data is retained.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { toCanonicalEnvelope } from '#/lib/review-workspace'
import { diffRevisionEnvelopes } from '#/lib/revision-diff'
import type { RevisionWire } from '#/lib/notebook-data'
import { sheetEvidenceFromRevisionRows } from '#/lib/sheet-evidence'
import { fetchComposedSheetRows } from '#/lib/sheet-composition-data'
import { calculateSheetSnapshot } from '#/lib/sheet-calculation.server'
import { sheetInstanceFromWire } from '#/lib/sheet-instance-data'
import { reviewWorkspaceDataClient } from '#/lib/review-workspace'

config({ path: ['.env.local', '.env'] })

const WS = '6d000000-0000-4000-8000-0000000008aa'
const PROJECT = '6d000000-0000-4000-8000-0000000008ab'
const OWNER = 'rev-008-owner'
const REVIEWER = 'rev-008-reviewer'
const REVIEWER_NAME = 'Review Eight'
const OWNER_SESSION = 'rev-008-owner-session'
const REVIEWER_SESSION = 'rev-008-reviewer-session'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''
const UPSTREAM = process.env.POSTGREST_URL ?? 'http://localhost:3001'

let admin: Client

// Shared fixture state, populated by beforeAll through ordinary RPCs.
let sample: { id: string }
let protocol: { id: string; structure_version: number }
let experiment: { id: string; structure_version: number; identifier: string }
let richBlock: { id: string; version: number }
let dataset: { id: string; revision: number }
let sheetInstance: ReturnType<typeof sheetInstanceFromWire>
let sheetBlockId: string
let cols: { time: string; titer: string; condition: string }
let r1: {
  revisionId: string
  submissionId: string
  digest: string
  snapshot: unknown
}
let r2: { revisionId: string; submissionId: string; digest: string }
let commentId: string
let signatureId: string

// ---------------------------------------------------------------------------
// Fixture cleanup — removes only this suite's workspace, in dependency order.
// ---------------------------------------------------------------------------
async function clean(): Promise<void> {
  await admin.query('BEGIN')
  try {
    await admin.query(
      'ALTER TABLE api.revision_sheet_evidence DISABLE TRIGGER USER',
    )
    await admin.query(
      'DELETE FROM api.revision_sheet_evidence WHERE workspace_id=$1',
      [WS],
    )
    await admin.query(
      'ALTER TABLE api.revision_sheet_evidence ENABLE TRIGGER USER',
    )
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
  await admin.query(`DELETE FROM api.signatures WHERE workspace_id = $1`, [WS])
  await admin.query(
    `DELETE FROM api.review_decisions WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.review_submissions WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.review_check_results WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.comments WHERE workspace_id = $1`, [WS])
  await admin.query(
    `DELETE FROM internal.revision_file_objects WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.record_links
       WHERE source_record_id IN (SELECT id FROM api.records WHERE workspace_id = $1)
          OR target_record_id IN (SELECT id FROM api.records WHERE workspace_id = $1)`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id = $1)`,
    [WS],
  )
  // Clear any review lock on the records before deleting the revisions they
  // reference (records.locked_by_revision_id is ON DELETE RESTRICT). The
  // migrator role is exempt from the lock trigger.
  await admin.query(
    `UPDATE api.records SET locked_at = NULL, locked_by_revision_id = NULL
     WHERE workspace_id = $1 AND locked_at IS NOT NULL`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id = $1)`,
    [WS],
  )
  await admin.query(`DELETE FROM api.file_objects WHERE workspace_id = $1`, [
    WS,
  ])
  await admin.query('BEGIN')
  try {
    const guarded = [
      'sheet_instances',
      'sheet_instance_calculation_mutations',
      'sheet_instance_local_mutations',
      'sheet_definition_versions',
      'sheet_definitions',
      'dataset_version_flags',
      'dataset_version_values',
      'dataset_version_rows',
      'dataset_versions',
      'dataset_schema_version_fields',
      'dataset_schema_versions',
    ]
    for (const table of guarded)
      await admin.query(`ALTER TABLE api.${table} DISABLE TRIGGER USER`)
    await admin.query(
      'DELETE FROM internal.sheet_instance_calculation_results WHERE workspace_id=$1',
      [WS],
    )
    for (const table of [
      'sheet_instance_calculation_mutations',
      'sheet_instance_local_mutations',
      'sheet_instances',
    ])
      await admin.query(`DELETE FROM api.${table} WHERE workspace_id=$1`, [WS])
    await admin.query(
      'DELETE FROM api.sheet_definition_versions WHERE definition_id IN (SELECT id FROM api.sheet_definitions WHERE workspace_id=$1)',
      [WS],
    )
    await admin.query(
      'DELETE FROM api.sheet_definitions WHERE workspace_id=$1',
      [WS],
    )
    for (const table of [
      'dataset_version_flags',
      'dataset_version_values',
      'dataset_version_rows',
    ])
      await admin.query(
        `DELETE FROM api.${table} WHERE dataset_version_id IN (SELECT id FROM api.dataset_versions WHERE workspace_id=$1)`,
        [WS],
      )
    await admin.query(
      'DELETE FROM api.dataset_versions WHERE workspace_id=$1',
      [WS],
    )
    await admin.query('DELETE FROM api.datasets WHERE workspace_id=$1', [WS])
    await admin.query(
      'DELETE FROM api.dataset_schema_definitions WHERE workspace_id=$1',
      [WS],
    )
    for (const table of guarded)
      await admin.query(`ALTER TABLE api.${table} ENABLE TRIGGER USER`)
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
  await admin.query(`DELETE FROM api.records WHERE workspace_id = $1`, [WS])
  // Fixture-only teardown; never leave the immutable-definition guard off.
  await admin.query('BEGIN')
  try {
    await admin.query(
      'ALTER TABLE api.record_field_definitions DISABLE TRIGGER model_definition_guard',
    )
    await admin.query(
      'DELETE FROM api.record_field_definitions WHERE workspace_id=$1',
      [WS],
    )
    await admin.query(
      'ALTER TABLE api.record_field_definitions ENABLE TRIGGER model_definition_guard',
    )
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
  await admin.query(`DELETE FROM api.projects WHERE workspace_id = $1`, [WS])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id = $1`, [WS])
  await admin.query(
    `DELETE FROM internal."session" WHERE "userId" IN ($1, $2)`,
    [OWNER, REVIEWER],
  )
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1, $2)`, [
    OWNER,
    REVIEWER,
  ])
  await admin.query(`SELECT pg_notify('pgrst', 'reload schema')`)
}

// ---------------------------------------------------------------------------
// Proxy helpers — the same handleProxyRequest + JWT minting the app uses.
// ---------------------------------------------------------------------------
function proxy(
  path: string,
  userId: string,
  sessionId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: sessionId },
      }),
      getWorkspaceForUser: async () => ({ id: WS }),
      mintToken: (input: any) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: UPSTREAM,
    },
  )
}

async function rpc(name: string, user: string, session: string, body: unknown) {
  return proxy(`rpc/${name}`, user, session, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function asOwner(name: string, body: unknown) {
  return rpc(name, OWNER, OWNER_SESSION, body)
}
async function asReviewer(name: string, body: unknown) {
  return rpc(name, REVIEWER, REVIEWER_SESSION, body)
}

async function createRecord(
  user: string,
  session: string,
  kind: string,
  title: string,
  status = 'draft',
  properties: Record<string, unknown> = {},
  customFields: Record<string, unknown> = {},
) {
  const res = await rpc('create_model_record', user, session, {
    p_project_id: PROJECT,
    p_kind: kind,
    p_title: title,
    p_status: status,
    p_tags: [],
    p_properties: properties,
    p_custom_fields: customFields,
  })
  expect(res.status, await res.clone().text()).toBe(200)
  const record = await res.json()
  expect(record.custom_fields).toEqual(customFields)
  expect(record.properties).toEqual(properties)
  return record
}

async function insertBlock(
  user: string,
  session: string,
  record: { id: string; structure_version: number },
  type: string,
  payload: unknown,
) {
  const res = await rpc('insert_block', user, session, {
    p_record_id: record.id,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: record.structure_version,
  })
  expect(res.status).toBe(200)
  return res.json()
}

async function getRows(time?: number) {
  const res = await proxy(
    `dataset_rows?dataset_id=eq.${dataset.id}`,
    OWNER,
    OWNER_SESSION,
  )
  expect(res.status).toBe(200)
  const rows: Array<{ id: string; revision: number }> = await res.json()
  const valuesRes = await proxy(
    `dataset_row_values?row_id=in.(${rows.map((row) => row.id).join(',')})`,
    OWNER,
    OWNER_SESSION,
  )
  expect(valuesRes.status).toBe(200)
  const values: Array<{
    row_id: string
    field_id: string
    numeric_value: number | string | null
    text_value: string | null
  }> = await valuesRes.json()
  return rows
    .map((row) => ({
      ...row,
      ...Object.fromEntries(
        values
          .filter((value) => value.row_id === row.id)
          .map((value) => [
            value.field_id,
            value.numeric_value !== null
              ? Number(value.numeric_value)
              : value.text_value,
          ]),
      ),
    }))
    .filter((row) => time === undefined || row[cols.time] === time)
}

async function commitRows(rows: Array<Record<string, unknown>>) {
  const read = await proxy(`datasets?id=eq.${dataset.id}`, OWNER, OWNER_SESSION)
  expect(read.status).toBe(200)
  const [current] = await read.json()
  return asOwner('commit_dataset_row_batch', {
    p_dataset_id: dataset.id,
    p_expected_dataset_revision: Number(current.revision),
    p_idempotency_key: crypto.randomUUID(),
    p_rows: rows,
  })
}

async function canonicalRevision(row: RevisionWire) {
  const res = await proxy(
    `revision_sheet_evidence?revision_id=eq.${row.id}`,
    OWNER,
    OWNER_SESSION,
  )
  expect(res.status).toBe(200)
  return toCanonicalEnvelope({
    ...row,
    frozenSheetEvidence: [
      ...sheetEvidenceFromRevisionRows(await res.json()).values(),
    ],
  })
}

function richTextDoc(text: string) {
  return {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  }
}

// ---------------------------------------------------------------------------
// Fixture + lifecycle bootstrap.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await clean()

  // Identities + workspace + project (no authenticated creation RPC exists).
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,$2,'rev-008-owner@test.invalid',true),
      ($3,$4,'rev-008-reviewer@test.invalid',true)`,
    [OWNER, 'Owner Eight', REVIEWER, REVIEWER_NAME],
  )
  await admin.query(
    `INSERT INTO internal."session"(id,"expiresAt",token,"userId") VALUES
      ($1, now() + interval '30 days', $1, $2),
      ($3, now() + interval '30 days', $3, $4)`,
    [OWNER_SESSION, OWNER, REVIEWER_SESSION, REVIEWER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'rev-008','REV 008')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, REVIEWER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'rev008','Virus Stability Acceptance')`,
    [PROJECT, WS],
  )

  // Custom scientific metadata belongs to active workspace model fields,
  // not the protected legacy properties document.
  for (const [model, key, type] of [
    ['sample', 'construct', 'text'],
    ['sample', 'batch', 'text'],
    ['experiment', 'conditions', 'text'],
    ['experiment', 'window_days', 'integer'],
  ]) {
    const definition = await asOwner('create_and_activate_model_field', {
      p_workspace_id: WS,
      p_model_key: model,
      p_field_name: key,
      p_label: key,
      p_logical_type: type,
      p_nullable: true,
      p_default_value: null,
      p_validation: {},
    })
    expect(definition.status, await definition.clone().text()).toBe(200)
  }

  // --- Build the Virus Stability notebook through ordinary RPCs. ---
  sample = await createRecord(
    OWNER,
    OWNER_SESSION,
    'sample',
    'LVV-CAR-T drug substance',
    'available',
    { storageLocation: '4 °C' },
    {
      construct: 'LVV-CAR-T',
      batch: 'LVV-250601',
    },
  )
  protocol = await createRecord(
    OWNER,
    OWNER_SESSION,
    'protocol_template',
    'Titration Assay',
    'active',
    {
      version: '1.2',
    },
  )
  let pres = await insertBlock(
    OWNER,
    OWNER_SESSION,
    protocol,
    'procedure_step',
    {
      text: 'Prepare a serial dilution and measure qPCR log titer.',
      stepNumber: 1,
    },
  )
  protocol.structure_version = pres.structure_version

  experiment = await createRecord(
    OWNER,
    OWNER_SESSION,
    'experiment',
    'Virus Stability at 4 °C',
    'draft',
    {},
    { conditions: '4 °C', window_days: 28 },
  )

  // Rich-text conclusion block.
  const textJson = await insertBlock(
    OWNER,
    OWNER_SESSION,
    experiment,
    'rich_text',
    {
      doc: richTextDoc(
        'Evaluate LVV-CAR-T vector stability at 4 °C across a 28-day window.',
      ).doc,
    },
  )
  richBlock = textJson.block
  experiment.structure_version = textJson.structure_version

  // Link the protocol + sample into the experiment.
  const linkRes = await asOwner('create_record_link', {
    p_source_record_id: experiment.id,
    p_target_kind: 'protocol_template',
    p_target_identifier: protocol.identifier ?? protocol.id,
    p_link_type: 'protocol',
    p_target_record_id: protocol.id,
  })
  expect(linkRes.status).toBe(200)
  const link2 = await asOwner('create_record_link', {
    p_source_record_id: experiment.id,
    p_target_kind: 'sample',
    p_target_identifier: sample.identifier ?? sample.id,
    p_link_type: 'sample',
    p_target_record_id: sample.id,
  })
  expect(link2.status).toBe(200)

  // Canonical Dataset-backed Sheet. Scientific values and source quantities
  // are governed fields; no retired generated-table writes are used.
  cols = {
    time: crypto.randomUUID(),
    titer: crypto.randomUUID(),
    condition: crypto.randomUUID(),
  }
  const fields = [
    {
      fieldId: cols.time,
      key: 'time',
      label: 'Time (days)',
      logicalType: 'decimal',
      quantity: { kind: 'duration', dimension: 'time', storageUnit: 'd' },
    },
    {
      fieldId: cols.titer,
      key: 'titer',
      label: 'Log titer',
      logicalType: 'decimal',
      quantity: {
        kind: 'log_titer',
        dimension: 'dimensionless',
        storageUnit: 'log10',
      },
    },
    {
      fieldId: cols.condition,
      key: 'condition',
      label: 'Condition',
      logicalType: 'text',
      quantity: null,
    },
  ].map((field) => ({
    ...field,
    description: null,
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }))
  const schemaRes = await asOwner('create_dataset_schema_definition', {
    p_workspace_id: WS,
    p_key: 'rev_stability',
    p_name: 'Stability readings (qPCR)',
    p_description: null,
    p_fields: fields.map(({ fieldId, key, label, logicalType, quantity }) => ({
      fieldId,
      key,
      label,
      logicalType,
      ...(quantity ? { quantity } : {}),
    })),
  })
  expect(schemaRes.status, await schemaRes.clone().text()).toBe(200)
  const schema = await schemaRes.json()
  const published = await asOwner('publish_dataset_schema_version', {
    p_schema_version_id: schema.schema_version_id,
  })
  expect(published.status, await published.clone().text()).toBe(200)
  const datasetRes = await proxy('datasets', OWNER, OWNER_SESSION, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      workspace_id: WS,
      schema_version_id: schema.schema_version_id,
      name: 'Stability readings (qPCR)',
    }),
  })
  expect(datasetRes.status, await datasetRes.clone().text()).toBe(201)
  ;[dataset] = await datasetRes.json()

  // Four 4 °C timepoint rows.
  const r1Rows = [
    [0, 7.2, '4 °C'],
    [7, 7.0, '4 °C'],
    [14, 6.6, '4 °C'],
    [28, 5.9, '4 °C'],
  ] as const
  const rowsRes = await commitRows(
    r1Rows.map(([time, titer, condition]) => ({
      operation: 'create',
      rowId: crypto.randomUUID(),
      values: {
        [cols.time]: time,
        [cols.titer]: titer,
        [cols.condition]: condition,
      },
    })),
  )
  expect(rowsRes.status, await rowsRes.clone().text()).toBe(200)
  const parameterId = crypto.randomUUID()
  const bindingId = crypto.randomUUID()
  const definitionRes = await asOwner('create_sheet_definition', {
    p_workspace_id: WS,
    p_key: 'rev_stability_sheet',
    p_name: 'Stability readings',
    p_description: null,
    p_configuration: {
      formatVersion: 1,
      parameters: [
        {
          id: parameterId,
          key: 'readings',
          label: 'Readings',
          required: true,
          type: {
            kind: 'dataset',
            contract: {
              mode: 'exact',
              schemaVersionId: schema.schema_version_id,
            },
          },
          constraints: {},
        },
      ],
      bindings: [{ id: bindingId, key: 'readings', parameterId }],
      rowIdentity: { kind: 'source', columnIds: [cols.time] },
      joins: [],
      columns: fields.map((field) => ({
        id: field.fieldId,
        field,
        source: { kind: 'bound', bindingId, sourceFieldId: field.fieldId },
      })),
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: Object.values(cols),
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
    },
  })
  expect(definitionRes.status, await definitionRes.clone().text()).toBe(200)
  const definition = await definitionRes.json()
  const publishedDefinition = await asOwner(
    'publish_sheet_definition_version',
    {
      p_version_id: definition.version.id,
      p_expected_revision: definition.version.revision,
    },
  )
  expect(
    publishedDefinition.status,
    await publishedDefinition.clone().text(),
  ).toBe(200)
  const instanceRes = await asOwner('create_sheet_instance_from_definition', {
    p_workspace_id: WS,
    p_name: 'Stability readings',
    p_description: null,
    p_source_definition_version_id: definition.version.id,
    p_project_id: PROJECT,
    p_notebook_record_id: experiment.id,
    p_state: {
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
      provenance: { createdFrom: 'definition_version' },
    },
    p_parameter_inputs: [
      { parameterId, kind: 'dataset', datasetId: dataset.id },
    ],
  })
  expect(instanceRes.status, await instanceRes.clone().text()).toBe(200)
  sheetInstance = sheetInstanceFromWire(await instanceRes.json())
  const resolved = await asOwner('resolve_sheet_instance_row_identity', {
    p_instance_id: sheetInstance.id,
    p_expected_revision: sheetInstance.revision,
  })
  expect(resolved.status, await resolved.clone().text()).toBe(200)
  sheetInstance = sheetInstanceFromWire(await resolved.json())
  const embedded = await asOwner('insert_sheet_instance_block', {
    p_record_id: experiment.id,
    p_instance_id: sheetInstance.id,
    p_expected_structure_version: experiment.structure_version,
    p_after_block_id: null,
  })
  expect(embedded.status, await embedded.clone().text()).toBe(200)
  const sheetJson = await embedded.json()
  experiment.structure_version = sheetJson.structure_version
  sheetBlockId = sheetJson.block.id

  // --- Submit R1 (the fixed revision). ---
  const preview1 = await asOwner('preview_submission_digest', {
    p_record_id: experiment.id,
  })
  expect(preview1.status).toBe(200)
  const digest1 = (await preview1.json()).sourceDigest

  const submit1 = await asOwner('submit_record_revision', {
    p_record_id: experiment.id,
    p_expected_source_digest: digest1,
    p_workflow_definition_key: 'default-scientific-review',
    p_workflow_definition_version: 1,
    p_reviewer_user_ids: [REVIEWER],
    p_confirmed: true,
    p_idempotency_key: 'rev-008-r1',
  })
  expect(submit1.status).toBe(200)
  const submit1Body = await submit1.json()
  r1 = {
    revisionId: submit1Body.revision.id,
    submissionId: submit1Body.submission.id,
    digest: submit1Body.revision.integrityDigest,
    snapshot: undefined as unknown,
  }
  expect(r1.digest).toBe(digest1)
  expect(submit1Body.idempotent).toBe(false)
  expect(submit1Body.submission.state).toBe('submitted')

  // Capture R1's frozen canonical snapshot via the proxy.
  const r1RevRes = await proxy(
    `revisions?id=eq.${r1.revisionId}&limit=1`,
    OWNER,
    OWNER_SESSION,
  )
  expect(r1RevRes.status).toBe(200)
  const r1RevRows = await r1RevRes.json()
  r1.snapshot = r1RevRows[0].canonical_snapshot

  // --- Make live draft changes (must not mutate R1). ---
  // 1. Update the rich-text conclusion.
  const updateRes = await asOwner('update_block_payload', {
    p_block_id: richBlock.id,
    p_payload: richTextDoc(
      'Evaluate LVV-CAR-T vector stability at 4 °C across a 35-day window with amended endpoints.',
    ),
    p_expected_version: richBlock.version,
    p_payload_schema_version: 1,
  })
  expect(updateRes.status).toBe(200)

  // Amend one scientific value and append a timepoint through typed HTTP RPCs.
  const [day28] = await getRows(28)
  const patchRes = await commitRows([
    {
      operation: 'update',
      rowId: day28.id,
      expectedRevision: day28.revision,
      values: { [cols.titer]: 5.7 },
    },
  ])
  expect(patchRes.status, await patchRes.clone().text()).toBe(200)
  const addRowRes = await commitRows([
    {
      operation: 'create',
      rowId: crypto.randomUUID(),
      values: { [cols.time]: 42, [cols.titer]: 5.4, [cols.condition]: '4 °C' },
    },
  ])
  expect(addRowRes.status, await addRowRes.clone().text()).toBe(200)

  // Persist a canonical Instance calculation, then execute the existing trusted
  // worker implementation rather than inventing a fixture-only result cache.
  const formulaId = '6d000000-0000-4000-8000-0000000008f1'
  const calculationRes = await asOwner('mutate_sheet_instance_calculations', {
    p_instance_id: sheetInstance.id,
    p_expected_revision: sheetInstance.revision,
    p_retry_token: crypto.randomUUID(),
    p_changes: [
      {
        operation: 'add',
        calculation: {
          id: formulaId,
          key: 'normalised_titer',
          label: 'Normalised log titer',
          lifecycle: 'active',
          outputField: {
            ...fields[1],
            fieldId: formulaId,
            key: 'normalised_titer',
            label: 'Normalised log titer',
            computation: { mode: 'computed', expressionId: formulaId },
          },
          dependencies: [{ kind: 'column', id: cols.titer }],
          expression: {
            language: 'sheetbase-formula-v1',
            // ROUND is not supported by the safe worker. These one-decimal
            // inputs have the same values under scalar identity arithmetic.
            source: '=A1 * 1.000',
          },
        },
      },
    ],
  })
  expect(calculationRes.status, await calculationRes.clone().text()).toBe(200)
  sheetInstance = sheetInstanceFromWire(await calculationRes.json())
  const composition = await fetchComposedSheetRows(
    sheetInstance.id,
    { limit: 200, offset: 0 },
    {
      ...reviewWorkspaceDataClient,
      rpc: async (name, args) => {
        const response = await asOwner(name, args)
        expect(response.status, await response.clone().text()).toBe(200)
        return response.json()
      },
    },
  )
  const results = calculateSheetSnapshot({
    instanceId: sheetInstance.id,
    workspaceId: WS,
    definitionVersionId: sheetInstance.sourceDefinitionVersionId,
    revision: sheetInstance.revision,
    state: sheetInstance.state,
    composition,
  })
  expect(results).toHaveLength(5)
  expect(
    results.every((result) => result.resultKind === 'value'),
    JSON.stringify(
      results.map(({ errorCode, diagnostic }) => ({ errorCode, diagnostic })),
    ),
  ).toBe(true)
  expect(results.map((result) => result.value)).toEqual(
    expect.arrayContaining([7.2, 7, 6.6, 5.7, 5.4]),
  )
  await admin.query('BEGIN')
  try {
    await admin.query('SET LOCAL ROLE formula_writer')
    await admin.query(
      `select internal.apply_trusted_sheet_calculation($1,$2,$3,$4,$5::jsonb)`,
      [
        OWNER,
        sheetInstance.id,
        sheetInstance.revision,
        crypto.randomUUID(),
        JSON.stringify(results),
      ],
    )
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }

  // --- Submit R2 (the amended revision). ---
  const preview2 = await asOwner('preview_submission_digest', {
    p_record_id: experiment.id,
  })
  expect(preview2.status).toBe(200)
  const digest2 = (await preview2.json()).sourceDigest
  expect(digest2).not.toBe(digest1)

  const submit2 = await asOwner('submit_record_revision', {
    p_record_id: experiment.id,
    p_expected_source_digest: digest2,
    p_workflow_definition_key: 'default-scientific-review',
    p_workflow_definition_version: 1,
    p_reviewer_user_ids: [REVIEWER],
    p_confirmed: true,
    p_idempotency_key: 'rev-008-r2',
  })
  expect(submit2.status).toBe(200)
  const submit2Body = await submit2.json()
  r2 = {
    revisionId: submit2Body.revision.id,
    submissionId: submit2Body.submission.id,
    digest: submit2Body.revision.integrityDigest,
  }
  expect(r2.digest).toBe(digest2)
  expect(submit2Body.submission.state).toBe('submitted')
}, 120_000)

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
})

// ---------------------------------------------------------------------------
// Acceptance proofs.
// ---------------------------------------------------------------------------
describe('REV-008 review acceptance', () => {
  it('freezes the submitted R1 evidence against later live draft changes', async () => {
    // Re-fetch R1 after all draft mutations + R2 submission.
    const res = await proxy(
      `revisions?id=eq.${r1.revisionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    expect(res.status).toBe(200)
    const rows = await res.json()
    const refetched = rows[0]
    expect(refetched.integrity_digest).toBe(r1.digest)
    expect(refetched.canonical_snapshot).toEqual(r1.snapshot)

    const envelope = await canonicalRevision(refetched)
    // R1 has no calculation (the calculation was added after submission).
    expect(envelope.sheetEvidence?.[0].composedGrid?.calculations).toEqual([])
    // R1 carries the original rich-text + four-row table.
    expect(envelope.blocks.length).toBeGreaterThanOrEqual(1)
    expect(envelope.sheetEvidence?.[0].composedGrid?.rows).toHaveLength(4)
  })

  it('reports text, scientific-table cell and formula differences between R1 and R2', async () => {
    const r1Res = await proxy(
      `revisions?id=eq.${r1.revisionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const r2Res = await proxy(
      `revisions?id=eq.${r2.revisionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const r1Row = (await r1Res.json())[0]
    const r2Row = (await r2Res.json())[0]

    const diff = diffRevisionEnvelopes(
      await canonicalRevision(r1Row),
      await canonicalRevision(r2Row),
    )

    // Metadata title modified.
    const textChange = diff.changes.find(
      (c) => c.area === 'text' && c.kind === 'modified',
    )
    expect(textChange).toBeDefined()

    // Scientific-table cell modified (the day-28 log titer). This exercises
    // the field_name column-key resolution in revision-diff.
    const tableSummary = diff.tableSummaries.find(
      (s) => s.tableId === sheetBlockId,
    )
    expect(tableSummary).toBeDefined()
    expect(tableSummary!.addedRows).toBe(1)
    expect(tableSummary!.modifiedCells).toBeGreaterThanOrEqual(1)
    const cellChange = tableSummary!.changes.find(
      (c) => c.kind === 'modified' && c.rowId && c.columnId === cols.titer,
    )
    expect(cellChange).toBeDefined()
    expect(cellChange!.before).toBe(5.9)
    expect(cellChange!.after).toBe(5.7)

    // Formula added (present in R2, absent from R1).
    const formulaChange = diff.changes.find(
      (c) => c.area === 'formulas' && c.kind === 'added',
    )
    expect(formulaChange).toBeDefined()
  })

  it('creates and resolves an anchored review comment against frozen R2 evidence', async () => {
    // Anchor a comment to the rich-text block present in the R2 snapshot.
    const createRes = await asReviewer('create_comment', {
      p_revision_id: r2.revisionId,
      p_target_kind: 'block',
      p_target: { blockId: richBlock.id },
      p_body: 'Please confirm the 35-day endpoint is within stability specs.',
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    commentId = created.commentId ?? created.id
    expect(commentId).toBeDefined()

    // The comment is anchored to the immutable revision.
    const listRes = await proxy(
      `comments?revision_id=eq.${r2.revisionId}&limit=5`,
      OWNER,
      OWNER_SESSION,
    )
    expect(listRes.status).toBe(200)
    const comments = await listRes.json()
    expect(comments).toHaveLength(1)
    expect(comments[0].target_kind).toBe('block')
    expect(comments[0].state).toBe('open')

    // Resolve the thread as the reviewer.
    const resolveRes = await asReviewer('resolve_comment_thread', {
      p_comment_id: commentId,
    })
    expect(resolveRes.status).toBe(200)

    const resolvedList = await proxy(
      `comments?revision_id=eq.${r2.revisionId}&limit=5`,
      OWNER,
      OWNER_SESSION,
    )
    const resolved = (await resolvedList.json())[0]
    expect(resolved.state).toBe('resolved')
  })

  it('runs reviewer checks against the submitted R2 evidence with no blocking failures', async () => {
    const runRes = await asReviewer('run_revision_checks', {
      p_revision_id: r2.revisionId,
      p_check_definition_key: 'default-scientific-checks',
      p_check_definition_version: 1,
      p_confirmed: true,
      p_idempotency_key: 'rev-008-checks-r2',
    })
    expect(runRes.status).toBe(200)
    const result = await runRes.json()
    expect(result.overallStatus).toBe('pass')
    expect(result.blockingFailureCount).toBe(0)
    // The supported formula with a current result passes both formula checks.
    const formulaSupported = result.results.find(
      (r: any) => r.key === 'formula-supported',
    )
    expect(formulaSupported.status).toBe('pass')
    const formulaStale = result.results.find(
      (r: any) => r.key === 'formula-no-stale-results',
    )
    expect(formulaStale.status).toBe('pass')

    // The check result is pinned to the frozen R2 digest.
    const checkRes = await proxy(
      `review_check_results?revision_id=eq.${r2.revisionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const checkRow = (await checkRes.json())[0]
    expect(checkRow.revision_integrity_digest).toBe(r2.digest)
  })

  it('approves R2 as the assigned reviewer', async () => {
    const res = await asReviewer('approve_review', {
      p_submission_id: r2.submissionId,
      p_note: 'Evidence and calculations approved.',
      p_expected_state: 'submitted',
      p_expected_revision_digest: r2.digest,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state).toBe('approved')
    expect(body.decision).toBe('approve')

    const subRes = await proxy(
      `review_submissions?id=eq.${r2.submissionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const sub = (await subRes.json())[0]
    expect(sub.state).toBe('approved')
  })

  it('signs the approved revision with an approve-for-record signature and locks the record', async () => {
    const res = await asReviewer('sign_revision', {
      p_submission_id: r2.submissionId,
      p_signature_meaning: 'approve-for-record',
      p_confirmation_phrase: REVIEWER_NAME,
      p_expected_revision_digest: r2.digest,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    signatureId = body.signatureId
    expect(body.signatureMeaning).toBe('approve-for-record')
    expect(body.assuranceLevel).toBe('standard')

    // The signature is pinned to the frozen R2 digest.
    const sigRes = await proxy(
      `signatures?id=eq.${signatureId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const sig = (await sigRes.json())[0]
    expect(sig.revision_integrity_digest).toBe(r2.digest)
    expect(sig.signer_user_id).toBe(REVIEWER)

    // The owning record is now locked to R2.
    const recRes = await proxy(
      `records?id=eq.${experiment.id}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const rec = (await recRes.json())[0]
    expect(rec.locked_at).not.toBeNull()
    expect(rec.locked_by_revision_id).toBe(r2.revisionId)
  })

  it('reconstructs the complete record timeline', async () => {
    const res = await asOwner('record_timeline', { p_record_id: experiment.id })
    expect(res.status).toBe(200)
    const timeline = await res.json()
    const types = timeline.map((e: any) => e.type)
    // Two revisions, two submissions, a decision, a check run, a signature,
    // and the lock change event are all present in the reconstructed history.
    expect(types.filter((t: string) => t === 'revision').length).toBe(2)
    expect(types.filter((t: string) => t === 'submission').length).toBe(2)
    expect(types).toContain('decision')
    expect(types).toContain('check')
    expect(types).toContain('signature')
    expect(types).toContain('change_event')
    // The lock event is recorded.
    const lockEvent = timeline.find(
      (e: any) =>
        e.type === 'change_event' &&
        e.eventType === 'record' &&
        e.operation === 'lock',
    )
    expect(lockEvent).toBeDefined()
  })

  it('exports the complete revision evidence bundle for R2', async () => {
    const res = await asOwner('revision_evidence_package', {
      p_revision_id: r2.revisionId,
    })
    expect(res.status).toBe(200)
    const evidence = await res.json()
    expect(evidence.canonicalSnapshot.formatVersion).toBe(1)
    expect(evidence.revision.integrityDigest).toBe(r2.digest)
    expect(evidence.revision.supersededByRevisionId).toBeNull()
    // The package includes the immutable composed values and trusted results.
    expect(evidence.sheetEvidence[0].composedGrid.calculations).toHaveLength(1)
    expect(evidence.sheetEvidence[0].composedGrid.rows).toHaveLength(5)
    // Review artefacts are reconstructable from the bundle.
    expect(evidence.submission.state).toBe('approved')
    expect(evidence.decisions.length).toBe(1)
    expect(evidence.checkResults.length).toBe(1)
    expect(evidence.signatures.length).toBe(1)
    expect(evidence.signatures[0].signature_meaning).toBe('approve-for-record')
    expect(evidence.comments.length).toBe(1)
  })

  it('rejects live mutations of the locked record through the REST proxy', async () => {
    // Read the *current* structure/block versions so the lock (not a stale
    // version) is what rejects each mutation.
    const recBefore = await proxy(
      `records?id=eq.${experiment.id}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const recRow = (await recBefore.json())[0]
    const currentSv = recRow.structure_version
    const blockBefore = await proxy(
      `blocks?id=eq.${richBlock.id}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const blockRow = (await blockBefore.json())[0]
    const currentBlockVersion = blockRow.version

    // Block insert via RPC — the BEFORE INSERT lock trigger raises SB011.
    const insertRes = await asOwner('insert_block', {
      p_record_id: experiment.id,
      p_type: 'rich_text',
      p_payload: richTextDoc('tampered').doc,
      p_payload_schema_version: 1,
      p_expected_structure_version: currentSv,
    })
    expect(insertRes.status).toBeGreaterThanOrEqual(400)

    // Block payload update via RPC — the locked record's blocks are invisible
    // to UPDATE under RLS, so the RPC cannot find the row and rejects.
    const updateRes = await asOwner('update_block_payload', {
      p_block_id: richBlock.id,
      p_payload: richTextDoc('tampered').doc,
      p_expected_version: currentBlockVersion,
      p_payload_schema_version: 1,
    })
    expect(updateRes.status).toBeGreaterThanOrEqual(400)

    // Direct REST PATCH on the locked record's title: the records_update RLS
    // policy requires locked_at IS NULL, so 0 rows match and the title is
    // preserved (no error — RLS hides the row rather than raising).
    const patchRec = await proxy(
      `records?id=eq.${experiment.id}`,
      OWNER,
      OWNER_SESSION,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ title: 'tampered' }),
      },
    )
    if (patchRec.status < 400) {
      const patchBody = await patchRec.json()
      expect(Array.isArray(patchBody) ? patchBody.length : 0).toBe(0)
    }

    // ADR0021/0023: shared live Dataset/Instance evolution remains permitted.
    // The signed Notebook must continue to show the immutable captured values,
    // expressions and trusted calculation results, not this later live state.
    const original = await asOwner('revision_evidence_package', {
      p_revision_id: r2.revisionId,
    })
    expect(original.status).toBe(200)
    const frozen = await original.json()
    const [day0] = await getRows(0)
    const rowPatch = await commitRows([
      {
        operation: 'update',
        rowId: day0.id,
        expectedRevision: day0.revision,
        values: { [cols.titer]: 0 },
      },
    ])
    expect(rowPatch.status, await rowPatch.clone().text()).toBe(200)
    const calculation = sheetInstance.state.instanceCalculations![0]
    const amendedCalculation = await asOwner(
      'mutate_sheet_instance_calculations',
      {
        p_instance_id: sheetInstance.id,
        p_expected_revision: sheetInstance.revision,
        p_retry_token: crypto.randomUUID(),
        p_changes: [
          {
            operation: 'edit',
            calculation: {
              ...calculation,
              expression: {
                ...calculation.expression,
                source: '=A1 * 1.250',
              },
            },
          },
        ],
      },
    )
    expect(
      amendedCalculation.status,
      await amendedCalculation.clone().text(),
    ).toBe(200)
    const retainedRes = await asOwner('revision_evidence_package', {
      p_revision_id: r2.revisionId,
    })
    expect(retainedRes.status).toBe(200)
    const retained = await retainedRes.json()
    expect(retained.sheetEvidence).toEqual(frozen.sheetEvidence)
    expect(retained.canonicalSnapshot).toEqual(frozen.canonicalSnapshot)
    expect(retained.revision.integrityDigest).toBe(r2.digest)
    expect(
      retained.sheetEvidence[0].composedGrid.calculations[0].expression.source,
    ).toBe('=A1 * 1.000')
    expect(
      retained.sheetEvidence[0].composedGrid.calculations[0].results.map(
        (result: { value: number }) => result.value,
      ),
    ).toEqual(expect.arrayContaining([7.2, 7, 6.6, 5.7, 5.4]))

    // The persisted title is unchanged.
    const recRes = await proxy(
      `records?id=eq.${experiment.id}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const rec = (await recRes.json())[0]
    expect(rec.title).toBe('Virus Stability at 4 °C')
    // The live Dataset really changed; preservation above is not vacuous.
    expect(Number((await getRows(0))[0][cols.titer])).toBe(0)
  })

  it('rejects audit-evidence mutations (signatures / decisions / revisions) through the REST proxy', async () => {
    // Signatures are write-once: no UPDATE/DELETE grant.
    const sigPatch = await proxy(
      `signatures?id=eq.${signatureId}`,
      OWNER,
      OWNER_SESSION,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation_phrase: 'forged' }),
      },
    )
    expect(sigPatch.status).toBeGreaterThanOrEqual(400)
    const body = await sigPatch.json()
    expect(body.error.category).toBe('permission_denied')

    const sigDelete = await proxy(
      `signatures?id=eq.${signatureId}`,
      OWNER,
      OWNER_SESSION,
      { method: 'DELETE' },
    )
    expect(sigDelete.status).toBeGreaterThanOrEqual(400)

    // Revisions are immutable: no UPDATE/DELETE grant.
    const revPatch = await proxy(
      `revisions?id=eq.${r2.revisionId}`,
      OWNER,
      OWNER_SESSION,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrity_digest: 'forged'.repeat(8).slice(0, 64),
        }),
      },
    )
    expect(revPatch.status).toBeGreaterThanOrEqual(400)
    const revBody = await revPatch.json()
    expect(revBody.error.category).toBe('permission_denied')

    // Re-running the R2 submission digest confirms the revision is unchanged.
    const refetch = await proxy(
      `revisions?id=eq.${r2.revisionId}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const rev = (await refetch.json())[0]
    expect(rev.integrity_digest).toBe(r2.digest)
  })

  it('rejects prohibited mutations at the database boundary with SB011 / permission codes', async () => {
    // A direct authenticated-role connection (the role PostgREST switches to)
    // proves the lock is enforced beneath the REST surface, with the exact
    // SQLSTATE the trigger raises (the proxy normalises these away). Uses
    // session-level claim injection so every statement on the connection sees
    // the same workspace/session context, matching the sign-002 pattern.
    const auth = new Client({
      connectionString: process.env.DATABASE_URL,
    })
    await auth.connect()
    try {
      await auth.query(`SET ROLE authenticated`)
      await auth.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({
          sub: OWNER,
          workspace_id: WS,
          session_id: OWNER_SESSION,
          role: 'authenticated',
        }),
      ])

      // Block INSERT on a locked record → SB011 (the BEFORE INSERT lock
      // trigger fires before the RLS WITH CHECK is evaluated).
      await expect(
        auth.query(
          `INSERT INTO api.blocks (record_id, type, payload, payload_schema_version, "order", version)
           VALUES ($1, 'rich_text', '{}'::jsonb, 1, 500, 1)`,
          [experiment.id],
        ),
      ).rejects.toMatchObject({ code: 'SB011' })

      // Submit on a locked record → SB011 (amendment is the only path).
      const preview = await auth.query(
        `SELECT api.preview_submission_digest($1) AS result`,
        [experiment.id],
      )
      const digest = (preview.rows[0].result as { sourceDigest: string })
        .sourceDigest
      await expect(
        auth.query(
          `SELECT api.submit_record_revision($1, $2, 'default-scientific-review', 1, ARRAY[$3], true, 'locked-submit') AS result`,
          [experiment.id, digest, REVIEWER],
        ),
      ).rejects.toMatchObject({ code: 'SB011' })

      // Direct signature UPDATE is denied by RLS → 42501.
      await expect(
        auth.query(
          `UPDATE api.signatures SET confirmation_phrase = 'forged' WHERE id = $1`,
          [signatureId],
        ),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await auth.query(`RESET ROLE`)
      await auth.end()
    }
  })
})
