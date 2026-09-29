import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000240a'
const WS_B = '00000000-0000-4000-8000-00000000240b'
const PROJECT_A = '00000000-0000-4000-8000-00000000241a'
const PROJECT_B = '00000000-0000-4000-8000-00000000241b'
const USER_A = 'sci-002-owner-a'
const USER_B = 'sci-002-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function authenticated(user: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
  return client
}

async function record(
  client: Client,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],$5::jsonb)`,
    [project, kind, title, status, JSON.stringify(properties)],
  )
  return rows[0]
}

async function block(
  client: Client,
  recordId: string,
  type: string,
  payload: unknown,
  order: number,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *`,
    [recordId, type, JSON.stringify(payload), order, USER_A],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    INSERT INTO internal.user(id,name,email,"emailVerified") VALUES
      ('${USER_A}','SCI 002 A','sci-002-a@sheetbase.test',true),
      ('${USER_B}','SCI 002 B','sci-002-b@sheetbase.test',true);
    INSERT INTO api.workspaces(id,slug,name) VALUES
      ('${WS_A}','sci-002-a','SCI 002 A'),('${WS_B}','sci-002-b','SCI 002 B');
    INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ('${WS_A}','${USER_A}','owner'),('${WS_B}','${USER_B}','owner');
    INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ('${PROJECT_A}','${WS_A}','sci-002-a','SCI 002 A'),
      ('${PROJECT_B}','${WS_B}','sci-002-b','SCI 002 B')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('SCI-002 protocol pins and material blocks', () => {
  it('rejects stale null versions and authenticated direct creation paths', async () => {
    const a = await authenticated(USER_A, WS_A)
    const protocol = await record(
      a,
      PROJECT_A,
      'protocol_template',
      'Guarded protocol',
    )
    const experiment = await record(a, PROJECT_A, 'experiment', 'Guarded run')
    const pin = await block(a, experiment.id, 'protocol_reference', {}, 1)

    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,NULL,$3)`, [
        pin.id,
        protocol.id,
        experiment.structure_version,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,$3,NULL)`, [
        pin.id,
        protocol.id,
        pin.version,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })

    await expect(
      block(
        a,
        experiment.id,
        'protocol_reference',
        {
          protocolRecordId: protocol.id,
        },
        2,
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      block(
        a,
        experiment.id,
        'procedure_step',
        {
          text: 'Bypass pinning',
          stepNumber: 1,
        },
        3,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('rejects incomplete scientific payloads and fractional procedure step numbers', async () => {
    const a = await authenticated(USER_A, WS_A)
    const protocol = await record(
      a,
      PROJECT_A,
      'protocol_template',
      'Validation protocol',
    )
    const experiment = await record(
      a,
      PROJECT_A,
      'experiment',
      'Validation run',
    )
    const sample = await record(a, PROJECT_A, 'sample', 'Validation sample')

    for (const payload of [{}, { items: null }]) {
      await expect(
        block(a, experiment.id, 'materials', payload, 1),
      ).rejects.toMatchObject({ code: '23514' })
    }

    for (const payload of [
      { stepNumber: 1 },
      { text: 'Missing number' },
      { text: 'Fractional', stepNumber: 1.5 },
    ]) {
      await expect(
        block(a, protocol.id, 'procedure_step', payload, 1),
      ).rejects.toMatchObject({ code: '23514' })
    }

    await block(
      a,
      protocol.id,
      'procedure_step',
      { text: 'Keep this a protocol', stepNumber: 1 },
      1,
    )
    await expect(
      a.query(`UPDATE api.records SET kind='experiment' WHERE id=$1`, [
        protocol.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })

    const validItem = {
      id: 'validation-item',
      materialRecordId: sample.id,
      kind: sample.kind,
      identifier: sample.identifier,
      title: sample.title,
      quantity: 1,
      unit: { code: 'mL', symbol: 'mL' },
      observedAt: '2026-07-21T12:00:00.000Z',
    }
    for (const field of [
      'id',
      'materialRecordId',
      'kind',
      'identifier',
      'title',
      'quantity',
      'unit',
      'observedAt',
    ]) {
      const invalidItem = { ...validItem } as Record<string, unknown>
      delete invalidItem[field]
      await expect(
        block(a, experiment.id, 'materials', { items: [invalidItem] }, 1),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('pins an immutable protocol snapshot, copies executable steps, and enforces concurrency and provenance', async () => {
    const a = await authenticated(USER_A, WS_A)
    const b = await authenticated(USER_B, WS_B)
    const protocol = await record(
      a,
      PROJECT_A,
      'protocol_template',
      'Original protocol',
      'approved',
      { version: '3.2' },
    )
    const step1 = await block(
      a,
      protocol.id,
      'procedure_step',
      { text: 'Add buffer', stepNumber: 1 },
      20,
    )
    const step2 = await block(
      a,
      protocol.id,
      'procedure_step',
      { text: 'Incubate', stepNumber: 2 },
      10,
    )
    const experiment = await record(a, PROJECT_A, 'experiment', 'Run protocol')
    const pin = await block(a, experiment.id, 'protocol_reference', {}, 5)
    const initialStructure = experiment.structure_version

    const {
      rows: [{ result }],
    } = await a.query(`SELECT api.pin_protocol_reference($1,$2,$3,$4) result`, [
      pin.id,
      protocol.id,
      pin.version,
      initialStructure,
    ])
    const revision = result.revision
    expect(revision.created_by_user_id).toBe(USER_A)
    expect(revision.metadata_snapshot).toMatchObject({
      id: protocol.id,
      identifier: protocol.identifier,
      title: 'Original protocol',
      status: 'approved',
      properties: { version: '3.2' },
    })
    expect(revision.block_snapshot.map((item: any) => item.id)).toEqual([
      step2.id,
      step1.id,
    ])
    expect(result.block.payload).toEqual({
      protocolRecordId: protocol.id,
      protocolIdentifier: protocol.identifier,
      protocolTitle: 'Original protocol',
      protocolRevisionId: revision.id,
      version: '3.2',
      approvalStatus: 'approved',
      pinnedAt: revision.created_at,
      pinnedByUserId: USER_A,
    })
    expect(result.block.updated_by_user_id).toBe(USER_A)
    expect(result.structure_version).toBe(initialStructure + 1)
    expect(result.copied_steps.map((item: any) => item.payload.text)).toEqual([
      'Incubate',
      'Add buffer',
    ])
    expect(
      result.copied_steps.every(
        (item: any) => item.created_by_user_id === USER_A,
      ),
    ).toBe(true)
    expect(
      result.copied_steps.map((item: any) => item.payload.sourceStepBlockId),
    ).toEqual([step2.id, step1.id])

    const { rows: links } = await a.query(
      `SELECT * FROM api.record_links WHERE source_record_id=$1 AND link_type='protocol'`,
      [experiment.id],
    )
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      target_record_id: protocol.id,
      created_by_user_id: USER_A,
    })
    const { rows: events } = await a.query(
      `SELECT entity_type,operation,actor_user_id FROM api.change_events
       WHERE record_id=$1 AND entity_type IN ('block','record_link') ORDER BY sequence`,
      [experiment.id],
    )
    expect(
      events.some(
        (event) =>
          event.entity_type === 'record_link' && event.operation === 'link',
      ),
    ).toBe(true)
    expect(
      events.filter((event) => event.entity_type === 'block').length,
    ).toBeGreaterThanOrEqual(3)
    expect(events.every((event) => event.actor_user_id === USER_A)).toBe(true)

    await a.query(
      `UPDATE api.records SET title='Mutated protocol' WHERE id=$1`,
      [protocol.id],
    )
    await a.query(
      `UPDATE api.blocks SET payload='{"text":"Mutated live step","stepNumber":2}' WHERE id=$1`,
      [step2.id],
    )
    const {
      rows: [durable],
    } = await a.query(
      `SELECT r.metadata_snapshot,r.block_snapshot,b.payload FROM api.revisions r
       JOIN api.blocks b ON b.id=$2 WHERE r.id=$1`,
      [revision.id, pin.id],
    )
    expect(durable.metadata_snapshot.title).toBe('Original protocol')
    expect(
      durable.block_snapshot.find((item: any) => item.id === step2.id).payload
        .text,
    ).toBe('Incubate')
    expect(durable.payload).toEqual(result.block.payload)
    expect(
      (
        await a.query(`SELECT payload FROM api.blocks WHERE id=$1`, [
          result.copied_steps[0].id,
        ])
      ).rows[0].payload.text,
    ).toBe('Incubate')

    const staleBlock = await block(
      a,
      experiment.id,
      'protocol_reference',
      {},
      100,
    )
    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,0,$3)`, [
        staleBlock.id,
        protocol.id,
        initialStructure + 1,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,$3,1)`, [
        staleBlock.id,
        protocol.id,
        staleBlock.version,
      ]),
    ).rejects.toMatchObject({ code: 'SB001' })
    const foreignProtocol = await record(
      b,
      PROJECT_B,
      'protocol_template',
      'Foreign protocol',
    )
    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,$3,$4)`, [
        staleBlock.id,
        foreignProtocol.id,
        staleBlock.version,
        initialStructure + 1,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    const execution = result.copied_steps[0]
    const completed = (
      await a.query(
        `UPDATE api.blocks SET payload=payload || $2::jsonb WHERE id=$1 RETURNING payload`,
        [
          execution.id,
          JSON.stringify({
            completed: true,
            note: 'Observed',
            completedAt: '2000-01-01T00:00:00Z',
            completedByUserId: USER_B,
          }),
        ],
      )
    ).rows[0].payload
    expect(completed.note).toBe('Observed')
    expect(completed.completedByUserId).toBe(USER_A)
    expect(new Date(completed.completedAt).getTime()).toBeGreaterThan(
      Date.now() - 10_000,
    )
    const preserved = (
      await a.query(
        `UPDATE api.blocks SET payload=payload || '{"note":"Still observed","completedAt":"1999-01-01T00:00:00Z","completedByUserId":"forged"}' WHERE id=$1 RETURNING payload`,
        [execution.id],
      )
    ).rows[0].payload
    expect(preserved).toMatchObject({
      note: 'Still observed',
      completedAt: completed.completedAt,
      completedByUserId: USER_A,
    })
    const cleared = (
      await a.query(
        `UPDATE api.blocks SET payload=payload || '{"completed":false}' WHERE id=$1 RETURNING payload`,
        [execution.id],
      )
    ).rows[0].payload
    expect(cleared).toMatchObject({
      completed: false,
      completedAt: null,
      completedByUserId: null,
      note: 'Still observed',
    })
    for (const patch of [
      { text: 'rewrite' },
      { stepNumber: 99 },
      { sourceStepBlockId: step1.id },
      { sourceProtocolRevisionId: protocol.id },
    ]) {
      await expect(
        a.query(
          `UPDATE api.blocks SET payload=payload || $2::jsonb WHERE id=$1`,
          [execution.id, JSON.stringify(patch)],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('validates material targets and preserves observed identity while allowing quantity edits', async () => {
    const a = await authenticated(USER_A, WS_A)
    const b = await authenticated(USER_B, WS_B)
    const experiment = await record(a, PROJECT_A, 'experiment', 'Material run')
    const sample = await record(a, PROJECT_A, 'sample', 'Sample A', 'available')
    const reagent = await record(
      a,
      PROJECT_A,
      'reagent',
      'Reagent A',
      'available',
    )
    const archived = await record(
      a,
      PROJECT_A,
      'sample',
      'Archived sample',
      'available',
    )
    await a.query(`UPDATE api.records SET archived_at=now() WHERE id=$1`, [
      archived.id,
    ])
    const foreign = await record(
      b,
      PROJECT_B,
      'sample',
      'Foreign sample',
      'available',
    )
    const deleted = await record(
      a,
      PROJECT_A,
      'sample',
      'Deleted sample',
      'available',
    )
    await a.query(`UPDATE api.records SET deleted_at=now() WHERE id=$1`, [
      deleted.id,
    ])
    const observedAt = '2026-07-21T12:00:00.000Z'
    const item = (target: any, id: string, quantity = 1) => ({
      id,
      materialRecordId: target.id,
      kind: target.kind,
      identifier: target.identifier,
      title: target.title,
      quantity,
      unit: { code: 'mL', symbol: 'mL' },
      observedAt,
    })
    const materials = await block(
      a,
      experiment.id,
      'materials',
      {
        items: [
          item(sample, 'sample-item'),
          item(reagent, 'reagent-item', 2),
          item(archived, 'archived-item', 3),
        ],
      },
      1,
    )
    const { rows: links } = await a.query(
      `SELECT target_record_id,link_type,created_by_user_id FROM api.record_links WHERE source_record_id=$1 ORDER BY link_type,target_record_id`,
      [experiment.id],
    )
    expect(links.map((link) => link.link_type).sort()).toEqual([
      'reagent',
      'sample',
      'sample',
    ])
    expect(links.every((link) => link.created_by_user_id === USER_A)).toBe(true)

    const invalidTargets = [
      foreign,
      deleted,
      { ...sample, id: '00000000-0000-4000-8000-000000000000' },
    ]
    for (const target of invalidTargets) {
      await expect(
        block(
          a,
          experiment.id,
          'materials',
          { items: [item(target, `bad-${target.id}`)] },
          20 + invalidTargets.indexOf(target),
        ),
      ).rejects.toMatchObject({ code: '23514' })
    }
    const changed = (
      await a.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{items,0,quantity}','5') WHERE id=$1 RETURNING payload`,
        [materials.id],
      )
    ).rows[0].payload.items[0]
    expect(changed).toEqual(item(sample, 'sample-item', 5))
    await expect(
      a.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{items,0,title}',to_jsonb('Forged'::text)) WHERE id=$1`,
        [materials.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps captured material identity editable after its record is renamed, archived, and deleted', async () => {
    const a = await authenticated(USER_A, WS_A)
    const experiment = await record(
      a,
      PROJECT_A,
      'experiment',
      'Durable material run',
    )
    const sample = await record(a, PROJECT_A, 'sample', 'Original sample')
    const observedAt = '2026-07-21T12:34:56.000Z'
    const captured = {
      id: 'durable-item',
      materialRecordId: sample.id,
      kind: sample.kind,
      identifier: sample.identifier,
      title: sample.title,
      quantity: 1,
      unit: { code: 'g', symbol: 'g' },
      observedAt,
    }
    const materials = await block(
      a,
      experiment.id,
      'materials',
      { items: [captured] },
      1,
    )

    await a.query(
      `UPDATE api.records SET title='Renamed sample',archived_at=now(),deleted_at=now() WHERE id=$1`,
      [sample.id],
    )
    const item = (
      await a.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{items,0,quantity}','2') WHERE id=$1 RETURNING payload`,
        [materials.id],
      )
    ).rows[0].payload.items[0]
    expect(item).toMatchObject({
      quantity: 2,
      title: captured.title,
      identifier: captured.identifier,
      observedAt,
    })
  })

  it('does not leave pinning artifacts when the experiment is soft-deleted', async () => {
    const a = await authenticated(USER_A, WS_A)
    const protocol = await record(
      a,
      PROJECT_A,
      'protocol_template',
      'Unpinned protocol',
    )
    await block(
      a,
      protocol.id,
      'procedure_step',
      { text: 'Never copied', stepNumber: 1 },
      1,
    )
    const experiment = await record(a, PROJECT_A, 'experiment', 'Deleted run')
    const pin = await block(a, experiment.id, 'protocol_reference', {}, 1)
    await a.query(`UPDATE api.records SET deleted_at=now() WHERE id=$1`, [
      experiment.id,
    ])

    await expect(
      a.query(`SELECT api.pin_protocol_reference($1,$2,$3,$4)`, [
        pin.id,
        protocol.id,
        pin.version,
        experiment.structure_version,
      ]),
    ).rejects.toMatchObject({ code: '42501' })

    const {
      rows: [artifacts],
    } = await migrator.query(
      `SELECT
         (SELECT count(*)::int FROM api.revisions WHERE record_id=$1) revisions,
         (SELECT count(*)::int FROM api.record_links WHERE source_record_id=$2 AND link_type='protocol') links,
         (SELECT count(*)::int FROM api.blocks WHERE record_id=$2 AND type='procedure_step') copied_steps`,
      [protocol.id, experiment.id],
    )
    expect(artifacts).toEqual({ revisions: 0, links: 0, copied_steps: 0 })
  })

  it('pins twelve ordered steps without colliding with existing block order', async () => {
    const a = await authenticated(USER_A, WS_A)
    const protocol = await record(
      a,
      PROJECT_A,
      'protocol_template',
      'Long protocol',
    )
    for (let index = 0; index < 12; index += 1) {
      await block(
        a,
        protocol.id,
        'procedure_step',
        {
          text: `Step ${index + 1}`,
          stepNumber: index + 1,
        },
        (index + 1) * 10,
      )
    }
    const experiment = await record(a, PROJECT_A, 'experiment', 'Long run')
    await block(a, experiment.id, 'rich_text', { type: 'doc', content: [] }, 1)
    const pin = await block(a, experiment.id, 'protocol_reference', {}, 2)
    await block(
      a,
      experiment.id,
      'rich_text',
      { type: 'doc', content: [] },
      1000001,
    )

    const {
      rows: [{ result }],
    } = await a.query(`SELECT api.pin_protocol_reference($1,$2,$3,$4) result`, [
      pin.id,
      protocol.id,
      pin.version,
      experiment.structure_version,
    ])
    expect(result.copied_steps.map((step: any) => step.payload.text)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Step ${index + 1}`),
    )
    const { rows } = await a.query(
      `SELECT id,type,"order" FROM api.blocks WHERE record_id=$1 ORDER BY "order",id`,
      [experiment.id],
    )
    expect(new Set(rows.map((row) => row.order)).size).toBe(rows.length)
    expect(rows.map((row) => row.id)).toEqual([
      rows[0].id,
      pin.id,
      ...result.copied_steps.map((step: any) => step.id),
      rows.at(-1).id,
    ])
    expect(rows[0].type).toBe('rich_text')
    expect(rows.at(-1).type).toBe('rich_text')
  })

  it('rejects api_client material writes while allowing unrelated rich text writes', async () => {
    const a = await authenticated(USER_A, WS_A)
    const experiment = await record(
      a,
      PROJECT_A,
      'experiment',
      'API client run',
    )
    const richText = await block(
      a,
      experiment.id,
      'rich_text',
      { type: 'doc', content: [] },
      1,
    )
    const materials = await block(
      a,
      experiment.id,
      'materials',
      { items: [] },
      2,
    )
    const apiClient = await asRole('authenticator')
    clients.push(apiClient)
    await apiClient.query('SET ROLE api_client')
    await apiClient.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ workspace_id: WS_A, role: 'api_client' }),
    ])

    await expect(
      block(apiClient, experiment.id, 'materials', { items: [] }, 3),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      apiClient.query(
        `UPDATE api.blocks SET payload=payload || '{"attempt":true}'::jsonb WHERE id=$1`,
        [materials.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    const payload = { type: 'doc', content: [{ type: 'paragraph' }] }
    const updated = await apiClient.query(
      `UPDATE api.blocks SET payload=$2::jsonb WHERE id=$1 RETURNING payload`,
      [richText.id, JSON.stringify(payload)],
    )
    expect(updated.rows[0].payload).toEqual(payload)
  })
})
