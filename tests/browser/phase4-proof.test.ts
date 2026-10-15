/**
 * Sheet-block browser acceptance: the notebook renders its Sheet blocks from
 * the canonical CORE-03 Sheet Instances, and the same-origin DB proxy is
 * fail-closed for an external credential that is not scoped for what it asks
 * to write.
 *
 * The Phase 4 proof this file started as covered the scientific-table REST
 * surface and the scientific workbook behind it. H4 removed that surface
 * (drizzle/0106_core_h4_close_legacy_writes.sql,
 * drizzle/0109_remove_legacy_compatibility.sql): `api.create_scientific_table`
 * carries no EXECUTE for any login role, a `sheet` block names a Sheet Instance
 * (src/lib/sheet-block.ts) and nothing renders a scientific table any more. So
 * the notebook half is built the canonical way, through the ordinary RPCs, and
 * the REST half keeps its subject against the surface that replaced it
 * (src/lib/external-token.ts records the credential scope map).
 *
 * The fixture converges instead of deleting itself - see clean().
 */
import { expect, test } from 'playwright/test'
import { config } from 'dotenv'
import { Client } from 'pg'

import { mintApiClientToken } from '#/lib/api-credentials'
import { parseSheetInstanceState } from '#/lib/sheet-instance'
import { createAdHocTextField } from '#/lib/sheet-local-data'
import { grantFixtureProjectAccess } from '../api/project-fixtures'
import { signInAsDesignUser } from '../visual/sign-in'

config({ path: ['.env.local', '.env'] })

const WS = '65000000-0000-4000-8000-000000000001'
const PROJECT = '65000000-0000-4000-8000-000000000002'
const RECORD = '65000000-0000-4000-8000-000000000003'
const CREDENTIAL = '65000000-0000-4000-8000-000000000006'
const SOURCE_FIELD = '65000000-0000-4000-8000-000000000007'
const SOURCE_ROW = '65000000-0000-4000-8000-000000000008'
const SUMMARY_FIELD = '65000000-0000-4000-8000-000000000009'
const SUMMARY_ROW = '65000000-0000-4000-8000-00000000000a'
const SOURCE_SHEET = 'Raw stability data'
const SUMMARY_SHEET = 'Stability summary'
const USER = 'phase4-browser-owner'

let admin: Client
let externalToken: string
let sourceInstance: string

/**
 * The fixture converges instead of deleting itself, because two rows cannot be
 * removed by anyone: api.change_events is append-only
 * (internal.refuse_change_event_mutation refuses DELETE, and the workspace its
 * entries name cascades into it), and Sheet Instances refuse DELETE for every
 * role by design (internal.guard_sheet_instance: "Sheet Instances cannot be
 * deleted" - archive is the retention path). The workspace, its owner, the API
 * credential, the project and the two Sheet Instances are therefore upserted or
 * reused, and only the Notebook Record this run owns - which nothing pins,
 * because the Instances carry notebook_record_id = NULL - is rebuilt with its
 * blocks.
 */
async function clean() {
  await admin.query('RESET ROLE')
  await admin.query(`DELETE FROM api.records WHERE id=$1`, [RECORD])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

/** The Sheet's own state: one entered reading per Sheet, no computed column. */
function sheetState(
  field: { fieldId: string; label: string },
  rowKey: string,
  value: string,
) {
  return parseSheetInstanceState({
    bindings: [],
    localFields: [
      { ...createAdHocTextField(field.label), fieldId: field.fieldId },
    ],
    localValues: { [rowKey]: { [field.fieldId]: value } },
    calculationOverrides: {},
    presentation: {
      columnOrder: [field.fieldId],
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

/** Sheet Instances cannot be deleted, so a rerun reuses the one it finds. */
async function openSheet(
  name: string,
  field: { fieldId: string; label: string },
  rowKey: string,
  value: string,
): Promise<string> {
  const existing = await admin.query<{ id: string }>(
    `SELECT id FROM api.sheet_instances WHERE workspace_id=$1 AND name=$2`,
    [WS, name],
  )
  if (existing.rows[0]) return existing.rows[0].id
  const created = await admin.query<{ id: string }>(
    `SELECT (api.create_sheet_instance($1,$2,$3,$4,$5,$6,$7::jsonb)).id`,
    [
      WS,
      name,
      null,
      null,
      PROJECT,
      null,
      JSON.stringify(sheetState(field, rowKey, value)),
    ],
  )
  return created.rows[0]!.id
}

/** Embed the Instance in the Notebook the ordinary way (CORE-06.2). */
async function embedSheet(instanceId: string) {
  await admin.query(`SELECT api.insert_sheet_instance_block($1,$2,$3,$4)`, [
    RECORD,
    null,
    null,
    instanceId,
  ])
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Phase 4 browser owner','phase4-browser@test.invalid',true)
     ON CONFLICT (id) DO UPDATE SET name=excluded.name,email=excluded.email,"emailVerified"=excluded."emailVerified"`,
    [USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'phase4-browser','Phase 4 browser')
     ON CONFLICT (id) DO UPDATE SET slug=excluded.slug,name=excluded.name`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')
     ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=excluded.role`,
    [WS, USER],
  )
  await admin.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id) VALUES ($1,$2,'phase4b01','unused','Browser external edit',ARRAY['projects:read','projects:write'],$3)
     ON CONFLICT (id) DO UPDATE SET workspace_id=excluded.workspace_id,display_prefix=excluded.display_prefix,name=excluded.name,scopes=excluded.scopes,created_by_user_id=excluded.created_by_user_id`,
    [CREDENTIAL, WS, USER],
  )
  // SET-02 (ADR-0050): a project is private to its explicit access rows, and
  // every Sheet and block write is checked through internal.can_edit_project.
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ($1,$2,'VSB','Virus Stability Browser',$3)
     ON CONFLICT (id) DO UPDATE SET key=excluded.key,title=excluded.title,lead_user_id=excluded.lead_user_id`,
    [PROJECT, WS, USER],
  )
  await grantFixtureProjectAccess({
    client: admin,
    workspaceId: WS,
    projectId: PROJECT,
    userId: USER,
    canEdit: true,
    canManage: true,
  })
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','VSB-001','Virus Stability at 4C',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await admin.query('SET ROLE authenticated')
  await admin.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  sourceInstance = await openSheet(
    SOURCE_SHEET,
    { fieldId: SOURCE_FIELD, label: 'Input titer' },
    SOURCE_ROW,
    '5',
  )
  const summaryInstance = await openSheet(
    SUMMARY_SHEET,
    { fieldId: SUMMARY_FIELD, label: 'Combined titer' },
    SUMMARY_ROW,
    '15',
  )
  await embedSheet(sourceInstance)
  await embedSheet(summaryInstance)
  await admin.query('RESET ROLE')
  externalToken = await mintApiClientToken(process.env.PGRST_JWT_SECRET!, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['projects:read', 'projects:write'],
  })
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

test.afterAll(async () => {
  await admin.end()
})

test('Sheet blocks render, and the DB proxy is fail-closed for an unscoped external credential', async ({
  page,
  request,
}) => {
  await signInAsDesignUser(page, USER)
  await page.goto(`/records/${RECORD}`)
  await expect(
    page.getByText('Virus Stability at 4C', { exact: true }).first(),
  ).toBeVisible()
  // Both canonical Sheet blocks render their own live grid and their own data.
  await expect(page.getByLabel('Sheet', { exact: true })).toHaveCount(2)
  await expect(
    page.getByRole('gridcell', { name: '5', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('gridcell', { name: '15', exact: true }),
  ).toBeVisible()

  // EXTERNAL_TABLE_ACCESS gives sheet_instances a read scope only, so the
  // credential table path can never write a Sheet.
  const instanceWrite = await request.patch(
    `/api/db/sheet_instances?id=eq.${sourceInstance}`,
    {
      headers: {
        authorization: `Bearer ${externalToken}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      data: { name: 'hijacked' },
    },
  )
  expect(instanceWrite.status()).toBe(403)
  expect(await instanceWrite.json()).toMatchObject({
    error: { category: 'permission_denied' },
  })

  // The Sheet write RPC is scoped `sheets:write`, which this credential - it
  // holds projects:read/projects:write - does not have. The refusal names that
  // scope, so the refusals are scope enforcement and not an unreachable route.
  const rpcWrite = await request.post('/api/db/rpc/create_sheet_instance', {
    headers: {
      authorization: `Bearer ${externalToken}`,
      'content-type': 'application/json',
    },
    data: { p_workspace_id: WS, p_name: 'Not allowed' },
  })
  expect(rpcWrite.status()).toBe(403)
  const refusal = await rpcWrite.json()
  expect(refusal).toMatchObject({ error: { category: 'permission_denied' } })
  expect(refusal.error.message).toContain('sheets:write')
})
