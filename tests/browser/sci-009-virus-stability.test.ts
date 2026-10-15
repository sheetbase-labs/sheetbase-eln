/**
 * SCI-009 browser acceptance: navigate the Virus Stability notebook,
 * overview, and search end-to-end through the UI. The fixture is built
 * through ordinary database RPCs (the same the API test exercises) and
 * the browser proves the rendered notebook, composed overview, and search
 * retrieval all work with real authenticated page loads.
 */
import { config } from 'dotenv'
import { mkdir } from 'node:fs/promises'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { parseSheetInstanceState } from '#/lib/sheet-instance'
import { createAdHocTextField } from '#/lib/sheet-local-data'
import { grantFixtureProjectAccess } from '../api/project-fixtures'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

const WS = '65000000-0000-4000-8000-000000000910'
const PROJECT = '65000000-0000-4000-8000-000000000911'
const RECORD = '65000000-0000-4000-8000-000000000912'
const SAMPLE = '65000000-0000-4000-8000-000000000913'
const REAGENT = '65000000-0000-4000-8000-000000000914'
const PROTOCOL = '65000000-0000-4000-8000-000000000915'
const FILE_REC = '65000000-0000-4000-8000-000000000916'
const FILE_OBJ = '65000000-0000-4000-8000-000000000917'
const USER = 'sci-009-browser-owner'

// CORE-03 Sheet Instance embedded in the notebook. Scientific tables and the
// `api.create_scientific_table` RPC they were built with are removed from the
// product, so the notebook's readings sheet is a canonical instance.
const SHEET_TIME_FIELD = '65000000-0000-4000-8000-0000000009e1'
const SHEET_TITER_FIELD = '65000000-0000-4000-8000-0000000009e2'
const SHEET_CONDITION_FIELD = '65000000-0000-4000-8000-0000000009e3'
const SHEET_ROWS = [
  '65000000-0000-4000-8000-0000000009d5',
  '65000000-0000-4000-8000-0000000009d6',
  '65000000-0000-4000-8000-0000000009d7',
  '65000000-0000-4000-8000-0000000009d8',
] as const
const SHEET_READINGS = [
  ['0', '7.2'],
  ['7', '7.0'],
  ['14', '6.6'],
  ['28', '5.9'],
] as const

const ARTIFACTS = '.amp/in/artifacts'

/** `clean()` deletes the whole fixture world (workspace, project, records,
 * datasets, Sheet Instances) and `beforeAll` rebuilds it, so exactly one
 * invocation of this spec may own it at a time: two invocations share one
 * database whenever a run overlaps another (the suite runs while another run is
 * going, and an agent may verify this file mid-suite), and the second one's
 * `beforeAll` then failed on `project_access_project_id_fkey` because the first
 * had just deleted the project underneath it. The lock is session scoped, so a
 * run that dies releases it with its connection. */
const FIXTURE_LOCK_KEY = 918273648

let admin: Client

/** The notebook Sheet's own state: four qPCR stability readings. */
function sheetState() {
  return parseSheetInstanceState({
    bindings: [],
    localFields: [
      { ...createAdHocTextField('Time (days)'), fieldId: SHEET_TIME_FIELD },
      { ...createAdHocTextField('Log titer'), fieldId: SHEET_TITER_FIELD },
      { ...createAdHocTextField('Condition'), fieldId: SHEET_CONDITION_FIELD },
    ],
    localValues: Object.fromEntries(
      SHEET_ROWS.map((row, index) => [
        row,
        {
          [SHEET_TIME_FIELD]: SHEET_READINGS[index][0],
          [SHEET_TITER_FIELD]: SHEET_READINGS[index][1],
          [SHEET_CONDITION_FIELD]: '4 °C',
        },
      ]),
    ),
    calculationOverrides: {},
    presentation: {
      columnOrder: [
        SHEET_TIME_FIELD,
        SHEET_TITER_FIELD,
        SHEET_CONDITION_FIELD,
      ],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  })
}

/**
 * CORE-02 Dataset behind the notebook chart. A chart spec binds canonical
 * Datasets by stable id and fields by fieldId, so the fixture creates a schema
 * version with the three readings columns and returns their ids.
 */
async function createChartDataset(): Promise<{
  datasetId: string
  fields: Record<'day' | 'log_titer' | 'condition', string>
}> {
  const schema = await admin.query<{ id: string }>(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,'sci009_browser_virus_stability','Virus stability readings','active')
     RETURNING id`,
    [WS],
  )
  const version = await admin.query<{ id: string }>(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schema.rows[0]!.id],
  )
  const svId = version.rows[0]!.id
  await admin.query(
    `INSERT INTO api.dataset_schema_version_fields
       (schema_version_id,field_id,key,label,logical_type,display_order)
     VALUES
       ($1,gen_random_uuid(),'day','Time (days)','decimal',1),
       ($1,gen_random_uuid(),'log_titer','Log titer','decimal',2),
       ($1,gen_random_uuid(),'condition','Condition','text',3)`,
    [svId],
  )
  await admin.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [svId],
  )
  const dataset = await admin.query<{ id: string }>(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
     VALUES ($1,$2,'Virus stability qPCR readings',$3) RETURNING id`,
    [WS, svId, USER],
  )
  const datasetId = dataset.rows[0]!.id
  const fieldRows = await admin.query<{ field_id: string; key: string }>(
    `SELECT field_id, key FROM api.dataset_schema_version_fields
      WHERE schema_version_id=$1`,
    [svId],
  )
  const fields = Object.fromEntries(
    fieldRows.rows.map((row) => [row.key, row.field_id]),
  ) as Record<'day' | 'log_titer' | 'condition', string>
  for (const [day, logTiter] of SHEET_READINGS) {
    const row = await admin.query<{ id: string }>(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, WS],
    )
    await admin.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       VALUES ($1,$2,$3),($1,$4,$5)`,
      [row.rows[0]!.id, fields.day, day, fields.log_titer, logTiter],
    )
    await admin.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,text_value)
       VALUES ($1,$2,$3)`,
      [row.rows[0]!.id, fields.condition, '4 °C'],
    )
  }
  return { datasetId, fields }
}

async function clean() {
  await admin.query('RESET ROLE')
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN (SELECT id FROM api.records WHERE workspace_id=$1) OR target_record_id IN (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS],
  )
  // Raw file objects are retention-protected by a trigger that refuses every
  // delete, so the fixture removes its own disposable rows with triggers off,
  // as the import fixture does. Without this a second run cannot clean up.
  await admin.query('SET session_replication_role = replica')
  await admin.query(`DELETE FROM api.file_objects WHERE workspace_id=$1`, [WS])
  await admin.query('RESET session_replication_role')
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS],
  )
  // Revision evidence is frozen for every role except the migration owner,
  // which is the sanctioned fixture-cleanup path.
  await admin.query('SET ROLE migrator')
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS],
  )
  await admin.query('RESET ROLE')
  // Sheet Instances and Dataset versions are immutable canonical resources;
  // they are removed only in fixture teardown, with the same guards the API
  // fixture disables, inside one transaction so an error cannot leave a guard
  // disabled.
  await admin.query('BEGIN')
  try {
    const guarded = [
      'sheet_instances',
      'dataset_version_flags',
      'dataset_version_values',
      'dataset_version_rows',
      'dataset_versions',
      'dataset_schema_version_fields',
      'dataset_schema_versions',
    ]
    for (const table of guarded)
      await admin.query(`ALTER TABLE api.${table} DISABLE TRIGGER USER`)
    await admin.query(`DELETE FROM api.sheet_instances WHERE workspace_id=$1`, [
      WS,
    ])
    await admin.query(
      `DELETE FROM api.dataset_version_flags WHERE dataset_version_id IN (SELECT id FROM api.dataset_versions WHERE workspace_id=$1)`,
      [WS],
    )
    await admin.query(
      `DELETE FROM api.dataset_version_values WHERE dataset_version_id IN (SELECT id FROM api.dataset_versions WHERE workspace_id=$1)`,
      [WS],
    )
    await admin.query(
      `DELETE FROM api.dataset_version_rows WHERE dataset_version_id IN (SELECT id FROM api.dataset_versions WHERE workspace_id=$1)`,
      [WS],
    )
    await admin.query(`DELETE FROM api.dataset_versions WHERE workspace_id=$1`, [
      WS,
    ])
    // Datasets reference their schema version (RESTRICT), so they go first.
    await admin.query(`DELETE FROM api.datasets WHERE workspace_id=$1`, [WS])
    await admin.query(
      `DELETE FROM api.dataset_schema_version_fields WHERE schema_version_id IN
         (SELECT sv.id FROM api.dataset_schema_versions sv
            JOIN api.dataset_schema_definitions d ON d.id = sv.schema_id
           WHERE d.workspace_id = $1)`,
      [WS],
    )
    await admin.query(
      `DELETE FROM api.dataset_schema_versions WHERE schema_id IN
         (SELECT id FROM api.dataset_schema_definitions WHERE workspace_id = $1)`,
      [WS],
    )
    for (const table of guarded)
      await admin.query(`ALTER TABLE api.${table} ENABLE TRIGGER USER`)
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
  await admin.query(
    `DELETE FROM api.dataset_schema_definitions WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id=$1`, [WS])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id=$1`, [WS])
  await admin.query(
    `DELETE FROM api.workspace_change_seq WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id=$1`,
    [WS],
  )
  // The audit chain is append-only and a workspace delete cascades its
  // entries, so the guard is disabled for that delete alone and re-enabled
  // inside the same transaction, the way the audit fixtures do.
  await admin.query('BEGIN')
  try {
    await admin.query(
      'ALTER TABLE api.change_events DISABLE TRIGGER refuse_change_event_mutation',
    )
    await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
    await admin.query(
      'ALTER TABLE api.change_events ENABLE TRIGGER refuse_change_event_mutation',
    )
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  }
  await admin.query(`DELETE FROM internal.session WHERE "userId"=$1`, [USER])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [USER])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

async function insertBlock(
  id: string,
  type: string,
  payload: unknown,
  order: number,
) {
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, RECORD, type, JSON.stringify(payload), order, USER],
  )
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  // Own the fixture before touching it; see FIXTURE_LOCK_KEY.
  await admin.query('select pg_advisory_lock($1)', [FIXTURE_LOCK_KEY])
  await clean()
  await mkdir(ARTIFACTS, { recursive: true })

  // Identity + workspace + project
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'SCI 009 Browser Owner','sci-009-browser@test.invalid',true)`,
    [USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'sci-009-browser','SCI 009 Browser')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'vsb','Lentivector Stability Study')`,
    [PROJECT, WS],
  )
  // Project rules are explicit grants, never inferred from the workspace role
  // (see tests/api/project-fixtures.ts); the notebook writes are refused
  // without one.
  await grantFixtureProjectAccess({
    client: admin,
    workspaceId: WS,
    projectId: PROJECT,
    userId: USER,
    canEdit: true,
    canReview: true,
    canManage: true,
  })

  // Linked registry records
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'sample','SMP-2025-0001','LVV-CAR-T drug substance','available',$4)`,
    [SAMPLE, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'material','RGT-2025-0001','TaqMan qPCR kit','available',$4)`,
    [REAGENT, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,properties,created_by_user_id) VALUES ($1,$2,$3,'protocol_template','PRT-2025-0001','Titration Assay','active','{"version":"1.2"}'::jsonb,$4)`,
    [PROTOCOL, WS, PROJECT, USER],
  )
  // Protocol procedure-step definitions (as superuser, bypassing the
  // authenticated-only execution-step check).
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'procedure_step',$3,1,$4),($5,$2,'procedure_step',$6,2,$4)`,
    [
      '65000000-0000-4000-8000-0000000009d1',
      PROTOCOL,
      JSON.stringify({
        text: 'Prepare a serial dilution of the sample.',
        stepNumber: 1,
      }),
      USER,
      '65000000-0000-4000-8000-0000000009d2',
      JSON.stringify({
        text: 'Measure the assay response and fit the titration curve.',
        stepNumber: 2,
      }),
    ],
  )

  // File record + file object (metadata only; block renders display name)
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'file','FILE-2025-0001','Stability run 07 — titer curve','active',$4)`,
    [FILE_REC, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,status,storage_backend,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'active','local',$8)`,
    [
      FILE_OBJ,
      WS,
      FILE_REC,
      `${WS}/${FILE_REC}/a1b2c3d4e5f60718293a4b5c6d7e8f90`,
      'stability-run07-4c.csv',
      'text/csv',
      60,
      USER,
    ],
  )

  // Experiment record
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,tags,created_by_user_id) VALUES ($1,$2,$3,'experiment','EXP-2025-0001','Virus Stability at 4°C','in_progress',ARRAY['stability','qPCR'],$4)`,
    [RECORD, WS, PROJECT, USER],
  )

  // The notebook's readings sheet: a canonical CORE-03 Sheet Instance created
  // through the ordinary RPC (SET ROLE authenticated + jwt claims), the same
  // path the app uses. Its block is embedded after the other blocks so it takes
  // the next free order.
  await admin.query('SET ROLE authenticated')
  await admin.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  const sheetInstance = (
    await admin.query<{ id: string }>(
      `SELECT (api.create_sheet_instance($1,$2,$3,$4,$5,$6,$7::jsonb)).id`,
      [
        WS,
        'Stability readings (qPCR)',
        null,
        null,
        PROJECT,
        null,
        JSON.stringify(sheetState()),
      ],
    )
  ).rows[0]!.id
  await admin.query('RESET ROLE')

  // The chart reads a canonical Dataset, not a scientific table.
  const chart = await createChartDataset()

  // Insert all block types via direct SQL (fixture setup, not the tested path)
  const chartSpec = {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId: chart.datasetId }],
    fields: {
      x: { fieldId: chart.fields.day },
      y: { fieldId: chart.fields.log_titer },
      series: { fieldId: chart.fields.condition },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
        y: { label: 'Log titer', scale: 'linear', unit: 'log₁₀' },
      },
      series: [{ identifier: '4 °C', label: '4 °C', color: '#006EDC' }],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }

  await insertBlock(
    '65000000-0000-4000-8000-000000000920',
    'rich_text',
    {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Objective' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Evaluate LVV-CAR-T vector stability at 4 °C across a 28-day window.',
              },
            ],
          },
        ],
      },
    },
    1,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000921',
    'materials',
    {
      items: [
        {
          id: 'mat-s',
          materialRecordId: SAMPLE,
          kind: 'sample',
          identifier: 'SMP-2025-0001',
          title: 'LVV-CAR-T drug substance',
          quantity: 100,
          unit: { code: 'uL', symbol: 'µL', quantityKind: 'volume' },
          observedAt: '2026-07-21T12:00:00.000Z',
        },
      ],
    },
    2,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000922',
    'table',
    {
      columns: ['Timepoint', 'Replicate', 'Volume', 'Storage'],
      rows: [
        ['Day 0', 1, '100 µL', '4 °C'],
        ['Day 28', 1, '100 µL', '4 °C'],
      ],
    },
    3,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000923',
    'checklist',
    {
      items: [
        { text: 'Data integrity verified', checked: true },
        { text: 'Instrument calibration confirmed', checked: false },
      ],
    },
    4,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000924',
    'callout',
    {
      text: 'Include a no-template control (NTC) in every qPCR run.',
      variant: 'warning',
    },
    5,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000925',
    'metric',
    {
      label: 'Titer at day 0',
      value: 2.31e7,
      unit: 'copies/mL',
      provenance: 'qPCR',
    },
    6,
  )
  await insertBlock(
    '65000000-0000-4000-8000-000000000926',
    'protocol_reference',
    {},
    7,
  )
  // procedure_step blocks on the experiment are created by pin_protocol_reference
  // (the ordinary RPC), which snapshots the protocol revision and copies steps.
  // The readings Sheet block was already inserted above at order 10.
  await insertBlock(
    '65000000-0000-4000-8000-000000000929',
    'chart',
    {
      title: 'Vector genome copy number (qPCR)',
      spec: chartSpec,
      provenance: 'Virus Stability qPCR',
      frozen: null,
    },
    11,
  )
  await insertBlock(
    '65000000-0000-4000-8000-00000000092a',
    'plate_map',
    {
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
              recordId: SAMPLE,
              identifier: 'SMP-2025-0001',
              title: 'LVV-CAR-T drug substance',
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
    },
    12,
  )
  await insertBlock(
    '65000000-0000-4000-8000-00000000092b',
    'file',
    {
      fileRecordId: FILE_REC,
      fileIdentifier: 'FILE-2025-0001',
      displayName: 'stability-run07-4c.csv',
      mediaType: 'text/csv',
      byteSize: 60,
    },
    13,
  )
  await insertBlock(
    '65000000-0000-4000-8000-00000000092c',
    'linked_record',
    {
      targetKind: 'sample',
      targetIdentifier: 'SMP-2025-0001',
      label: 'LVV-CAR-T drug substance',
      linkType: 'sample',
    },
    14,
  )

  // Pin the protocol reference via the ordinary authenticated RPC so the
  // experiment gets valid procedure-step copies with revision provenance.
  // Direct SQL inserts don't bump structure_version, so it is still 1.
  await admin.query('SET ROLE authenticated')
  await admin.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  const protoRefId = '65000000-0000-4000-8000-000000000926'
  const verCheck = await admin.query<{ bv: number; sv: number }>(
    `SELECT b.version::int AS bv, r.structure_version::int AS sv FROM api.blocks b JOIN api.records r ON r.id=b.record_id WHERE b.id=$1`,
    [protoRefId],
  )
  await admin.query(`SELECT api.pin_protocol_reference($1,$2,$3,$4)`, [
    protoRefId,
    PROTOCOL,
    verCheck.rows[0].bv,
    verCheck.rows[0].sv,
  ])
  // Embed the readings Sheet; the block takes the next free order.
  await admin.query(`SELECT api.insert_sheet_instance_block($1,$2,$3,$4)`, [
    RECORD,
    null,
    null,
    sheetInstance,
  ])
  await admin.query('RESET ROLE')

  // record_links
  for (const [targetId, kind, ident, linkType] of [
    [SAMPLE, 'sample', 'SMP-2025-0001', 'sample'],
    [REAGENT, 'material', 'RGT-2025-0001', 'material'],
    [PROTOCOL, 'protocol_template', 'PRT-2025-0001', 'protocol'],
    [FILE_REC, 'file', 'FILE-2025-0001', 'file'],
  ] as const) {
    await admin.query(
      `INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [RECORD, targetId, kind, ident, linkType, USER],
    )
  }

  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

test.afterAll(async () => {
  await clean()
  await admin
    .query('select pg_advisory_unlock($1)', [FIXTURE_LOCK_KEY])
    .catch(() => {})
  await admin.end()
})

async function injectAuth(page: Page) {
  await signInAsDesignUser(page, USER)
}

test.describe('SCI-009 Virus Stability browser acceptance', () => {
  test('notebook renders every block type', async ({ page }) => {
    await injectAuth(page)
    await page.goto(`/records/${RECORD}`)
    await expect(
      page.getByText('Virus Stability at 4°C', { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // rich_text — objective heading + paragraph
    await expect(page.getByText('Objective').first()).toBeVisible()
    await expect(
      page.getByText(/Evaluate LVV-CAR-T vector stability/).first(),
    ).toBeVisible()

    // materials — sample identifier
    await expect(page.getByText('SMP-2025-0001').first()).toBeVisible()

    // checklist — item text
    await expect(
      page.getByText('Data integrity verified').first(),
    ).toBeVisible()

    // callout — validated text/variant payload
    await expect(
      page
        .getByText('Include a no-template control (NTC) in every qPCR run.')
        .first(),
    ).toBeVisible()

    // metric — label
    await expect(page.getByText('Titer at day 0').first()).toBeVisible()

    // protocol_reference — title + version
    await expect(page.getByText('Titration Assay').first()).toBeVisible()

    // procedure_step — step text
    await expect(
      page.getByText('Prepare a serial dilution of the sample.').first(),
    ).toBeVisible()

    // file — display name
    await expect(page.getByText('stability-run07-4c.csv').first()).toBeVisible()

    // chart — title
    await expect(
      page.getByText('Vector genome copy number (qPCR)').first(),
    ).toBeVisible()

    // plate_map — title
    await expect(page.getByText('qPCR titration plate').first()).toBeVisible()

    // linked_record — target identifier
    await expect(
      page.getByText('LVV-CAR-T drug substance').first(),
    ).toBeVisible()

    // Wait for the scientific sheet to finish loading so the screenshot
    // captures actual data rather than the loading placeholder.
    await expect(
      page.getByText('Stability readings (qPCR)').first(),
    ).toBeVisible({ timeout: 10_000 })

    await page.screenshot({
      path: `${ARTIFACTS}/sci-009-notebook.png`,
      fullPage: true,
    })
  })

  test('overview composes from the notebook blocks', async ({ page }) => {
    await injectAuth(page)
    await page.goto(`/experiments/${RECORD}/overview`)
    await expect(
      page.getByText('Virus Stability at 4°C', { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // The shipped experiment overview is the canvas composition
    // (docs/knowledge/design/ui-system-v3/screen-text/ExpOverview.txt): the
    // Objective, Protocol progress, Open before submission and Key results
    // sections, then the Properties / Linked experiments / Signatures
    // inspector. The sectioned SCI-007 composition (`composeSections`, whose
    // labels were Notes / Materials / Procedures / Tables & data / …) has no
    // product caller and no canvas, so the labels - and the Visualizations
    // section that carried the chart and plate-map titles - are gone.
    for (const heading of [
      'Objective',
      'Protocol progress',
      'Open before submission',
      'Key results',
      'Properties',
      'Linked experiments',
      'Signatures',
    ]) {
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
      ).toBeVisible({ timeout: 15_000 })
    }

    // Objective composes from the notebook's rich_text prose block.
    await expect(
      page.getByText(
        'Evaluate LVV-CAR-T vector stability at 4 °C across a 28-day window.',
      ),
    ).toBeVisible()

    // Protocol progress composes from the notebook's procedure_step blocks, in
    // step order.
    await expect(
      page.getByText('Prepare a serial dilution of the sample.').first(),
    ).toBeVisible()
    await expect(
      page.getByText('Measure the assay response and fit the titration curve.')
        .first(),
    ).toBeVisible()

    // The steps came from the protocol pinned into the notebook.
    await expect(page.getByText('PRT-2025-0001').first()).toBeVisible()

    await page.screenshot({
      path: `${ARTIFACTS}/sci-009-overview.png`,
      fullPage: true,
    })
  })

  test('search retrieves the experiment and linked objects', async ({
    page,
  }) => {
    await injectAuth(page)
    await page.goto('/search')
    // An empty query is a prompt, not a browse listing: the design's Search
    // page renders its `EmptyState` and no results for `!q`
    // (sheetbase-app-ui-only/src/routes/_app/search.tsx:105-112), and the app
    // does the same (`enabled: q.trim().length > 0`, src/routes/search.tsx), so
    // there is nothing to browse until a term is given.
    await expect(
      page.getByText('Search names, IDs, cell values, comments and files'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Virus Stability at 4°C')).toHaveCount(0)

    // Search for the experiment by title. The form submits the query into the
    // URL - the page reads `q` from the URL rather than the input - so Enter is
    // what runs the search. The Filters pane and the below-lg header row render
    // the same form, and only the pane's is on screen at this width.
    const searchInput = page
      .getByRole('complementary', { name: 'Filters' })
      .getByRole('searchbox', { name: 'Search Sheetbase' })
    await searchInput.click()
    // Typed, not `fill()`ed: `fill()` set the input's value without the page's
    // React state seeing it, so Enter submitted an empty term (the URL came out
    // `/search`).
    await searchInput.pressSequentially('virus stability')
    await searchInput.press('Enter')
    await expect(page.getByText('Virus Stability at 4°C').first()).toBeVisible({
      timeout: 15_000,
    })

    // Search for the linked sample.
    await searchInput.fill('')
    await searchInput.pressSequentially('LVV-CAR-T drug substance')
    await searchInput.press('Enter')
    await expect(
      page.getByText('LVV-CAR-T drug substance').first(),
    ).toBeVisible({ timeout: 15_000 })

    await page.screenshot({
      path: `${ARTIFACTS}/sci-009-search.png`,
      fullPage: true,
    })
  })
})
