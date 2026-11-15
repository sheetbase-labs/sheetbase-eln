/**
 * Importing a protocol written elsewhere: one draft protocol with its steps,
 * reagents and source, the events, and who may do it.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c901'
const OTHER_WS = '00000000-0000-4000-8000-00000000c902'
const WRITER = 'pi-writer'
const VIEWER = 'pi-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const id of [WRITER, VIEWER]) {
    await migrator.query(
      `INSERT INTO internal."user" (id, name, email, "emailVerified")
       VALUES ($1, $1, $1 || '@pi.test', true)`,
      [id],
    )
  }
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pi-ws', 'PI workspace'), ('${OTHER_WS}', 'pi-other', 'PI other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${WRITER}', 'member'), ('${WS}', '${VIEWER}', 'viewer')`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

const steps = JSON.stringify([
  { text: 'Dilute the dye 1:200 in TE.', section: 'Prepare' },
  { text: 'Add 100 µL to each well.', section: 'Prepare' },
  { text: 'Read at 480/520 nm.', section: 'Read' },
])

const source = JSON.stringify({
  provider: 'protocols.io',
  url: 'https://www.protocols.io/view/picogreen-abc',
  doi: '10.17504/protocols.io.abc',
})

describe('import_protocol', () => {
  it('makes a draft protocol with steps, reagents and its source', async () => {
    const client = await as(WRITER)

    const { rows } = await client.query(
      `SELECT api.import_protocol($1, 'PicoGreen DNA assay', $2::jsonb,
         E'Quantify dsDNA.\n\nUse black plates.', ARRAY['Quant-iT PicoGreen (Thermo Fisher, P7589)'], $3::jsonb) AS r`,
      [WS, steps, source],
    )

    const result = rows[0].r
    expect(result.steps).toBe(3)
    expect(result.record.kind).toBe('protocol_template')
    expect(result.record.status).toBe('draft')

    const blocks = await migrator.query(
      `SELECT type, payload FROM api.blocks WHERE record_id = $1 ORDER BY "order"`,
      [result.record.id],
    )

    expect(blocks.rows.map((b) => b.type)).toEqual([
      'rich_text', // source line and two paragraphs
      'rich_text', // reagents
      'rich_text', // section heading: Prepare
      'procedure_step',
      'procedure_step',
      'rich_text', // section heading: Read
      'procedure_step',
    ])

    expect(
      blocks.rows
        .filter((b) => b.type === 'procedure_step')
        .map((b) => b.payload.stepNumber),
    ).toEqual([1, 2, 3])

    const intro = blocks.rows[0].payload.doc.content
    expect(intro).toHaveLength(3)
    expect(intro[0].content[0].text).toContain('Imported from protocols.io')
    expect(intro[0].content[0].text).toContain('10.17504/protocols.io.abc')
  })

  it('sends protocol.imported and record.created', async () => {
    const events = await migrator.query(
      `SELECT entity_type, operation, payload FROM api.change_events
        WHERE workspace_id = $1 AND (entity_type = 'protocol_import' OR (entity_type = 'record' AND operation = 'create'))`,
      [WS],
    )

    const imported = events.rows.find(
      (e) => e.entity_type === 'protocol_import',
    )
    expect(imported?.payload.provider).toBe('protocols.io')
    expect(imported?.payload.steps).toBe(3)
  })

  it('refuses a viewer, a workspace that is not yours, and bad input', async () => {
    const viewer = await as(VIEWER)
    await expectDenied(
      viewer.query(`SELECT api.import_protocol($1, 'X', $2::jsonb)`, [
        WS,
        steps,
      ]),
      '42501',
    )

    const writer = await as(WRITER)
    await expectDenied(
      writer.query(`SELECT api.import_protocol($1, 'X', $2::jsonb)`, [
        OTHER_WS,
        steps,
      ]),
      'SB033',
    )
    await expectDenied(
      writer.query(`SELECT api.import_protocol($1, '', $2::jsonb)`, [
        WS,
        steps,
      ]),
      'SB034',
    )
    await expectDenied(
      writer.query(`SELECT api.import_protocol($1, 'X', '[]'::jsonb)`, [WS]),
      'SB034',
    )
    await expectDenied(
      writer.query(
        `SELECT api.import_protocol($1, 'X', '[{"text":" "}]'::jsonb)`,
        [WS],
      ),
      'SB034',
    )
  })
})
