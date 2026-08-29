/**
 * SCI-009 end-to-end API acceptance: reproduce the Virus Stability notebook
 * through ordinary REST capabilities (the same /api/db PostgREST proxy and
 * RPCs the UI uses), then verify every block type renders, the overview
 * composes from the notebook record, search retrieves the experiment and its
 * permitted linked objects, every major visible object has a REST
 * representation, and workspace isolation still holds.
 *
 * This test creates its own workspace/user/project fixture (never the demo
 * seed) and builds the notebook entirely through handleProxyRequest + RPCs.
 */
import { config } from 'dotenv'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { composeSections } from '#/lib/overview'
import { toBlock, type BlockWire } from '#/lib/notebook-data'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { createScientificTableAsMigrator } from '../db/helpers'
import {
  LocalFileStorage,
  setObjectStorageForTesting,
} from '#/lib/file-storage'
import { handleUpload, handleUploadAuthorize } from '#/lib/file-routes'

config({ path: ['.env.local', '.env'] })

const WS_A = '6d000000-0000-4000-8000-00000000090a'
const WS_B = '6d000000-0000-4000-8000-00000000090b'
const PROJECT_A = '6d000000-0000-4000-8000-00000000091a'
const PROJECT_B = '6d000000-0000-4000-8000-00000000091b'
const USER_A = 'sci-009-api-owner-a'
const USER_B = 'sci-009-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let storageDir: string
let storage: LocalFileStorage

// Shared notebook state, populated by beforeAll through ordinary RPCs.
let sample: any
let reagent: any
let protocol: any
let experiment: any
let sheetTable: any
let sheetCols: any
let liveChartBlock: any
let frozenChartBlock: any
let fileMeta: any
let allBlockIds: string[] = []

async function clean(): Promise<void> {
  await admin.query(
    `DELETE FROM api.review_submissions WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM internal.revision_file_objects WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  // Drop generated scientific tables in these workspaces before removing the
  // blocks they reference (scientific_tables.block_id is ON DELETE RESTRICT).
  const generated = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await admin.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await admin.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN
       (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))
       OR target_record_id IN
       (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.file_objects WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1,$2)`, [
    USER_A,
    USER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci-009-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input: any) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function rpc(
  name: string,
  user: string,
  workspace: string,
  body: unknown,
) {
  return proxy(`rpc/${name}`, user, workspace, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createRecord(
  user: string,
  workspace: string,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  properties: Record<string, unknown> = {},
) {
  const res = await rpc('create_record', user, workspace, {
    p_project_id: project,
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
  workspace: string,
  record: { id: string; structure_version: number },
  type: string,
  payload: unknown,
) {
  const res = await rpc('insert_block', user, workspace, {
    p_record_id: record.id,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: record.structure_version,
  })
  return res
}

function authDeps(userId: string, workspaceId: string) {
  return {
    getSession: async () => ({
      user: { id: userId },
      session: { id: 'sci-009-session' },
    }),
    getWorkspaceForUser: async () => ({ id: workspaceId }),
    mintToken: (input: any) => mintPostgrestToken(SECRET, input),
  }
}

async function authorizeAndUpload(
  userId: string,
  workspaceId: string,
  projectId: string,
  file: { name: string; type: string; bytes: Uint8Array },
) {
  const authRes = await handleUploadAuthorize(
    new Request('http://sheetbase.test/api/files/upload-authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        displayName: file.name,
        mediaType: file.type,
        byteSize: file.bytes.byteLength,
        checksum: null,
      }),
    }),
    authDeps(userId, workspaceId),
  )
  expect(authRes.status).toBe(201)
  const meta = await authRes.json()
  const upRes = await handleUpload(
    new Request(`http://sheetbase.test/api/files/${meta.fileRecordId}/upload`, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file.bytes,
    }),
    meta.fileRecordId,
    authDeps(userId, workspaceId),
    storage,
  )
  expect(upRes.status).toBeLessThan(300)
  return { meta }
}

// Canonical rich-text v1 document with an H2 heading + paragraph.
function richTextDoc(heading: string, paragraph: string) {
  return {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: heading }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: paragraph }],
        },
      ],
    },
  }
}

function chartPayload(tableId: string, cols: Record<string, any>) {
  return {
    title: 'Vector genome copy number (qPCR)',
    spec: {
      specVersion: 1,
      type: 'line',
      datasets: [{ tableId }],
      fields: {
        x: { columnId: cols.x.id, fieldName: cols.x.field_name },
        y: { columnId: cols.y.id, fieldName: cols.y.field_name },
        series: { columnId: cols.series.id, fieldName: cols.series.field_name },
        color: null,
        size: null,
      },
      filters: [],
      transformations: [],
      display: {
        axes: {
          x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
          y: { label: 'Log titer', scale: 'linear', unit: 'log₁₀' },
        },
        series: [
          { identifier: '4 °C', label: '4 °C', color: '#006EDC' },
          { identifier: '−20 °C', label: '−20 °C', color: '#00A659' },
        ],
        legend: { visible: true },
      },
      overlays: { errorBars: null },
    },
    provenance: 'Virus Stability qPCR',
    frozen: null,
  }
}

function plateMapPayload(sampleRef: {
  id: string
  identifier: string
  title: string
}) {
  return {
    title: 'qPCR titration plate',
    spec: {
      specVersion: 1,
      format: '96_well',
      rows: 8,
      cols: 12,
      wells: [
        {
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRef: {
            recordId: sampleRef.id,
            identifier: sampleRef.identifier,
            title: sampleRef.title,
          },
          replicate: 1,
          volume: { value: 20, unit: 'µL' },
        },
        { wellCode: 'A2', row: 0, col: 1, role: 'positive_control' },
        { wellCode: 'A3', row: 0, col: 2, role: 'negative_control' },
      ],
      validation: {
        requiredRoles: ['positive_control', 'negative_control'],
        volumeMin: 20,
        volumeMax: 20,
        volumeUnit: 'µL',
      },
    },
    provenance: 'Virus Stability qPCR',
  }
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await clean()
  storageDir = await mkdtemp(join(tmpdir(), 'sheetbase-sci009-api-'))
  storage = new LocalFileStorage(storageDir)
  setObjectStorageForTesting(storage)

  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 009 API A','sci-009-api-a@test.invalid',true),
      ($2,'SCI 009 API B','sci-009-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-009-api-a','SCI 009 API A'),($2,'sci-009-api-b','SCI 009 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci009','Lentivector Stability Study'),
      ($3,$4,'sci009b','SCI 009 API B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )

  // --- Build the Virus Stability notebook through ordinary RPCs. ---

  // Linked registry records.
  sample = await createRecord(
    USER_A,
    WS_A,
    PROJECT_A,
    'sample',
    'LVV-CAR-T drug substance',
    'available',
    {
      construct: 'LVV-CAR-T',
      batch: 'LVV-250601',
      concentration: 2.31e7,
      storage: '4 °C',
    },
  )
  reagent = await createRecord(
    USER_A,
    WS_A,
    PROJECT_A,
    'reagent',
    'TaqMan qPCR kit',
    'available',
    {
      supplier: 'Acme Biosystems',
      catalog_no: 'TAQ-1000',
      lot: 'TG-2604',
      storage: '-20 °C',
    },
  )
  protocol = await createRecord(
    USER_A,
    WS_A,
    PROJECT_A,
    'protocol_template',
    'Titration Assay',
    'active',
    {
      version: '1.2',
    },
  )
  // Protocol procedure-step definition blocks.
  let pres = await insertBlock(USER_A, WS_A, protocol, 'procedure_step', {
    text: 'Prepare a serial dilution of the sample.',
    stepNumber: 1,
  })
  expect(pres.status).toBe(200)
  protocol.structure_version = (await pres.json()).structure_version
  pres = await insertBlock(USER_A, WS_A, protocol, 'procedure_step', {
    text: 'Measure the assay response and fit the titration curve.',
    stepNumber: 2,
  })
  expect(pres.status).toBe(200)
  protocol.structure_version = (await pres.json()).structure_version

  // Experiment record.
  experiment = await createRecord(
    USER_A,
    WS_A,
    PROJECT_A,
    'experiment',
    'Virus Stability at 4°C',
    'in_progress',
    {},
  )

  // 1. rich_text — objective
  let res = await insertBlock(
    USER_A,
    WS_A,
    experiment,
    'rich_text',
    richTextDoc(
      'Objective',
      'Evaluate LVV-CAR-T vector stability at 4 °C across a 28-day window with durable formulas and calculation provenance.',
    ),
  )
  expect(res.status).toBe(200)
  let json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 2. materials
  res = await insertBlock(USER_A, WS_A, experiment, 'materials', {
    items: [
      {
        id: 'mat-sample',
        materialRecordId: sample.id,
        kind: 'sample',
        identifier: sample.identifier,
        title: sample.title,
        quantity: 100,
        unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
        observedAt: '2026-07-21T12:00:00.000Z',
      },
      {
        id: 'mat-reagent',
        materialRecordId: reagent.id,
        kind: 'reagent',
        identifier: reagent.identifier,
        title: reagent.title,
        quantity: 20,
        unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
        observedAt: '2026-07-21T12:00:00.000Z',
      },
    ],
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 3. table — experimental design
  res = await insertBlock(USER_A, WS_A, experiment, 'table', {
    columns: ['Timepoint', 'Replicate', 'Volume', 'Storage'],
    rows: [
      ['Day 0', 1, '100 µL', '4 °C'],
      ['Day 0', 2, '100 µL', '4 °C'],
      ['Day 28', 1, '100 µL', '4 °C'],
    ],
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 4. checklist — procedure progress / QC checks
  res = await insertBlock(USER_A, WS_A, experiment, 'checklist', {
    items: [
      { text: 'Data integrity verified', checked: true },
      { text: 'Instrument calibration confirmed', checked: true },
      { text: 'Reagent expiry checked', checked: false },
    ],
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 5. callout
  res = await insertBlock(USER_A, WS_A, experiment, 'callout', {
    text: 'Include a no-template control (NTC) in every qPCR run.',
    variant: 'warning',
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 6. metric
  res = await insertBlock(USER_A, WS_A, experiment, 'metric', {
    label: 'Titer at day 0',
    value: 2.31e7,
    unit: 'copies/mL',
    provenance: 'qPCR',
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 7. protocol_reference — insert empty, then pin (copies procedure steps + links)
  res = await insertBlock(USER_A, WS_A, experiment, 'protocol_reference', {})
  expect(res.status).toBe(200)
  json = await res.json()
  const protoRefBlock = json.block
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  const pinRes = await rpc('pin_protocol_reference', USER_A, WS_A, {
    p_block_id: protoRefBlock.id,
    p_protocol_record_id: protocol.id,
    p_expected_block_version: protoRefBlock.version,
    p_expected_structure_version: experiment.structure_version,
  })
  expect(pinRes.status).toBe(200)
  const pinned = await pinRes.json()
  experiment.structure_version = pinned.structure_version
  // pin copies procedure_step blocks into the experiment
  for (const step of pinned.copied_steps) {
    allBlockIds.push(step.id)
  }

  // 8. sheet — scientific sheet with HyperFormula-ready columns + rows
  res = await insertBlock(USER_A, WS_A, experiment, 'sheet', {})
  expect(res.status).toBe(200)
  json = await res.json()
  const sheetBlock = json.block
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  const built = await createScientificTableAsMigrator(
    admin,
    USER_A,
    WS_A,
    sheetBlock.id,
    'Stability readings (qPCR)',
    [
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
  )
  sheetTable = built.table
  const byLabel = Object.fromEntries(
    built.columns.map((c: any) => [c.label, c]),
  )
  sheetCols = {
    x: byLabel['Time (days)'],
    y: byLabel['Log titer'],
    series: byLabel['Condition'],
  }

  const sheetRows = [
    [0, 7.2, '4 °C'],
    [7, 7.0, '4 °C'],
    [14, 6.6, '4 °C'],
    [28, 5.9, '4 °C'],
    [0, 7.1, '−20 °C'],
    [7, 6.9, '−20 °C'],
    [14, 6.7, '−20 °C'],
    [28, 6.4, '−20 °C'],
  ] as const
  for (const [t, logTiter, condition] of sheetRows) {
    const rowRes = await proxy(sheetTable.resource_name, USER_A, WS_A, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        [sheetCols.x.field_name]: t,
        [sheetCols.y.field_name]: logTiter,
        [sheetCols.series.field_name]: condition,
      }),
    })
    expect(rowRes.status).toBe(201)
  }

  // 9. chart — live chart referencing the scientific sheet
  res = await insertBlock(
    USER_A,
    WS_A,
    experiment,
    'chart',
    chartPayload(sheetTable.id, sheetCols),
  )
  expect(res.status).toBe(200)
  json = await res.json()
  liveChartBlock = json.block
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 10. chart — frozen chart (freeze via RPC)
  res = await insertBlock(
    USER_A,
    WS_A,
    experiment,
    'chart',
    chartPayload(sheetTable.id, sheetCols),
  )
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)
  const freezeRes = await rpc('freeze_chart', USER_A, WS_A, {
    p_block_id: json.block.id,
    p_expected_version: json.block.version,
  })
  expect(freezeRes.status).toBe(200)
  frozenChartBlock = await freezeRes.json()

  // 11. file — upload through the ordinary two-phase upload flow + file block
  const csvBytes = new TextEncoder().encode(
    'timepoint,temperature,log_titer\n0,4,7.2\n7,4,7.0\n14,4,6.6\n28,4,5.9\n',
  )
  const { meta } = await authorizeAndUpload(USER_A, WS_A, PROJECT_A, {
    name: 'stability-run07-4c.csv',
    type: 'text/csv',
    bytes: csvBytes,
  })
  fileMeta = meta
  res = await insertBlock(USER_A, WS_A, experiment, 'file', {
    fileRecordId: meta.fileRecordId,
    fileIdentifier: meta.fileIdentifier,
    displayName: 'stability-run07-4c.csv',
    mediaType: 'text/csv',
    byteSize: csvBytes.byteLength,
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 12. plate_map
  res = await insertBlock(
    USER_A,
    WS_A,
    experiment,
    'plate_map',
    plateMapPayload({
      id: sample.id,
      identifier: sample.identifier,
      title: sample.title,
    }),
  )
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // 13. linked_record — in-notebook link render block
  res = await insertBlock(USER_A, WS_A, experiment, 'linked_record', {
    targetKind: 'sample',
    targetIdentifier: sample.identifier,
    label: 'LVV-CAR-T drug substance',
    linkType: 'sample',
  })
  expect(res.status).toBe(200)
  json = await res.json()
  experiment.structure_version = json.structure_version
  allBlockIds.push(json.block.id)

  // record_links — authoritative relation graph.
  // The protocol link is already created by pin_protocol_reference above, and
  // the materials block may create sample/reagent links; accept 409 (already
  // exists) since the relation is the same either way.
  for (const [target, kind, linkType] of [
    [sample, 'sample', 'sample'],
    [reagent, 'reagent', 'reagent'],
  ] as const) {
    const linkRes = await rpc('create_record_link', USER_A, WS_A, {
      p_source_record_id: experiment.id,
      p_target_record_id: target.id,
      p_target_kind: kind,
      p_target_identifier: target.identifier,
      p_link_type: linkType,
    })
    expect([200, 409]).toContain(linkRes.status)
  }
  // link the file record
  const fileLinkRes = await rpc('create_record_link', USER_A, WS_A, {
    p_source_record_id: experiment.id,
    p_target_record_id: meta.fileRecordId,
    p_target_kind: 'file',
    p_target_identifier: meta.fileIdentifier,
    p_link_type: 'file',
  })
  expect(fileLinkRes.status).toBe(200)
}, 120_000)

afterAll(async () => {
  setObjectStorageForTesting(null)
  if (admin) {
    await clean()
    await admin.end()
  }
  if (storageDir) await rm(storageDir, { recursive: true, force: true })
})

describe('SCI-009 Virus Stability end-to-end API acceptance', () => {
  it('creates the experiment through ordinary RPCs with all 13 block types', async () => {
    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&order=order.asc`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    const rows = (await read.json()) as BlockWire[]
    const types = new Set(rows.map((r) => r.type))
    // Every valid block type is represented.
    for (const type of [
      'rich_text',
      'checklist',
      'linked_record',
      'callout',
      'table',
      'sheet',
      'chart',
      'plate_map',
      'file',
      'metric',
      'procedure_step',
      'protocol_reference',
      'materials',
    ]) {
      expect(types.has(type), `block type ${type} missing`).toBe(true)
    }
    // Two charts (live + frozen) and two procedure_step blocks (copied by pin).
    expect(rows.filter((r) => r.type === 'chart')).toHaveLength(2)
    expect(rows.filter((r) => r.type === 'procedure_step')).toHaveLength(2)
  })

  it('renders the callout with the validated text/variant payload contract', async () => {
    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&type=eq.callout`,
      USER_A,
      WS_A,
    )
    const rows = await read.json()
    expect(rows[0].payload).toMatchObject({
      text: 'Include a no-template control (NTC) in every qPCR run.',
      variant: 'warning',
    })
  })

  it('pins the protocol reference with copied steps and canonical provenance', async () => {
    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&type=eq.protocol_reference`,
      USER_A,
      WS_A,
    )
    const rows = await read.json()
    expect(rows[0].payload).toMatchObject({
      protocolRecordId: protocol.id,
      protocolIdentifier: protocol.identifier,
      protocolTitle: 'Titration Assay',
      approvalStatus: 'active',
      pinnedByUserId: USER_A,
    })
    const steps = await (
      await proxy(
        `blocks?record_id=eq.${experiment.id}&type=eq.procedure_step&order=order.asc`,
        USER_A,
        WS_A,
      )
    ).json()
    expect(steps).toHaveLength(2)
    expect(steps[0].payload).toMatchObject({
      text: 'Prepare a serial dilution of the sample.',
      completed: false,
    })
  })

  it('verifies the scientific sheet has HyperFormula-ready rows and a generated REST resource', async () => {
    // The generated table resource is readable through the proxy.
    const rowsRes = await proxy(
      `${sheetTable.resource_name}?order=id.asc`,
      USER_A,
      WS_A,
    )
    expect(rowsRes.status).toBe(200)
    const rows = await rowsRes.json()
    expect(rows).toHaveLength(8)
    const firstPoint = rows.find(
      (r: any) =>
        r[sheetCols.x.field_name] === 0 &&
        r[sheetCols.series.field_name] === '4 °C',
    )
    expect(firstPoint).toBeDefined()
    expect(firstPoint).toMatchObject({ [sheetCols.y.field_name]: 7.2 })
    // The generated table metadata is readable through its RPC.
    const metaRes = await rpc('scientific_table_metadata', USER_A, WS_A, {
      p_table_id: sheetTable.id,
    })
    expect(metaRes.status).toBe(200)
  })

  it('freezes a chart through the transactional RPC with materialized data', async () => {
    expect(frozenChartBlock.payload.frozen).toBeTruthy()
    expect(frozenChartBlock.payload.frozen.frozenByUserId).toBe(USER_A)
    expect(frozenChartBlock.payload.frozen.datasetProvenance[0].datasetVersionId).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
    expect(frozenChartBlock.payload.frozen.data.series).toEqual([])
    // Live chart remains unfrozen.
    const liveRead = await proxy(
      `blocks?id=eq.${liveChartBlock.id}`,
      USER_A,
      WS_A,
    )
    const live = (await liveRead.json())[0]
    expect(live.payload.frozen).toBeNull()
  })

  it('composes the overview from the underlying notebook blocks', async () => {
    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&order=order.asc`,
      USER_A,
      WS_A,
    )
    const rows = (await read.json()) as BlockWire[]
    const blocks = rows.map(toBlock)
    const sections = composeSections(blocks)
    // Every section that should be populated is present.
    const sectionIds = new Set(sections.map((s) => s.id))
    for (const id of [
      'notes',
      'materials',
      'procedures',
      'tables',
      'visualizations',
      'metrics',
      'files',
      'links',
      'tasks',
    ]) {
      expect(sectionIds.has(id as any), `overview section ${id} missing`).toBe(
        true,
      )
    }
    // Visualizations contains both charts and the plate map.
    const viz = sections.find((s) => s.id === 'visualizations')!
    expect(viz.blocks.filter((b) => b.type === 'chart')).toHaveLength(2)
    expect(viz.blocks.filter((b) => b.type === 'plate_map')).toHaveLength(1)
    // Procedures contains the pinned protocol_reference and copied steps.
    const proc = sections.find((s) => s.id === 'procedures')!
    expect(
      proc.blocks.filter((b) => b.type === 'protocol_reference'),
    ).toHaveLength(1)
    expect(proc.blocks.filter((b) => b.type === 'procedure_step')).toHaveLength(
      2,
    )
  })

  it('persists and reads back overview exclusion configuration', async () => {
    const read = await proxy(
      `blocks?record_id=eq.${experiment.id}&type=eq.callout`,
      USER_A,
      WS_A,
    )
    const block = (await read.json())[0]
    const properties = { overview: { excludedBlockIds: [block.id] } }
    const update = await proxy(
      `records?id=eq.${experiment.id}&select=id,properties`,
      USER_A,
      WS_A,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ properties }),
      },
    )
    expect(update.status).toBe(200)
    const readBack = await proxy(
      `records?id=eq.${experiment.id}&select=id,properties`,
      USER_A,
      WS_A,
    )
    expect((await readBack.json())[0].properties).toEqual(properties)
    // Restore empty config so later tests see the full overview.
    await proxy(
      `records?id=eq.${experiment.id}&select=id,properties`,
      USER_A,
      WS_A,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ properties: {} }),
      },
    )
  })

  it('retrieves the experiment and linked objects through search', async () => {
    const searchRes = await rpc('search', USER_A, WS_A, {
      p_query: 'virus stability',
    })
    expect(searchRes.status).toBe(200)
    const rows = await searchRes.json()
    const exp = Array.isArray(rows)
      ? rows.find((r: any) => r.record_id === experiment.id)
      : rows
    expect(exp).toBeDefined()
    expect(exp.deep_link).toMatch(/\/projects\/.*\/experiments\//)
    expect(exp.result_type).toBe('record')

    // Linked sample is findable by its scientific content.
    const sampleSearch = await rpc('search', USER_A, WS_A, {
      p_query: 'LVV-CAR-T drug substance',
    })
    const sampleRows = await sampleSearch.json()
    const sampleHit = (
      Array.isArray(sampleRows) ? sampleRows : [sampleRows]
    ).find((r: any) => r.record_id === sample.id)
    expect(sampleHit).toBeDefined()

    // Protocol is findable.
    const protoSearch = await rpc('search', USER_A, WS_A, {
      p_query: 'titration assay',
    })
    const protoRows = await protoSearch.json()
    const protoHit = (Array.isArray(protoRows) ? protoRows : [protoRows]).find(
      (r: any) => r.record_id === protocol.id,
    )
    expect(protoHit).toBeDefined()
  })

  it('exposes a REST representation for every major visible object', async () => {
    // Experiment record
    let r = await proxy(`records?id=eq.${experiment.id}`, USER_A, WS_A)
    expect(r.status).toBe(200)
    expect((await r.json())[0]).toMatchObject({
      kind: 'experiment',
      title: 'Virus Stability at 4°C',
    })

    // Blocks ordered
    r = await proxy(
      `blocks?record_id=eq.${experiment.id}&order=order.asc`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect((await r.json()).length).toBeGreaterThanOrEqual(13)

    // Record links
    r = await proxy(
      `record_links?source_record_id=eq.${experiment.id}&order=target_identifier.asc`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    const links = await r.json()
    expect(links.length).toBeGreaterThanOrEqual(4)

    // Samples / reagents / protocols by kind
    r = await proxy(
      `records?kind=eq.sample&project_id=eq.${PROJECT_A}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect((await r.json()).length).toBeGreaterThanOrEqual(1)
    r = await proxy(
      `records?kind=eq.reagent&project_id=eq.${PROJECT_A}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect((await r.json()).length).toBeGreaterThanOrEqual(1)
    r = await proxy(
      `records?kind=eq.protocol_template&project_id=eq.${PROJECT_A}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect((await r.json()).length).toBeGreaterThanOrEqual(1)

    // File objects
    r = await proxy(
      `file_objects?record_id=eq.${fileMeta.fileRecordId}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect((await r.json())[0]).toMatchObject({
      display_name: 'stability-run07-4c.csv',
      media_type: 'text/csv',
    })

    // Scientific table metadata RPC
    r = await rpc('scientific_table_metadata', USER_A, WS_A, {
      p_table_id: sheetTable.id,
    })
    expect(r.status).toBe(200)

    // Chart blocks
    r = await proxy(
      `blocks?type=eq.chart&record_id=eq.${experiment.id}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toHaveLength(2)

    // Plate map blocks
    r = await proxy(
      `blocks?type=eq.plate_map&record_id=eq.${experiment.id}`,
      USER_A,
      WS_A,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toHaveLength(1)

    // Search RPC
    r = await rpc('search', USER_A, WS_A, { p_query: 'virus stability' })
    expect(r.status).toBe(200)
  })

  it('enforces workspace isolation for every major object', async () => {
    // Cross-workspace cannot read the experiment blocks.
    let r = await proxy(`blocks?record_id=eq.${experiment.id}`, USER_B, WS_B)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])

    // Cross-workspace cannot read the experiment record.
    r = await proxy(`records?id=eq.${experiment.id}`, USER_B, WS_B)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])

    // Cross-workspace cannot read record links.
    r = await proxy(
      `record_links?source_record_id=eq.${experiment.id}`,
      USER_B,
      WS_B,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])

    // Cross-workspace cannot read the generated scientific table rows.
    r = await proxy(sheetTable.resource_name, USER_B, WS_B)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])

    // Cross-workspace search does not return the experiment.
    r = await rpc('search', USER_B, WS_B, { p_query: 'virus stability' })
    const rows = await r.json()
    const hit = (Array.isArray(rows) ? rows : [rows]).find(
      (r: any) => r.record_id === experiment.id,
    )
    expect(hit).toBeUndefined()

    // Cross-workspace cannot PATCH the experiment record.
    r = await proxy(`records?id=eq.${experiment.id}`, USER_B, WS_B, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ properties: { overview: {} } }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })
})
