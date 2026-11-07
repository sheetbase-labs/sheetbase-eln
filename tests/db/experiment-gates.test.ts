/**
 * Gates between parts of an experiment (see the experiment_gates migration): a
 * gate block holds back what is below it, a part can open when earlier work is
 * done, a gate that blocks is enforced in the database, one that warns can be
 * gone past with a reason, and gates from a template stay.
 * Runs against a freshly migrated sheetbase_test database.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapEventType } from '../../src/lib/webhook-events'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000fc01'
const PROJECT = '00000000-0000-4000-8000-00000000fc11'
const OWNER = 'gt-owner'
const OUTSIDER = 'gt-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let owner: Client

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function experimentWithSteps(
  title: string,
  texts: string[],
): Promise<{ recordId: string; stepIds: string[] }> {
  // The steps are copied into the experiment when its protocol is pinned.
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, `${title} protocol`, OWNER],
  )
  for (const [index, text] of texts.entries()) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,$3,$4)`,
      [
        protocol,
        JSON.stringify({ text, stepNumber: index + 1 }),
        index + 1,
        OWNER,
      ],
    )
  }
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  const pin = (
    await owner.query(
      `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
      [recordId],
    )
  ).rows[0].result.block as { id: string; version: number }
  const structure = (
    await migrator.query(
      `select structure_version from api.records where id=$1`,
      [recordId],
    )
  ).rows[0].structure_version as number
  const pinned = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  return { recordId, stepIds: pinned.map((step) => step.id) }
}

async function steps(recordId: string) {
  const { rows } = await owner.query(
    `select * from api.record_steps($1) order by step_number`,
    [recordId],
  )
  return rows as Array<{
    block_id: string
    step_number: number
    status: string
    is_current: boolean
    completed_at: string | null
    completed_by_user_id: string | null
    note: string | null
    result_count: number
  }>
}

async function feed(since: string) {
  const { rows } = await migrator.query(
    `select entity_type, operation, payload from api.change_events
      where workspace_id = $1 and entity_type in ('gate_opening','gate_override') and sequence > $2
      order by sequence`,
    [WS, since],
  )
  return rows.map((row) => ({
    wire: mapEventType(row.entity_type, row.operation, row.payload),
    payload: row.payload as Record<string, unknown>,
  }))
}

async function mark(): Promise<string> {
  const { rows } = await migrator.query(
    `select coalesce(max(last_seq),0) as last_seq from api.workspace_change_seq where workspace_id = $1`,
    [WS],
  )
  return String(rows[0].last_seq)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [OWNER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'gt','Gates'),('00000000-0000-4000-8000-00000000fc02','gt2','Other lab')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),('00000000-0000-4000-8000-00000000fc02',$3,'owner')`,
    [WS, OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'gt','Gates',$3)`,
    [PROJECT, WS, OWNER],
  )
  owner = await actor(OWNER, WS)
  await migrator.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

/** An experiment whose protocol is pinned, so it has `texts.length` copied steps in page order. */
async function experiment(title: string, texts: string[] = []) {
  const { rows } = await owner.query(
    `select id from api.create_record($1::uuid,'experiment',$2)`,
    [PROJECT, title],
  )
  const recordId = rows[0].id as string
  if (texts.length === 0) return { recordId, stepIds: [] as string[] }
  const protocol = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template',$3,$4,'active',$5)`,
    [protocol, WS, `PRT-${protocol}`, `${title} protocol`, OWNER],
  )
  for (const [index, text] of texts.entries()) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,$3,$4)`,
      [
        protocol,
        JSON.stringify({ text, stepNumber: index + 1 }),
        index + 1,
        OWNER,
      ],
    )
  }
  const pin = (
    await owner.query(
      `select api.insert_block($1,'protocol_reference','{}'::jsonb) as result`,
      [recordId],
    )
  ).rows[0].result.block as { id: string; version: number }
  const structure = (
    await migrator.query(
      `select structure_version from api.records where id=$1`,
      [recordId],
    )
  ).rows[0].structure_version as number
  const pinned = (
    await owner.query(
      `select api.pin_protocol_reference($1,$2,$3,$4) as result`,
      [pin.id, protocol, pin.version, structure],
    )
  ).rows[0].result.copied_steps as Array<{ id: string }>
  return { recordId, stepIds: pinned.map((step) => step.id) }
}

async function addPart(recordId: string, title: string, day?: number) {
  const { rows } = await owner.query(
    `select api.create_experiment_part($1,$2,$3) as part`,
    [recordId, title, day ?? null],
  )
  return rows[0].part as { id: string; position: number; day_offset: number }
}

async function parts(recordId: string) {
  const { rows } = await owner.query(`select * from api.record_parts($1)`, [
    recordId,
  ])
  return rows as Array<{
    part_id: string
    part_number: number
    title: string
    day_offset: number
    status: string
    is_current: boolean
    step_count: number
    steps_done: number
    block_count: number
    opened_at: string | null
    completed_at: string | null
  }>
}

async function blockParts(recordId: string) {
  const { rows } = await migrator.query(
    `select b.id, b.part_id, b."order" from api.blocks b where b.record_id = $1 and b.type <> 'protocol_reference' order by b."order"`,
    [recordId],
  )
  return rows as Array<{ id: string; part_id: string | null; order: number }>
}

type Gate = {
  gate_id: string
  gate_kind: 'block' | 'part'
  block_id: string | null
  part_id: string | null
  part_number: number | null
  label: string
  mode: string
  met: boolean
  blocking: boolean
  overridden: boolean
  override_reason: string | null
  missing: string[]
  conditions: Array<{
    kind: string
    met: boolean
    text: string
    soft?: boolean
  }>
  from_template: boolean
}

async function gates(recordId: string): Promise<Gate[]> {
  const { rows } = await owner.query(`select * from api.record_gates($1)`, [
    recordId,
  ])
  return rows as Gate[]
}

async function insert(
  recordId: string,
  type: string,
  payload: Record<string, unknown>,
  after?: string,
) {
  const { rows } = await owner.query(
    `select api.insert_block($1,$2,$3::jsonb,1,$4) as result`,
    [recordId, type, JSON.stringify(payload), after ?? null],
  )
  return rows[0].result.block as { id: string; version: number }
}

const CONFLUENCE = {
  title: 'Confluence check',
  columns: ['Plate', 'Confluence (%)', 'Morphology'],
  rows: [
    ['P1', '62', 'Normal'],
    ['P2', '58', 'Normal'],
    ['P3', '', ''],
    ['P4', '', ''],
  ],
}

const FILLED = [
  ['P1', '62', 'Normal'],
  ['P2', '58', 'Normal'],
  ['P3', '61', 'Normal'],
  ['P4', '59', 'Normal'],
]

const HALF = [
  ['P1', '62', 'Normal'],
  ['P2', '58', 'Normal'],
  ['P3', '61', ''],
  ['P4', '', ''],
]

async function fillTable(blockId: string, rows: string[][]) {
  const { rows: current } = await migrator.query(
    `select version, payload from api.blocks where id=$1`,
    [blockId],
  )
  await owner.query(`select api.update_block_payload($1,$2::jsonb,$3)`, [
    blockId,
    JSON.stringify({ ...current[0].payload, rows }),
    current[0].version,
  ])
}

async function refused(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

/** An experiment with a confluence table and a gate under it. */
async function gated(mode: 'warn' | 'block', title = 'Gated') {
  const { recordId } = await experiment(title)
  const table = await insert(recordId, 'table', CONFLUENCE)
  const gate = await insert(
    recordId,
    'gate',
    {
      label: 'Dosing',
      mode,
      conditions: [
        {
          kind: 'table_filled',
          blockId: table.id,
          column: 'Confluence (%)',
          label: 'Confluence check',
        },
      ],
    },
    table.id,
  )
  return { recordId, table, gate }
}

const DOC = { type: 'doc', content: [] }

describe('a gate block', () => {
  it('says what is missing in words and opens when the table is filled', async () => {
    const { recordId, table, gate } = await gated('warn')
    const [one] = await gates(recordId)
    expect(one).toMatchObject({
      gate_kind: 'block',
      block_id: gate.id,
      label: 'Dosing',
      mode: 'warn',
      met: false,
      blocking: false,
      overridden: false,
    })
    expect(one.missing).toEqual(['P3 and P4 have no Confluence (%)'])
    await fillTable(table.id, FILLED)
    const [open] = await gates(recordId)
    expect(open.met).toBe(true)
    expect(open.missing).toEqual([])
  })

  it('refuses writes below it while it blocks, and lets them through once it opens', async () => {
    const { recordId, table, gate } = await gated('block')
    const [closed] = await gates(recordId)
    expect(closed.blocking).toBe(true)
    // Above the gate is fine: that is where the table is filled in.
    await fillTable(table.id, HALF)
    await refused(
      owner.query(`select api.insert_block($1,'rich_text',$2::jsonb,1,$3)`, [
        recordId,
        JSON.stringify(DOC),
        gate.id,
      ]),
      'SB150',
    )
    await fillTable(table.id, FILLED)
    const text = await insert(recordId, 'rich_text', DOC, gate.id)
    expect(text.id).toBeTruthy()
    // Closing it again holds back edits to what is already below.
    await fillTable(table.id, HALF)
    const { rows } = await migrator.query(
      `select version from api.blocks where id=$1`,
      [text.id],
    )
    await refused(
      owner.query(`select api.update_block_payload($1,$2::jsonb,$3)`, [
        text.id,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        rows[0].version,
      ]),
      'SB150',
    )
  })

  it('only warns when it is set to warn: writes below are allowed', async () => {
    const { recordId, gate } = await gated('warn')
    const text = await insert(recordId, 'rich_text', DOC, gate.id)
    expect(text.id).toBeTruthy()
  })

  it('checks a gate payload', async () => {
    const { recordId } = await experiment('Bad gate')
    await refused(
      owner.query(`select api.insert_block($1,'gate',$2::jsonb)`, [
        recordId,
        JSON.stringify({ mode: 'block', conditions: [] }),
      ]),
      'SB153',
    )
    await refused(
      owner.query(`select api.insert_block($1,'gate',$2::jsonb)`, [
        recordId,
        JSON.stringify({
          mode: 'maybe',
          conditions: [{ kind: 'samples_linked', min: 1 }],
        }),
      ]),
      'SB153',
    )
  })

  it('announces a gate when it opens, once, and again after it has closed', async () => {
    const since = await mark()
    const { recordId, table } = await gated('warn', 'Events')
    await fillTable(table.id, FILLED)
    await fillTable(
      table.id,
      FILLED.map((row, i) => (i === 3 ? ['P4', '60', 'Normal'] : row)),
    )
    const opened = (await feed(since)).filter(
      (event) => event.payload.recordId === recordId,
    )
    expect(opened.map((event) => event.wire)).toEqual([
      'experiment.gate_opened',
    ])
    expect(opened[0].payload).toMatchObject({
      gate: 'Dosing',
      mode: 'warn',
      change: 'opened',
    })
    await fillTable(table.id, HALF)
    await fillTable(table.id, FILLED)
    const again = (await feed(since)).filter(
      (event) => event.payload.recordId === recordId,
    )
    expect(again).toHaveLength(2)
  })
})

describe('going on anyway', () => {
  it('asks for a reason, keeps it, and tells the change feed', async () => {
    const since = await mark()
    const { recordId, gate } = await gated('warn', 'Override')
    await refused(
      owner.query(`select api.override_gate($1,null,'  ')`, [gate.id]),
      'SB154',
    )
    await owner.query(`select api.override_gate($1,null,$2)`, [
      gate.id,
      'Plates P3 and P4 were read by the other incubator',
    ])
    const [row] = await gates(recordId)
    expect(row).toMatchObject({
      met: false,
      overridden: true,
      override_reason: 'Plates P3 and P4 were read by the other incubator',
    })
    const { rows } = await migrator.query(
      `select * from api.gate_overrides where record_id=$1`,
      [recordId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      label: 'Dosing',
      created_by_user_id: OWNER,
      missing: ['P3 and P4 have no Confluence (%)'],
    })
    // A second go is the same go.
    await owner.query(`select api.override_gate($1,null,'again')`, [gate.id])
    expect(
      (
        await migrator.query(
          `select count(*)::int as n from api.gate_overrides where record_id=$1`,
          [recordId],
        )
      ).rows[0].n,
    ).toBe(1)
    const events = (await feed(since)).filter(
      (event) => event.payload.recordId === recordId,
    )
    expect(events.map((event) => event.wire)).toEqual([
      'experiment.gate_overridden',
    ])
    expect(events[0].payload).toMatchObject({
      reason: 'Plates P3 and P4 were read by the other incubator',
    })
  })

  it('cannot go past a gate that blocks, or one that is already open', async () => {
    const { gate } = await gated('block', 'Cannot')
    await refused(
      owner.query(`select api.override_gate($1,null,'because')`, [gate.id]),
      'SB155',
    )
    const open = await gated('warn', 'Already open')
    await fillTable(open.table.id, FILLED)
    await refused(
      owner.query(`select api.override_gate($1,null,'because')`, [
        open.gate.id,
      ]),
      'SB156',
    )
  })

  it('is for people who can edit the experiment', async () => {
    const { gate } = await gated('warn', 'Outsider')
    const stranger = await actor(
      OUTSIDER,
      '00000000-0000-4000-8000-00000000fc02',
    )
    await refused(
      stranger.query(`select api.override_gate($1,null,'because')`, [gate.id]),
      '42501',
    )
  })
})

describe('conditions', () => {
  it('checks a step, a part, linked samples, a field and a date', async () => {
    const { recordId, stepIds } = await experiment('Mixed', ['Seed', 'Rinse'])
    const one = await addPart(recordId, 'Seed cells', 0)
    await addPart(recordId, 'Dose', 2)
    const gate = await insert(recordId, 'gate', {
      mode: 'warn',
      label: 'Before dosing',
      conditions: [
        { kind: 'step_done', blockId: stepIds[0] },
        { kind: 'part_done', partId: one.id },
        { kind: 'samples_linked', min: 2 },
        { kind: 'field_set', field: 'reviewer', label: 'Reviewer' },
        { kind: 'date_reached', date: '2999-01-01' },
      ],
    })
    const [closed] = await gates(recordId)
    expect(closed.block_id).toBe(gate.id)
    expect(closed.missing).toEqual([
      "Step 1 (Seed) isn't done",
      "Part 1 (Seed cells) isn't done",
      'At least 2 samples must be linked (0 so far)',
      "Reviewer isn't set",
      'Not before 1 Jan 2999',
    ])
    expect(closed.conditions.map((c) => c.soft ?? false)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ])
    for (const id of stepIds) {
      await owner.query(`select api.set_step_done($1,true)`, [id])
    }
    await migrator.query(
      `update api.records set reviewer_user_id=$2 where id=$1`,
      [recordId, OWNER],
    )
    for (const n of [1, 2]) {
      const { rows } = await migrator.query(
        `insert into api.records(workspace_id,kind,identifier,title,status,created_by_user_id)
         values ($1,'sample',$2,'S','active',$3) returning id, identifier`,
        [WS, `GS-${crypto.randomUUID().slice(0, 8)}-${n}`, OWNER],
      )
      await migrator.query(
        `insert into api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
         values ($1,$2,'sample',$3,'sample',$4)`,
        [recordId, rows[0].id, rows[0].identifier, OWNER],
      )
    }
    const [now] = await gates(recordId)
    // Only the date is left, and a date never blocks.
    expect(now.missing).toEqual(['Not before 1 Jan 2999'])
    expect(now.met).toBe(false)
    expect(now.blocking).toBe(false)
  })

  it('counts rows of a table, with and without a column', async () => {
    const { recordId } = await experiment('Rows')
    const table = await insert(recordId, 'table', CONFLUENCE)
    await insert(
      recordId,
      'gate',
      {
        mode: 'warn',
        label: 'Enough',
        conditions: [
          { kind: 'table_filled', blockId: table.id, minRows: 5 },
          {
            kind: 'table_filled',
            blockId: table.id,
            column: 'Confluence (%)',
            minRows: 3,
            label: 'Confluence check',
          },
          {
            kind: 'table_filled',
            blockId: table.id,
            column: 'Nothing',
            label: 'Confluence check',
          },
        ],
      },
      table.id,
    )
    const [row] = await gates(recordId)
    expect(row.missing).toEqual([
      'Confluence check needs at least 5 rows filled (4 so far)',
      'Confluence check needs 3 rows with Confluence (%) (2 so far)',
      'Confluence check has no Nothing column',
    ])
  })

  it('reads the cells of a sheet', async () => {
    const { recordId } = await experiment('Sheet')
    await migrator.query(
      `select set_config('sheetbase.sheet_instance_write','rpc-v1',false)`,
    )
    const fieldA = crypto.randomUUID()
    const fieldB = crypto.randomUUID()
    const field = (key: string, label: string, fieldId: string) => ({
      key,
      label,
      fieldId,
      category: null,
      nullable: true,
      quantity: null,
      lifecycle: 'active',
      validation: {},
      cardinality: 'one',
      computation: { mode: 'stored' },
      description: null,
      logicalType: 'text',
      defaultValue: null,
      relationship: null,
    })
    const state = {
      bindings: [],
      provenance: { createdFrom: 'ad_hoc' },
      presentation: {
        sorts: [],
        density: 'standard',
        filters: [],
        columnOrder: [fieldA, fieldB],
        columnWidths: {},
        hiddenColumnIds: [],
        frozenColumnCount: 0,
      },
      calculationOverrides: {},
      localFields: [field('plate', 'Plate', fieldA), field('od', 'OD', fieldB)],
      localValues: {},
    }
    const instanceId = (
      await migrator.query(
        `insert into api.sheet_instances(workspace_id,name,created_by_user_id,state)
         values ($1,'Plate reads',$2,$3::jsonb) returning id`,
        [WS, OWNER, JSON.stringify(state)],
      )
    ).rows[0].id as string
    const sheet = (
      await owner.query(
        `select api.insert_block($1,'sheet',$2::jsonb) as result`,
        [recordId, JSON.stringify({ instanceId })],
      )
    ).rows[0].result.block as { id: string }
    await insert(
      recordId,
      'gate',
      {
        mode: 'warn',
        label: 'Read',
        conditions: [
          {
            kind: 'table_filled',
            blockId: sheet.id,
            column: 'od',
            label: 'The sheet',
          },
        ],
      },
      sheet.id,
    )
    await migrator.query(
      `update api.sheet_instances set state = state || $2::jsonb where id=$1`,
      [
        instanceId,
        JSON.stringify({
          localValues: {
            [crypto.randomUUID()]: { [fieldA]: 'P1', [fieldB]: '0.4' },
            [crypto.randomUUID()]: { [fieldA]: 'P2' },
          },
        }),
      ],
    )
    const [row] = await gates(recordId)
    expect(row.missing).toEqual(['P2 has no od'])
  })
})

describe('the rule that opens a part', () => {
  it('holds a part back until the part before is done, and blocks its steps', async () => {
    const { recordId, stepIds } = await experiment('Parts gate', [
      'Seed',
      'Rinse',
      'Dose',
    ])
    const one = await addPart(recordId, 'Seed', 0)
    const two = await addPart(recordId, 'Dose', 2)
    await owner.query(`select api.set_block_part($1,$2)`, [stepIds[2], two.id])
    await refused(
      owner.query(`select api.set_part_gate($1,$2::jsonb,'maybe')`, [
        two.id,
        JSON.stringify([{ kind: 'part_done', partId: one.id }]),
      ]),
      'SB153',
    )
    await refused(
      owner.query(`select api.set_part_gate($1,$2::jsonb,'block')`, [
        two.id,
        JSON.stringify([{ kind: 'part_done', partId: 'not-a-uuid' }]),
      ]),
      'SB153',
    )
    await owner.query(`select api.set_part_gate($1,$2::jsonb,'block')`, [
      two.id,
      JSON.stringify([{ kind: 'part_done', partId: one.id }]),
    ])
    const [row] = await gates(recordId)
    expect(row).toMatchObject({
      gate_kind: 'part',
      part_id: two.id,
      part_number: 2,
      mode: 'block',
      met: false,
      blocking: true,
    })
    expect(row.missing).toEqual(["Part 1 (Seed) isn't done"])
    await refused(
      owner.query(`select api.set_step_done($1,true)`, [stepIds[2]]),
      'SB150',
    )
    // Finishing part 1 opens part 2.
    for (const id of stepIds.slice(0, 2)) {
      await owner.query(`select api.set_step_done($1,true)`, [id])
    }
    const [open] = await gates(recordId)
    expect(open.met).toBe(true)
    await owner.query(`select api.set_step_done($1,true)`, [stepIds[2]])
    expect((await parts(recordId)).every((p) => p.status === 'done')).toBe(true)
  })

  it('refuses to mark a closed part done by hand', async () => {
    const { recordId } = await experiment('Manual')
    const one = await addPart(recordId, 'Prep', 0)
    const two = await addPart(recordId, 'Read', 1)
    await owner.query(`select api.set_part_gate($1,$2::jsonb,'block')`, [
      two.id,
      JSON.stringify([{ kind: 'part_done', partId: one.id }]),
    ])
    await owner.query(`select api.set_part_done($1,true)`, [one.id])
    await owner.query(`select api.set_part_done($1,true)`, [two.id])
    await owner.query(`select api.set_part_done($1,false)`, [two.id])
    await owner.query(`select api.set_part_done($1,false)`, [one.id])
    await refused(
      owner.query(`select api.set_part_done($1,true)`, [two.id]),
      'SB150',
    )
  })

  it('clears the rule and forgets going past it', async () => {
    const { recordId } = await experiment('Clear')
    await addPart(recordId, 'One', 0)
    const two = await addPart(recordId, 'Two', 1)
    await owner.query(`select api.set_part_gate($1,$2::jsonb,'warn')`, [
      two.id,
      JSON.stringify([{ kind: 'samples_linked', min: 1 }]),
    ])
    await owner.query(
      `select api.override_gate(null,$1,'Samples come tomorrow')`,
      [two.id],
    )
    expect((await gates(recordId))[0].overridden).toBe(true)
    await owner.query(`select api.set_part_gate($1,null)`, [two.id])
    expect(await gates(recordId)).toEqual([])
  })

  it('does steps in order when the part says so', async () => {
    const { recordId, stepIds } = await experiment('Ordered', ['A', 'B', 'C'])
    const one = await addPart(recordId, 'All', 0)
    await owner.query(`select api.set_part_gate($1,null,null,true)`, [one.id])
    await refused(
      owner.query(`select api.set_step_done($1,true)`, [stepIds[1]]),
      'SB151',
    )
    await owner.query(`select api.set_step_done($1,true)`, [stepIds[0]])
    await owner.query(`select api.set_step_done($1,true)`, [stepIds[1]])
    // Taking a tick off is always allowed.
    await owner.query(`select api.set_step_done($1,false)`, [stepIds[0]])
  })
})

describe('gates from a template', () => {
  it('cannot be taken off or changed on the experiment', async () => {
    const { recordId, gate } = await gated('warn', 'Templated')
    await migrator.query(
      `update api.blocks set payload = payload || '{"fromTemplate": true}'::jsonb where id=$1`,
      [gate.id],
    )
    const { rows } = await migrator.query(
      `select version, payload from api.blocks where id=$1`,
      [gate.id],
    )
    await refused(
      owner.query(`select api.update_block_payload($1,$2::jsonb,$3)`, [
        gate.id,
        JSON.stringify({ ...rows[0].payload, mode: 'block' }),
        rows[0].version,
      ]),
      'SB152',
    )
    await refused(
      owner.query(`delete from api.blocks where id=$1`, [gate.id]),
      'SB152',
    )
    expect(
      (await gates(recordId)).map((g) => [g.block_id, g.from_template]),
    ).toEqual([[gate.id, true]])
    // It can still be gone past.
    await owner.query(`select api.override_gate($1,null,'because')`, [gate.id])
  })

  it('on a part, cannot be cleared either', async () => {
    const { recordId } = await experiment('Templated part')
    const one = await addPart(recordId, 'One', 0)
    await owner.query(`select api.set_part_gate($1,$2::jsonb)`, [
      one.id,
      JSON.stringify([{ kind: 'samples_linked', min: 1 }]),
    ])
    await migrator.query(
      `update api.experiment_parts set gate_from_template = true where id=$1`,
      [one.id],
    )
    await refused(
      owner.query(`select api.set_part_gate($1,null)`, [one.id]),
      'SB152',
    )
  })

  it('arrives with an experiment made from a template, pointed at its own blocks', async () => {
    const partOne = crypto.randomUUID()
    const partTwo = crypto.randomUUID()
    const stepPlacement = crypto.randomUUID()
    const gatePlacement = crypto.randomUUID()
    const textPlacement = crypto.randomUUID()
    const configuration = {
      formatVersion: 1,
      parameters: [],
      parts: [
        { id: partOne, title: 'Seed', dayOffset: 0, stepsInOrder: true },
        {
          id: partTwo,
          title: 'Dose',
          dayOffset: 2,
          gateMode: 'block',
          opensWhen: [{ kind: 'part_done', partId: partOne }],
        },
      ],
      placements: [
        {
          id: stepPlacement,
          kind: 'narrative',
          order: 1,
          partId: partOne,
          blockType: 'table',
          payload: {
            title: 'Confluence check',
            columns: ['Plate', 'Confluence (%)'],
            rows: [['P1', '']],
          },
        },
        {
          id: gatePlacement,
          kind: 'narrative',
          order: 2,
          partId: partTwo,
          blockType: 'gate',
          payload: {
            pending: true,
            mode: 'warn',
            label: 'Plates seeded',
            conditions: [
              {
                kind: 'table_filled',
                blockId: stepPlacement,
                column: 'Confluence (%)',
                label: 'Confluence check',
              },
            ],
          },
        },
        {
          id: textPlacement,
          kind: 'narrative',
          order: 3,
          partId: partTwo,
          blockType: 'rich_text',
          payload: DOC,
        },
      ],
    }
    const created = (
      await owner.query(
        `select api.create_notebook_template($1,$2,'Dosing template',null,$3::jsonb) result`,
        [WS, `dosing_${Date.now()}`, JSON.stringify(configuration)],
      )
    ).rows[0].result
    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'Published')) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result
    const made = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Dosing','[]'::jsonb,$3) result`,
        [published.id, PROJECT, crypto.randomUUID()],
      )
    ).rows[0].result
    const recordId = made.record.id as string
    const rows = await gates(recordId)
    expect(rows.map((g) => [g.gate_kind, g.mode, g.from_template])).toEqual([
      ['part', 'block', true],
      ['block', 'warn', true],
    ])
    expect(rows[1].label).toBe('Plates seeded')
    expect(rows[1].missing).toEqual(['P1 has no Confluence (%)'])
    const partsNow = await owner.query(
      `select title, steps_in_order, gate_from_template from api.experiment_parts where record_id=$1 order by "position"`,
      [recordId],
    )
    expect(partsNow.rows).toEqual([
      { title: 'Seed', steps_in_order: true, gate_from_template: true },
      { title: 'Dose', steps_in_order: false, gate_from_template: true },
    ])
    // The gate is not armed in the template version, and stays armed here.
    const { rows: blocks } = await migrator.query(
      `select payload from api.blocks where record_id=$1 and type='gate'`,
      [recordId],
    )
    expect(blocks[0].payload.pending).toBeUndefined()
    expect(blocks[0].payload.fromTemplate).toBe(true)
    // Filling in the table opens the gate: it points at this experiment's table.
    const { rows: table } = await migrator.query(
      `select id from api.blocks where record_id=$1 and type='table'`,
      [recordId],
    )
    expect(rows[1].conditions[0]).toMatchObject({ blockId: table[0].id })
    await fillTable(table[0].id, [['P1', '61']])
    expect((await gates(recordId))[1].met).toBe(true)
  })
})
