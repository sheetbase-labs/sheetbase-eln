import { createHmac } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import { createAdHocTextField } from '#/lib/sheet-local-data'
import { rowIdentityKey } from '#/lib/row-identity'
import { parseSheetDefinitionConfiguration } from '#/lib/sheet-definition'
import { parseSheetInstanceState } from '#/lib/sheet-instance'
import type { SheetInstanceState } from '#/lib/sheet-instance'

import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

const WORKSPACE = '56000000-0000-4000-8000-000000000001'
const OTHER_WORKSPACE = '56000000-0000-4000-8000-000000000002'
const OWNER = 'sheet-comment-owner'
const MEMBER = 'sheet-comment-member'
const VIEWER = 'sheet-comment-viewer'
const OUTSIDER = 'sheet-comment-outsider'
const VERIFIER = 'sheet-comment-verifier'
const REVIEWER = 'sheet-comment-reviewer'
const PASSWORD = 'sheet-comment-native-test-password'
const FIELD_A = '56000000-0000-4000-8000-000000000010'
const FIELD_B = '56000000-0000-4000-8000-000000000011'
const ROW_A = '56000000-0000-4000-8000-000000000020'
const ROW_B = '56000000-0000-4000-8000-000000000021'
const ROW_C = '56000000-0000-4000-8000-000000000022'
const ROW_D = '56000000-0000-4000-8000-000000000023'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>

function authHeaders() {
  const token = `sheet-comment-${OWNER}`
  const signature = createHmac(
    'sha256',
    z.string().min(32).parse(process.env.BETTER_AUTH_SECRET),
  )
    .update(token)
    .digest('base64')
  return new Headers({
    origin: 'https://sheetbase.test',
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function signingToken(input: object) {
  const response = await handleSignatureStepUp(
    new Request('https://sheetbase.test/api/signatures/step-up', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        workspaceId: WORKSPACE,
        password: PASSWORD,
        ...input,
      }),
    }),
    { database, authentication },
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return z.object({ token: z.string().min(32) }).parse(await response.json())
    .token
}

interface Instance {
  id: string
  revision: string
  state: SheetInstanceState
}

function initialState(): SheetInstanceState {
  return parseSheetInstanceState({
    bindings: [],
    localFields: [
      { ...createAdHocTextField('Recovery'), fieldId: FIELD_A },
      { ...createAdHocTextField('Group'), fieldId: FIELD_B },
    ],
    localValues: {
      [ROW_A]: { [FIELD_A]: '37', [FIELD_B]: 'keep' },
      [ROW_B]: { [FIELD_A]: '4', [FIELD_B]: 'hide' },
      [ROW_C]: { [FIELD_A]: '91', [FIELD_B]: 'keep' },
    },
    calculationOverrides: {},
    presentation: {
      columnOrder: [FIELD_A, FIELD_B],
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

async function actor(userId = OWNER, workspaceId = WORKSPACE) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, userId, workspaceId, {
    session_id: `sheet-comment-${userId}`,
  })
  return client
}

async function instance(
  client: Client,
  workspace = WORKSPACE,
): Promise<Instance> {
  const { rows } = await client.query<{ result: Instance }>(
    `SELECT to_jsonb(api.create_sheet_instance($1,'Commentable standalone Sheet',NULL,NULL,NULL,NULL,$2::jsonb)) result`,
    [workspace, JSON.stringify(initialState())],
  )
  return rows[0].result
}

function cellTarget(instanceId: string) {
  return { instanceId, rowKeys: [ROW_B], fieldIds: [FIELD_A] }
}

async function create(
  client: Client,
  sheet: Instance,
  options: {
    kind?: string
    target?: Record<string, unknown>
    revision?: string
    mentions?: string[]
    body?: string
  } = {},
) {
  return (
    await client.query<{
      result: {
        id: string
        rootId: string
        sheetInstanceId: string
        revisionId: null
        target: Record<string, unknown>
      }
    }>(
      `SELECT api.create_sheet_comment($1,$2,$3,$4::jsonb,$6,$5::text[]) result`,
      [
        sheet.id,
        options.revision ?? sheet.revision,
        options.kind ?? 'sheet_cell',
        JSON.stringify(options.target ?? cellTarget(sheet.id)),
        options.mentions ?? [],
        options.body ?? 'Asymmetric recovery needs explanation',
      ],
    )
  ).rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
    ($1,'Owner','owner@sheet-comment.test',true),($2,'Member','member@sheet-comment.test',true),
    ($3,'Viewer','viewer@sheet-comment.test',true),($4,'Outsider','outsider@sheet-comment.test',true)`,
    [OWNER, MEMBER, VIEWER, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
    ($1,'sheet-comment-a','Sheet comments A'),($2,'sheet-comment-b','Sheet comments B')`,
    [WORKSPACE, OTHER_WORKSPACE],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
    ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer'),($5,$6,'owner')`,
    [WORKSPACE, OWNER, MEMBER, VIEWER, OTHER_WORKSPACE, OUTSIDER],
  )
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,$1,'verifier@sheet-comment.test',true),($2,$2,'reviewer@sheet-comment.test',true)`,
    [VERIFIER, REVIEWER],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'reviewer')`,
    [WORKSPACE, VERIFIER, REVIEWER],
  )
  for (const userId of [OWNER, VERIFIER, REVIEWER]) {
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$1,$2,now()+interval '1 hour')`,
      [`sheet-comment-${userId}`, userId],
    )
  }
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  await authentication.api.setPassword({
    headers: authHeaders(),
    body: { newPassword: PASSWORD },
  })
  const owner = await actor()
  await owner.query('SELECT api.request_signature_identity_verification()')
  const verifier = await actor(VERIFIER)
  await verifier.query('SELECT api.verify_signature_identity($1,$2)', [
    OWNER,
    'owner@sheet-comment.test',
  ])
  await owner.query('SELECT api.certify_signature($1,1,$2)', [
    WORKSPACE,
    await signingToken({ purpose: 'certify' }),
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
  await database?.$client.end()
})

describe('SHEET-03 live comments use the existing PostgreSQL authority', () => {
  it('creates an Instance-owned root without a manufactured Record or revision and denies direct writes', async () => {
    const owner = await actor()
    const sheet = await instance(owner)
    const root = await create(owner, sheet)
    expect(root).toMatchObject({
      rootId: root.id,
      sheetInstanceId: sheet.id,
      revisionId: null,
      target: cellTarget(sheet.id),
    })
    const stored = await owner.query(
      `SELECT workspace_id,record_id,revision_id,sheet_instance_id,root_id,parent_id,target_kind,target FROM api.comments WHERE id=$1`,
      [root.id],
    )
    expect(stored.rows).toEqual([
      {
        workspace_id: WORKSPACE,
        record_id: null,
        revision_id: null,
        sheet_instance_id: sheet.id,
        root_id: root.id,
        parent_id: null,
        target_kind: 'sheet_cell',
        target: cellTarget(sheet.id),
      },
    ])
    await expect(
      owner.query(`UPDATE api.comments SET body='bypass' WHERE id=$1`, [
        root.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      migrator!.query(`UPDATE api.comments SET target=$2::jsonb WHERE id=$1`, [
        root.id,
        JSON.stringify({ ...cellTarget(sheet.id), rowKeys: [ROW_A] }),
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('retains exact identities after asymmetric sorting, filtering, row insertion and field label evolution', async () => {
    const owner = await actor()
    const sheet = await instance(owner)
    const root = await create(owner, sheet)
    const presentation = {
      ...sheet.state.presentation,
      columnOrder: [FIELD_B, FIELD_A],
      sorts: [{ columnId: FIELD_A, direction: 'desc' }],
      filters: [{ columnId: FIELD_B, operator: 'equals', value: 'keep' }],
    }
    const updated = (
      await owner.query<{ result: Instance }>(
        `SELECT to_jsonb(api.update_sheet_instance($1,$2,$3::jsonb)) result`,
        [
          sheet.id,
          sheet.revision,
          JSON.stringify({ ...sheet.state, presentation }),
        ],
      )
    ).rows[0].result
    const renamed = { ...sheet.state.localFields[0], label: 'Recovery renamed' }
    const evolved = (
      await owner.query<{ result: Instance }>(
        `SELECT to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)) result`,
        [
          sheet.id,
          updated.revision,
          crypto.randomUUID(),
          JSON.stringify([{ operation: 'edit', field: renamed }]),
          JSON.stringify([{ kind: 'local', rowKey: ROW_D }]),
          JSON.stringify([
            { rowKey: ROW_D, fieldId: FIELD_A, value: '13' },
            { rowKey: ROW_D, fieldId: FIELD_B, value: 'keep' },
          ]),
        ],
      )
    ).rows[0].result
    expect(evolved.state.localValues[ROW_D][FIELD_A]).toBe('13')
    expect(evolved.state.localValues[ROW_B][FIELD_A]).toBe('4')
    expect(
      (
        await owner.query(`SELECT target FROM api.comments WHERE id=$1`, [
          root.id,
        ])
      ).rows,
    ).toEqual([{ target: cellTarget(sheet.id) }])
    // The hidden B row is still a historical target, not the inserted D row.
    expect((await create(owner, evolved)).target).toEqual(cellTarget(sheet.id))
  })

  it('propagates the immutable live anchor and valid mentions through replies, resolution, reopening and events', async () => {
    const owner = await actor()
    const member = await actor(MEMBER)
    const sheet = await instance(owner)
    const root = await create(owner, sheet, {
      mentions: [MEMBER, MEMBER, OUTSIDER],
    })
    const reply = (
      await member.query(
        `SELECT api.reply_to_comment($1,'Recovery verified',ARRAY[$2]) result`,
        [root.id, OWNER],
      )
    ).rows[0].result
    expect(reply).toMatchObject({
      rootId: root.id,
      parentId: root.id,
      sheetInstanceId: sheet.id,
      revisionId: null,
      target: cellTarget(sheet.id),
    })
    expect(
      (
        await owner.query(`SELECT mentions FROM api.comments WHERE id=$1`, [
          root.id,
        ])
      ).rows[0].mentions,
    ).toEqual([MEMBER])
    await member.query(`SELECT api.resolve_comment_thread($1)`, [reply.id])
    expect(
      (
        await owner.query(`SELECT state FROM api.comments WHERE id=$1`, [
          root.id,
        ])
      ).rows[0].state,
    ).toBe('resolved')
    await owner.query(`SELECT api.reopen_comment_thread($1)`, [root.id])
    expect(
      (
        await owner.query(
          `SELECT state,target,sheet_instance_id FROM api.comments WHERE id=$1`,
          [root.id],
        )
      ).rows[0],
    ).toMatchObject({
      state: 'open',
      target: cellTarget(sheet.id),
      sheet_instance_id: sheet.id,
    })
    const events = await owner.query(
      `SELECT operation,record_id,project_id,payload FROM api.change_events WHERE entity_type='comment' AND entity_uuid=ANY($1::uuid[]) ORDER BY sequence`,
      [[root.id, reply.id]],
    )
    expect(events.rows.map((row) => row.operation)).toEqual([
      'create',
      'create',
      'resolve',
      'reopen',
    ])
    for (const event of events.rows) {
      expect(event).toMatchObject({
        record_id: null,
        project_id: null,
        payload: { sheetInstanceId: sheet.id, revisionId: null },
      })
    }
  })

  it('denies viewer/other-workspace mutation and filters cross-workspace reads without leaking the anchor', async () => {
    const owner = await actor()
    const viewer = await actor(VIEWER)
    const outsider = await actor(OUTSIDER, OTHER_WORKSPACE)
    const sheet = await instance(owner)
    const root = await create(owner, sheet)
    await expect(create(viewer, sheet)).rejects.toMatchObject({ code: '42501' })
    await expect(create(outsider, sheet)).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      viewer.query(`SELECT api.reply_to_comment($1,'Viewer write','{}')`, [
        root.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      outsider.query(`SELECT api.resolve_comment_thread($1)`, [root.id]),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      (
        await outsider.query(`SELECT id,target FROM api.comments WHERE id=$1`, [
          root.id,
        ])
      ).rows,
    ).toEqual([])
  })

  it('refuses stale revisions, coordinates, unknown identities and forged ownership context', async () => {
    const owner = await actor()
    const sheet = await instance(owner)
    await expect(create(owner, sheet, { revision: '0' })).rejects.toMatchObject(
      { code: 'SB073' },
    )
    for (const target of [
      { ...cellTarget(sheet.id), rowKeys: ['A2'] },
      { ...cellTarget(sheet.id), rowKeys: [null] },
      { ...cellTarget(sheet.id), fieldIds: [null] },
      { ...cellTarget(sheet.id), row: 1, column: 0 },
      { ...cellTarget(sheet.id), rowKeys: [ROW_D] },
      { ...cellTarget(sheet.id), fieldIds: [crypto.randomUUID()] },
      { ...cellTarget(sheet.id), instanceId: crypto.randomUUID() },
      {
        ...cellTarget(sheet.id),
        workspaceId: OTHER_WORKSPACE,
        recordId: crypto.randomUUID(),
      },
    ])
      await expect(create(owner, sheet, { target })).rejects.toBeDefined()
    expect(
      (
        await owner.query(
          `SELECT id FROM api.comments WHERE sheet_instance_id=$1`,
          [sheet.id],
        )
      ).rows,
    ).toEqual([])
  })

  it('searches standalone comments without inventing a Record context or leaking another workspace', async () => {
    const owner = await actor()
    const outsider = await actor(OUTSIDER, OTHER_WORKSPACE)
    const sheet = await instance(owner)
    const body = 'Spectrophotometry recovery needs explanation'
    const root = await create(owner, sheet, { body })
    const hits = (
      await owner.query(
        `SELECT * FROM api.search_comments('spectrophotometry',20)`,
      )
    ).rows
    expect(hits).toEqual([
      expect.objectContaining({
        comment_id: root.id,
        record_id: null,
        anchor: cellTarget(sheet.id),
        body,
      }),
    ])
    expect(
      (
        await outsider.query(
          `SELECT * FROM api.search_comments('spectrophotometry',20)`,
        )
      ).rows,
    ).toEqual([])
  })

  it('includes distinct live threads and replies in canonical search with owner links and honest counts', async () => {
    const owner = await actor()
    const outsider = await actor(OUTSIDER, OTHER_WORKSPACE)
    const sheet = await instance(owner)
    const root = await create(owner, sheet, {
      body: 'Jaspercanonicalsearch recovery-four discussion',
    })
    const reply = (
      await owner.query('SELECT api.reply_to_comment($1,$2) result', [
        root.id,
        'Jaspercanonicalsearch independent replication',
      ])
    ).rows[0].result
    const destinations = new Map([
      [root.id, `/sheets/${sheet.id}?commentId=${root.id}`],
      [reply.id, `/sheets/${sheet.id}?commentId=${reply.id}`],
    ])
    const pages = []
    for (const offset of [0, 1]) {
      const hits = (
        await owner.query(
          `SELECT * FROM api.search(p_query=>'jaspercanonicalsearch',p_result_type=>'comment',p_limit=>1,p_offset=>$1)`,
          [offset],
        )
      ).rows
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({
        result_type: 'comment',
        kind: 'comment',
        matched_field: 'comment_body',
        archived: false,
        project_id: null,
        total_count: '2',
      })
      expect(destinations.has(hits[0].record_id)).toBe(true)
      expect(hits[0].deep_link).toBe(destinations.get(hits[0].record_id))
      pages.push(hits[0].record_id)
    }
    expect(pages.sort()).toEqual([root.id, reply.id].sort())
    expect(
      (
        await owner.query(
          `SELECT record_id FROM api.search(p_query=>'jaspercanonicalsearch')`,
        )
      ).rows
        .map((hit) => hit.record_id)
        .sort(),
    ).toEqual([root.id, reply.id].sort())
    expect(
      (
        await outsider.query(
          `SELECT * FROM api.search(p_query=>'jaspercanonicalsearch',p_result_type=>'comment')`,
        )
      ).rows,
    ).toEqual([])
    await owner.query('SELECT api.archive_sheet_instance($1,$2)', [
      sheet.id,
      sheet.revision,
    ])
    const archived = (
      await owner.query(
        `SELECT record_id,archived,total_count FROM api.search(p_query=>'jaspercanonicalsearch',p_result_type=>'comment')`,
      )
    ).rows
    expect(archived).toHaveLength(2)
    expect(
      archived.every((hit) => hit.archived && hit.total_count === '2'),
    ).toBe(true)
  })

  it('creates row/range anchors and lists shared live threads in the actual embedding Record', async () => {
    const owner = await actor()
    const outsider = await actor(OUTSIDER, OTHER_WORKSPACE)
    const sheet = await instance(owner)
    const rowTarget = { instanceId: sheet.id, rowKeys: [ROW_C], fieldIds: [] }
    const rangeTarget = {
      instanceId: sheet.id,
      rowKeys: [ROW_A, ROW_C],
      fieldIds: [FIELD_B, FIELD_A],
    }
    const row = await create(owner, sheet, {
      kind: 'sheet_row',
      target: rowTarget,
    })
    const range = await create(owner, sheet, {
      kind: 'sheet_range',
      target: rangeTarget,
    })
    const recordId = crypto.randomUUID()
    await migrator!.query(
      `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment',$3,'Embedding record','draft',$4)`,
      [recordId, WORKSPACE, `EXP-${recordId}`, OWNER],
    )
    await owner.query(
      'SELECT api.insert_sheet_instance_block($1,NULL,NULL,$2)',
      [recordId, sheet.id],
    )
    expect(
      (
        await owner.query('SELECT id,target FROM api.record_comments($1)', [
          recordId,
        ])
      ).rows,
    ).toEqual([
      { id: row.id, target: rowTarget },
      { id: range.id, target: rangeTarget },
    ])
    expect(
      (
        await outsider.query('SELECT id,target FROM api.record_comments($1)', [
          recordId,
        ])
      ).rows,
    ).toEqual([])
    await owner.query('SELECT api.archive_sheet_instance($1,$2)', [
      sheet.id,
      sheet.revision,
    ])
    expect(
      (await owner.query('SELECT id FROM api.record_comments($1)', [recordId]))
        .rows,
    ).toEqual([{ id: row.id }, { id: range.id }])
    await expect(create(owner, sheet)).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query('SELECT api.reply_to_comment($1,$2)', [
        row.id,
        'Archived write',
      ]),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      owner.query('SELECT api.resolve_comment_thread($1)', [row.id]),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('intersects Instance and Record visibility in comment reads and search without leaking context', async () => {
    const owner = await actor()
    const member = await actor(MEMBER)
    const recordId = crypto.randomUUID()
    await migrator!.query(
      `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment',$3,'Private context','draft',$4)`,
      [recordId, WORKSPACE, `EXP-${recordId}`, OWNER],
    )
    const sheet = (
      await owner.query<{ result: Instance }>(
        `SELECT to_jsonb(api.create_sheet_instance($1,'Owned context',NULL,NULL,NULL,$2,$3::jsonb)) result`,
        [WORKSPACE, recordId, JSON.stringify(initialState())],
      )
    ).rows[0].result
    const root = await create(owner, sheet, {
      body: 'Chromatography context visibility',
    })
    expect(
      (
        await member.query(
          'SELECT record_id,sheet_instance_id FROM api.comments WHERE id=$1',
          [root.id],
        )
      ).rows,
    ).toEqual([{ record_id: recordId, sheet_instance_id: sheet.id }])
    // Exercise real RLS intersections, not a mocked client or a copied ACL.
    // SET02 will supply the production project predicate after this migration.
    await migrator!.query(
      `CREATE POLICY sheet_comment_record_visibility_probe ON api.records AS RESTRICTIVE FOR SELECT TO authenticated USING (api.current_user_id()<>'sheet-comment-member')`,
    )
    try {
      expect(
        (
          await member.query('SELECT id FROM api.comments WHERE id=$1', [
            root.id,
          ])
        ).rows,
      ).toEqual([])
      expect(
        (
          await member.query('SELECT id FROM api.record_comments($1)', [
            recordId,
          ])
        ).rows,
      ).toEqual([])
      expect(
        (
          await member.query(
            "SELECT record_id,identifier,anchor FROM api.search_comments('chromatography',20)",
          )
        ).rows,
      ).toEqual([])
    } finally {
      await migrator!.query(
        'DROP POLICY sheet_comment_record_visibility_probe ON api.records',
      )
    }
    await migrator!.query(
      `CREATE POLICY sheet_comment_instance_visibility_probe ON api.sheet_instances AS RESTRICTIVE FOR SELECT TO authenticated USING (api.current_user_id()<>'sheet-comment-member')`,
    )
    try {
      expect(
        (
          await member.query('SELECT id FROM api.comments WHERE id=$1', [
            root.id,
          ])
        ).rows,
      ).toEqual([])
      expect(
        (
          await member.query('SELECT id FROM api.record_comments($1)', [
            recordId,
          ])
        ).rows,
      ).toEqual([])
      expect(
        (
          await member.query(
            "SELECT record_id,identifier,anchor FROM api.search_comments('chromatography',20)",
          )
        ).rows,
      ).toEqual([])
    } finally {
      await migrator!.query(
        'DROP POLICY sheet_comment_instance_visibility_probe ON api.sheet_instances',
      )
    }
    expect(
      (await member.query('SELECT id FROM api.comments WHERE id=$1', [root.id]))
        .rows,
    ).toEqual([{ id: root.id }])
  })

  it('validates composed source identities and retains them through Definition upgrades and source deletion without reassignment', async () => {
    const owner = await actor()
    const schemaId = (
      await migrator!.query(
        `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name) VALUES($1,'comments_composed','Comment source') RETURNING id`,
        [WORKSPACE],
      )
    ).rows[0].id
    const versionId = (
      await migrator!.query(
        `INSERT INTO api.dataset_schema_versions(schema_id,version) VALUES($1,1) RETURNING id`,
        [schemaId],
      )
    ).rows[0].id
    await migrator!.query(
      `INSERT INTO api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,cardinality,lifecycle,display_order) VALUES($1,$2,'identity','Identity','text',false,'one','active',0)`,
      [versionId, FIELD_A],
    )
    await migrator!.query(
      `UPDATE api.dataset_schema_versions SET lifecycle='active',published_at=now() WHERE id=$1`,
      [versionId],
    )
    const datasetId = (
      await migrator!.query(
        `INSERT INTO api.datasets(workspace_id,schema_version_id,name) VALUES($1,$2,'Comment source') RETURNING id`,
        [WORKSPACE, versionId],
      )
    ).rows[0].id
    const sourceIds: string[] = []
    for (const value of ['zeta-91', 'alpha-4', 'mu-37']) {
      const rowId = (
        await migrator!.query(
          `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES($1,$2) RETURNING id`,
          [datasetId, WORKSPACE],
        )
      ).rows[0].id
      sourceIds.push(rowId)
      await migrator!.query(
        `INSERT INTO api.dataset_row_values(row_id,field_id,text_value) VALUES($1,$2,$3)`,
        [rowId, FIELD_A, value],
      )
    }
    const parameterId = crypto.randomUUID()
    const bindingId = crypto.randomUUID()
    const configuration = parseSheetDefinitionConfiguration({
      formatVersion: 1,
      parameters: [
        {
          id: parameterId,
          key: 'source',
          label: 'Source',
          required: true,
          type: {
            kind: 'dataset',
            contract: { mode: 'exact', schemaVersionId: versionId },
          },
          constraints: {},
        },
      ],
      bindings: [{ id: bindingId, key: 'source', parameterId }],
      rowIdentity: { kind: 'source', columnIds: [FIELD_A] },
      joins: [],
      columns: [
        {
          id: FIELD_A,
          field: {
            ...createAdHocTextField('Source identity'),
            fieldId: FIELD_A,
            nullable: false,
          },
          source: { kind: 'bound', bindingId, sourceFieldId: FIELD_A },
        },
      ],
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: [FIELD_A],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
      },
    })
    const definition = (
      await owner.query(
        `SELECT api.create_sheet_definition($1,'comment_source','Comment source',NULL,$2::jsonb) result`,
        [WORKSPACE, JSON.stringify(configuration)],
      )
    ).rows[0].result
    await owner.query('SELECT api.publish_sheet_definition_version($1,1)', [
      definition.version.id,
    ])
    const state = {
      ...initialState(),
      localFields: [],
      localValues: {},
      presentation: { ...initialState().presentation, columnOrder: [FIELD_A] },
    }
    let sheet = (
      await owner.query<{ result: Instance }>(
        `SELECT to_jsonb(api.create_sheet_instance_from_definition($1,'Composed comment',NULL,$2,NULL,NULL,$3::jsonb,$4::jsonb)) result`,
        [
          WORKSPACE,
          definition.version.id,
          JSON.stringify(state),
          JSON.stringify([{ parameterId, kind: 'dataset', datasetId }]),
        ],
      )
    ).rows[0].result
    sheet = (
      await owner.query<{ result: Instance }>(
        `SELECT to_jsonb(api.resolve_sheet_instance_row_identity($1,$2)) result`,
        [sheet.id, sheet.revision],
      )
    ).rows[0].result
    const rowKey = rowIdentityKey(
      { kind: 'source', columnIds: [FIELD_A], logicalTypes: ['text'] },
      ['alpha-4'],
    )
    const target = {
      instanceId: sheet.id,
      rowKeys: [rowKey],
      fieldIds: [FIELD_A],
    }
    const root = await create(owner, sheet, { target })
    await expect(
      create(owner, sheet, {
        target: {
          ...target,
          rowKeys: [
            rowIdentityKey(
              { kind: 'source', columnIds: [FIELD_A], logicalTypes: ['text'] },
              ['not-a-source'],
            ),
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'SB002' })
    const changed = structuredClone(configuration)
    changed.columns[0].field.label = 'Renamed source identity'
    const versionTwo = (
      await owner.query(
        `SELECT to_jsonb(api.create_sheet_definition_version($1,1,$2::jsonb)) result`,
        [definition.definition.id, JSON.stringify(changed)],
      )
    ).rows[0].result
    await owner.query('SELECT api.publish_sheet_definition_version($1,1)', [
      versionTwo.id,
    ])
    const upgrade = (
      await owner.query(
        `SELECT api.apply_sheet_instance_definition_upgrade($1,$2,$3,'[]','[]') result`,
        [sheet.id, sheet.revision, versionTwo.id],
      )
    ).rows[0].result
    expect(upgrade.status).toBe('applied')
    expect(upgrade.instance.id).toBe(sheet.id)
    expect(
      (
        await owner.query('SELECT target FROM api.comments WHERE id=$1', [
          root.id,
        ])
      ).rows,
    ).toEqual([{ target }])
    await migrator!.query('DELETE FROM api.dataset_rows WHERE id=$1', [
      sourceIds[1],
    ])
    const latest = (
      await owner.query<{ result: Instance }>(
        'SELECT to_jsonb(s) result FROM api.sheet_instances s WHERE id=$1',
        [sheet.id],
      )
    ).rows[0].result
    await expect(create(owner, latest, { target })).rejects.toMatchObject({
      code: 'SB002',
    })
    expect(
      (
        await owner.query('SELECT target FROM api.comments WHERE id=$1', [
          root.id,
        ])
      ).rows,
    ).toEqual([{ target }])
  })

  it('validates signed Sheet review targets against frozen identities after shared live edits, preserving old revision behavior', async () => {
    const owner = await actor()
    const reviewer = await actor(REVIEWER)
    const outsider = await actor(OUTSIDER, OTHER_WORKSPACE)
    const sheet = await instance(owner)
    const recordId = crypto.randomUUID()
    await migrator!.query(
      `INSERT INTO api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id) VALUES($1,$2,'experiment',$3,'Frozen anchor','draft',$4)`,
      [recordId, WORKSPACE, `EXP-${recordId}`, OWNER],
    )
    const block = (
      await owner.query(
        'SELECT api.insert_sheet_instance_block($1,NULL,NULL,$2) result',
        [recordId, sheet.id],
      )
    ).rows[0].result
    const digest = (
      await owner.query(
        "SELECT api.preview_submission_digest($1)->>'sourceDigest' digest",
        [recordId],
      )
    ).rows[0].digest
    const submissionInput = {
      purpose: 'author-submit',
      recordId,
      revisionDigest: digest,
      workflowDefinitionKey: 'controlled-scientific-review',
      workflowDefinitionVersion: 1,
      reviewerUserIds: [REVIEWER],
      confirmed: true,
      idempotencyKey: crypto.randomUUID(),
      dueAt: null,
    }
    const submitted = (
      await owner.query(
        `SELECT api.submit_record_revision($1,$2,$3,1,ARRAY[$4]::text[],true,$5,NULL,$6,$7) result`,
        [
          recordId,
          digest,
          submissionInput.workflowDefinitionKey,
          REVIEWER,
          submissionInput.idempotencyKey,
          await signingToken(submissionInput),
          'Owner',
        ],
      )
    ).rows[0].result
    const revisionId = submitted.revision.id
    const evidenceBefore = (
      await owner.query(
        'SELECT instance_state,composed_grid FROM api.revision_sheet_evidence WHERE revision_id=$1',
        [revisionId],
      )
    ).rows
    expect(evidenceBefore[0].composed_grid.rowKeys).toEqual([
      ROW_A,
      ROW_B,
      ROW_C,
    ])
    expect(
      (
        await owner.query(
          'SELECT signature_meaning FROM api.signatures WHERE revision_id=$1',
          [revisionId],
        )
      ).rows,
    ).toEqual([{ signature_meaning: 'authored' }])
    await owner.query(
      `SELECT api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [
        sheet.id,
        sheet.revision,
        crypto.randomUUID(),
        JSON.stringify([{ operation: 'retire', fieldId: FIELD_B }]),
        JSON.stringify([
          { kind: 'local', rowKey: ROW_B },
          { kind: 'local', rowKey: ROW_D },
        ]),
        JSON.stringify([
          { rowKey: ROW_B, fieldId: FIELD_A, value: '77' },
          { rowKey: ROW_D, fieldId: FIELD_A, value: '16' },
        ]),
      ],
    )
    const target = {
      instanceId: sheet.id,
      rowKeys: [ROW_B],
      fieldIds: [FIELD_B],
    }
    const root = (
      await reviewer.query(
        `SELECT api.create_comment($1,'sheet_cell',$2::jsonb,'Frozen group label remains reviewable','{}') result`,
        [revisionId, JSON.stringify(target)],
      )
    ).rows[0].result
    expect(root).toMatchObject({
      revisionId,
      sheetInstanceId: sheet.id,
      target,
    })
    await reviewer.query('SELECT api.reply_to_comment($1,$2)', [
      root.id,
      'Frozen recovery was four, not live seventy-seven',
    ])
    await expect(
      reviewer.query(
        `SELECT api.create_comment($1,'sheet_cell',$2::jsonb,'Live-only row','{}')`,
        [
          revisionId,
          JSON.stringify({
            instanceId: sheet.id,
            rowKeys: [ROW_D],
            fieldIds: [FIELD_A],
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    await expect(
      outsider.query(
        `SELECT api.create_comment($1,'revision','{}','Cross workspace','{}')`,
        [revisionId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await reviewer.query(
      `SELECT api.create_comment($1,'revision','{}','Whole frozen revision','{}')`,
      [revisionId],
    )
    await reviewer.query(
      `SELECT api.create_comment($1,'block',$2::jsonb,'Actual frozen block','{}')`,
      [revisionId, JSON.stringify({ blockId: block.block.id })],
    )
    await expect(
      reviewer.query(
        `SELECT api.create_comment($1,'block',$2::jsonb,'Unknown frozen block','{}')`,
        [revisionId, JSON.stringify({ blockId: crypto.randomUUID() })],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
    expect(
      (
        await owner.query(
          'SELECT instance_state,composed_grid FROM api.revision_sheet_evidence WHERE revision_id=$1',
          [revisionId],
        )
      ).rows,
    ).toEqual(evidenceBefore)
    expect(
      (
        await owner.query(
          'SELECT integrity_digest FROM api.revisions WHERE id=$1',
          [revisionId],
        )
      ).rows[0].integrity_digest,
    ).toBe(submitted.revision.integrityDigest)
  })
})
