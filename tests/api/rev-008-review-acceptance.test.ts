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
 * The experiment fixture is built entirely through RPCs (never by seeding
 * scientific content). Formula definitions have no public RPC, so they are
 * written through the migrator connection into the same trusted schema the
 * formula-write / calculation servers use. The live database is never reset
 * or reseeded — only this suite's dedicated workspace is cleaned up.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { toCanonicalEnvelope } from '#/lib/review-workspace'
import { diffRevisionEnvelopes } from '#/lib/revision-diff'
import type { RevisionWire } from '#/lib/notebook-data'

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
let sheetTable: { id: string; resource_name: string; schema_version: number }
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
    `DELETE FROM api.formula_dependencies WHERE workspace_id = $1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.formula_definitions WHERE workspace_id = $1`,
    [WS],
  )
  // Drop generated scientific tables before removing their catalog rows
  // (scientific_tables.block_id is ON DELETE RESTRICT).
  const generated = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id = $1`,
    [WS],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await admin.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await admin.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id = $1`,
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
  await admin.query(`DELETE FROM api.records WHERE workspace_id = $1`, [WS])
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
) {
  const res = await rpc('create_record', user, session, {
    p_project_id: PROJECT,
    p_kind: kind,
    p_title: title,
    p_status: status,
    p_tags: [],
    p_properties: properties,
  })
  expect(res.status).toBe(200)
  return res.json()
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

async function getRows(filter: string) {
  const res = await proxy(
    `${sheetTable.resource_name}?${filter}`,
    OWNER,
    OWNER_SESSION,
  )
  expect(res.status).toBe(200)
  return res.json() as Promise<Array<Record<string, unknown>>>
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

  // --- Build the Virus Stability notebook through ordinary RPCs. ---
  sample = await createRecord(
    OWNER,
    OWNER_SESSION,
    'sample',
    'LVV-CAR-T drug substance',
    'available',
    {
      construct: 'LVV-CAR-T',
      batch: 'LVV-250601',
      storage: '4 °C',
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

  // Sheet block + scientific table.
  const sheetJson = await insertBlock(
    OWNER,
    OWNER_SESSION,
    experiment,
    'sheet',
    {},
  )
  experiment.structure_version = sheetJson.structure_version
  const tableRes = await asOwner('create_scientific_table', {
    p_block_id: sheetJson.block.id,
    p_name: 'Stability readings (qPCR)',
    p_columns: [
      {
        label: 'Time (days)',
        logical_type: 'decimal',
        unit: { code: 'd', symbol: 'd' },
      },
      {
        label: 'Log titer',
        logical_type: 'decimal',
        unit: { code: 'log10', symbol: 'log₁₀' },
      },
      { label: 'Condition', logical_type: 'text' },
    ],
  })
  expect(tableRes.status).toBe(200)
  const built = await tableRes.json()
  sheetTable = built.table
  const byLabel = Object.fromEntries(
    built.columns.map((c: any) => [c.label, c]),
  )
  cols = {
    time: byLabel['Time (days)'].field_name,
    titer: byLabel['Log titer'].field_name,
    condition: byLabel['Condition'].field_name,
  }

  // Four 4 °C timepoint rows.
  const r1Rows = [
    [0, 7.2, '4 °C'],
    [7, 7.0, '4 °C'],
    [14, 6.6, '4 °C'],
    [28, 5.9, '4 °C'],
  ] as const
  for (const [t, logTiter, condition] of r1Rows) {
    const rowRes = await proxy(sheetTable.resource_name, OWNER, OWNER_SESSION, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        [cols.time]: t,
        [cols.titer]: logTiter,
        [cols.condition]: condition,
      }),
    })
    expect(rowRes.status).toBe(201)
  }

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

  // 2. Modify the day-28 log titer cell (5.9 → 5.7) via the generated-table REST surface.
  const rowsBefore = await getRows(
    `${cols.time}=eq.28&select=id,version,${cols.time},${cols.titer}`,
  )
  const day28 = rowsBefore.find((r) => Number(r[cols.time]) === 28)!
  const patchRes = await proxy(
    `${sheetTable.resource_name}?id=eq.${day28.id}&version=eq.${day28.version}`,
    OWNER,
    OWNER_SESSION,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ [cols.titer]: 5.7 }),
    },
  )
  expect(patchRes.status).toBe(200)

  // 3. Add a day-42 timepoint row.
  const addRowRes = await proxy(
    sheetTable.resource_name,
    OWNER,
    OWNER_SESSION,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        [cols.time]: 42,
        [cols.titer]: 5.4,
        [cols.condition]: '4 °C',
      }),
    },
  )
  expect(addRowRes.status).toBe(201)

  // 4. Add a supported formula on the day-0 log-titer cell. Formula
  //    definitions have no public RPC, so write through the migrator into the
  //    same trusted schema the formula-write / calculation servers use, plus a
  //    current (non-stale) result-cache row so reviewer checks pass.
  const day0 = (await getRows(`${cols.time}=eq.0&select=id,${cols.time}`))[0]
  const titerColumnId = byLabel['Log titer'].id
  const formulaId = '6d000000-0000-4000-8000-0000000008f1'
  await admin.query(
    `INSERT INTO api.formula_definitions(
       id, workspace_id, record_id, target_table_id, target_row_id, target_column_id,
       source_expression, template, bindings, engine_expression, syntax_profile,
       function_profile, literal_profile, engine_version, status, version,
       created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,$16,$16)`,
    [
      formulaId,
      WS,
      experiment.id,
      sheetTable.id,
      day0.id,
      titerColumnId,
      '=ROUND([Log titer] * 1.000, 4)',
      JSON.stringify({
        kind: 'formula',
        expression: '=ROUND([Log titer] * 1.000, 4)',
      }),
      JSON.stringify([
        {
          kind: 'cell',
          tableId: sheetTable.id,
          rowId: day0.id,
          columnId: titerColumnId,
          label: 'Log titer',
        },
      ]),
      'ROUND([Log titer] * 1.000, 4)',
      'sheetbase-hf-en-us-v1',
      'scientific-core-v2',
      'sheetbase-literal-v1',
      '3.3.0',
      'supported',
      OWNER,
    ],
  )
  await admin.query(
    `INSERT INTO internal.formula_result_cache(
       formula_id, workspace_id, record_id, formula_version, input_revision,
       schema_versions, status, result_kind, value, error_code, engine_version,
       profile_fingerprint, runtime_fingerprint)
     VALUES ($1,$2,$3,1,0,$4,'completed','value',$5,NULL,'3.3.0','fnv1a32-dcfa915f','fnv1a32-5678abcd')`,
    [
      formulaId,
      WS,
      experiment.id,
      JSON.stringify({ [sheetTable.id]: sheetTable.schema_version }),
      JSON.stringify(7.2),
    ],
  )

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

    const envelope = toCanonicalEnvelope(refetched as RevisionWire)
    // R1 has no formula (the formula was added after R1 was submitted).
    expect(Array.isArray(envelope.formulas)).toBe(true)
    expect(envelope.formulas.length).toBe(0)
    // R1 carries the original rich-text + four-row table.
    expect(envelope.blocks.length).toBeGreaterThanOrEqual(1)
    expect(envelope.scientificTables[0].rows.length).toBe(4)
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
      toCanonicalEnvelope(r1Row as RevisionWire),
      toCanonicalEnvelope(r2Row as RevisionWire),
    )

    // Metadata title modified.
    const textChange = diff.changes.find(
      (c) => c.area === 'text' && c.kind === 'modified',
    )
    expect(textChange).toBeDefined()

    // Scientific-table cell modified (the day-28 log titer). This exercises
    // the field_name column-key resolution in revision-diff.
    const tableSummary = diff.tableSummaries.find(
      (s) => s.tableId === sheetTable.id,
    )
    expect(tableSummary).toBeDefined()
    expect(tableSummary!.addedRows).toBe(1)
    expect(tableSummary!.modifiedCells).toBeGreaterThanOrEqual(1)
    const cellChange = tableSummary!.changes.find(
      (c) => c.kind === 'modified' && c.rowId && c.columnId,
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
    const res = await asOwner('export_revision_evidence', {
      p_revision_id: r2.revisionId,
    })
    expect(res.status).toBe(200)
    const evidence = await res.json()
    expect(evidence.formatVersion).toBe(1)
    expect(evidence.revision.integrity_digest).toBe(r2.digest)
    expect(evidence.revision.superseded_by_revision_id).toBeNull()
    // The reconstructed snapshot still carries the amended table + formula.
    const env = toCanonicalEnvelope({
      canonical_snapshot: evidence.revision.canonical_snapshot,
    } as RevisionWire)
    expect(env.formulas.length).toBe(1)
    expect(env.scientificTables[0].rows.length).toBe(5)
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

    // Direct REST PATCH on a locked record's scientific row — the generated
    // table's BEFORE trigger calls assert_scientific_record_writable, which
    // raises SB011 for a locked record.
    const rows = await getRows(`${cols.time}=eq.0&select=id,version`)
    const rowPatch = await proxy(
      `${sheetTable.resource_name}?id=eq.${rows[0].id}&version=eq.${rows[0].version}`,
      OWNER,
      OWNER_SESSION,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ [cols.titer]: 0 }),
      },
    )
    expect(rowPatch.status).toBeGreaterThanOrEqual(400)

    // The persisted title is unchanged.
    const recRes = await proxy(
      `records?id=eq.${experiment.id}&limit=1`,
      OWNER,
      OWNER_SESSION,
    )
    const rec = (await recRes.json())[0]
    expect(rec.title).toBe('Virus Stability at 4 °C')
    // The day-0 log titer cell is unchanged (the row PATCH was rejected).
    const day0 = (await getRows(`${cols.time}=eq.0&select=${cols.titer}`))[0]
    expect(Number(day0[cols.titer])).toBe(7.2)
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
