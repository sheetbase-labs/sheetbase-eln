/**
 * MODEL-03 integration proof: model relationship rules — stewardship,
 * workspace isolation, and link-creation enforcement (SB080/SB081) over
 * the create_record_link RPC, direct inserts, and the dedupe-upsert path.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000210a'
const WS_B = '00000000-0000-4000-8000-00000000210b'
const PROJ_A = '00000000-0000-4000-8000-00000000211a'
const PROJ_B = '00000000-0000-4000-8000-00000000211b'
const OWNER_A = 'model-rel-owner-a'
const MEMBER_A = 'model-rel-member-a'
const OWNER_B = 'model-rel-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record($1::uuid, $2, $3, 'draft', ARRAY[]::text[], '{}'::jsonb, '{}'::jsonb)`,
    [project, kind, title],
  )
  return rows[0]
}

async function configureRule(
  client: Client,
  source: string,
  linkType: string,
  target: string,
  min = 0,
  max: number | null = null,
  label: string | null = null,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.configure_model_relationship_rule($1, $2, $3, $4, $5, $6, $7)`,
    [WS_A, source, linkType, target, min, max, label],
  )
  return rows[0]
}

async function createLink(
  client: Client,
  sourceId: string,
  target: {
    kind: string
    identifier: string
    id: string | null
    linkType: string
  },
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record_link($1, $2, $3, $4, $5, NULL)`,
    [sourceId, target.kind, target.identifier, target.linkType, target.id],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'Rel Owner A', 'rel-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'Rel Member A', 'rel-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'Rel Owner B', 'rel-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'model-rel-a', 'Model Rel A'),
      ('${WS_B}', 'model-rel-b', 'Model Rel B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'), ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'rel-a', 'Rel A'),
      ('${PROJ_B}', '${WS_B}', 'rel-b', 'Rel B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('rule stewardship', () => {
  it('lets owners declare rules and rejects malformed declarations with SB071', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const rule = await configureRule(
      owner,
      'experiment',
      'sample',
      'sample',
      1,
      2,
      'consumes',
    )
    expect(rule).toMatchObject({
      source_model_key: 'experiment',
      link_type: 'sample',
      target_model_key: 'sample',
      min_links: 1,
      max_links: 2,
      label: 'consumes',
    })
    // Upsert: re-declaring the same scope updates the bounds.
    const updated = await configureRule(
      owner,
      'experiment',
      'sample',
      'sample',
      0,
      2,
      null,
    )
    expect(updated.id).toBe(rule.id)
    expect(updated.min_links).toBe(0)
    // Unknown link vocabulary, non-record-backed target, inverted bounds.
    await expect(
      configureRule(owner, 'experiment', 'custom', 'sample'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      configureRule(owner, 'experiment', 'sample', 'project'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      configureRule(owner, 'project', 'sample', 'sample'),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      configureRule(owner, 'experiment', 'sample', 'sample', 3, 2),
    ).rejects.toMatchObject({ code: 'SB071' })
    await owner.query(`SELECT api.remove_model_relationship_rule($1)`, [
      rule.id,
    ])
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM api.model_relationship_rules`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('restricts management to owners/admins and isolates workspaces', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const member = await asAuthenticated(MEMBER_A, WS_A)
    const other = await asAuthenticated(OWNER_B, WS_B)
    await expect(
      configureRule(member, 'experiment', 'sample', 'sample'),
    ).rejects.toMatchObject({ code: '42501' })
    const rule = await configureRule(owner, 'experiment', 'sample', 'sample')
    // Members read their workspace rules; other workspaces see nothing.
    expect(
      (await member.query(`SELECT id FROM api.model_relationship_rules`)).rows,
    ).toHaveLength(1)
    expect(
      (await other.query(`SELECT id FROM api.model_relationship_rules`)).rows,
    ).toHaveLength(0)
    await expect(
      other.query(`SELECT api.remove_model_relationship_rule($1)`, [rule.id]),
    ).rejects.toMatchObject({
      code: '42501',
    })
    await owner.query(`SELECT api.remove_model_relationship_rule($1)`, [
      rule.id,
    ])
  })
})

describe('link enforcement', () => {
  it('allows declared pairs, rejects everything else with SB080, and caps counts with SB081', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await configureRule(owner, 'experiment', 'sample', 'sample', 0, 2)
    const exp = await createRecord(owner, PROJ_A, 'experiment', 'Capped source')
    const s1 = await createRecord(owner, PROJ_A, 'sample', 'S1')
    const s2 = await createRecord(owner, PROJ_A, 'sample', 'S2')
    const s3 = await createRecord(owner, PROJ_A, 'sample', 'S3')
    const reagent = await createRecord(owner, PROJ_A, 'reagent', 'R1')
    const protocol = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'P1',
    )
    await createLink(owner, exp.id, {
      kind: 'sample',
      identifier: s1.identifier,
      id: s1.id,
      linkType: 'sample',
    })
    await createLink(owner, exp.id, {
      kind: 'sample',
      identifier: s2.identifier,
      id: s2.id,
      linkType: 'sample',
    })
    // Third sample edge exceeds the maximum.
    await expect(
      createLink(owner, exp.id, {
        kind: 'sample',
        identifier: s3.identifier,
        id: s3.id,
        linkType: 'sample',
      }),
    ).rejects.toMatchObject({ code: 'SB081' })
    // Unlisted target model for the constrained model fails closed.
    await expect(
      createLink(owner, exp.id, {
        kind: 'reagent',
        identifier: reagent.identifier,
        id: reagent.id,
        linkType: 'sample',
      }),
    ).rejects.toMatchObject({ code: 'SB080' })
    // Undeclared link types fail closed too once the model has any rule.
    await expect(
      createLink(owner, exp.id, {
        kind: 'protocol_template',
        identifier: protocol.identifier,
        id: protocol.id,
        linkType: 'protocol',
      }),
    ).rejects.toMatchObject({ code: 'SB080' })
  })

  it('leaves models without rules unrestricted', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createRecord(owner, PROJ_A, 'sample', 'Free source')
    const reagent = await createRecord(owner, PROJ_A, 'reagent', 'Free target')
    const link = await createLink(owner, sample.id, {
      kind: 'reagent',
      identifier: reagent.identifier,
      id: reagent.id,
      linkType: 'reagent',
    })
    expect(link.target_record_id).toBe(reagent.id)
  })

  it('enforces rules on direct inserts and identifier-only links', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await configureRule(owner, 'experiment', 'reagent', 'reagent', 0, 1)
    const exp = await createRecord(owner, PROJ_A, 'experiment', 'Direct source')
    const reagent = await createRecord(
      owner,
      PROJ_A,
      'reagent',
      'Direct target',
    )
    const sample = await createRecord(owner, PROJ_A, 'sample', 'Direct sample')
    // Direct PostgREST-style insert of a disallowed pair fails closed.
    await expect(
      owner.query(
        `INSERT INTO api.record_links(source_record_id, target_record_id, target_kind, target_identifier, link_type, created_by_user_id)
         VALUES ($1, $2, 'sample', $3, 'reagent', $4)`,
        [exp.id, sample.id, sample.identifier, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: 'SB080' })
    // Identifier-only link resolving to an allowed model succeeds.
    const { rows } = await owner.query(
      `SELECT * FROM api.create_record_link($1, 'reagent', $2, 'reagent', NULL, NULL)`,
      [exp.id, reagent.identifier],
    )
    expect(rows[0].target_record_id).toBeNull()
    // Identifier-only link to an unlisted model fails closed.
    await expect(
      owner.query(
        `SELECT * FROM api.create_record_link($1, 'mystery', 'X-1', 'reagent', NULL, NULL)`,
        [exp.id],
      ),
    ).rejects.toMatchObject({ code: 'SB080' })
  })

  it('does not count re-links of the same edge against the maximum', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createRecord(owner, PROJ_A, 'experiment', 'Dedupe source')
    const s1 = await createRecord(owner, PROJ_A, 'sample', 'D1')
    const s2 = await createRecord(owner, PROJ_A, 'sample', 'D2')
    await configureRule(owner, 'experiment', 'sample', 'sample', 0, 2)
    await createLink(owner, exp.id, {
      kind: 'sample',
      identifier: s1.identifier,
      id: s1.id,
      linkType: 'sample',
    })
    await createLink(owner, exp.id, {
      kind: 'sample',
      identifier: s2.identifier,
      id: s2.id,
      linkType: 'sample',
    })
    // Materials/plate/template dedupe upsert of an existing edge at the cap.
    const { rows } = await owner.query(
      `INSERT INTO api.record_links(source_record_id, target_record_id, target_kind, target_identifier, link_type, created_by_user_id)
       VALUES ($1, $2, 'sample', $3, 'sample', $4)
       ON CONFLICT (source_record_id, target_identifier, link_type)
       DO UPDATE SET target_record_id=EXCLUDED.target_record_id RETURNING id`,
      [exp.id, s1.id, s1.identifier, OWNER_A],
    )
    expect(rows).toHaveLength(1)
    // True duplicates still hit the dedupe constraint, not the cap.
    await expect(
      owner.query(
        `INSERT INTO api.record_links(source_record_id, target_record_id, target_kind, target_identifier, link_type, created_by_user_id)
         VALUES ($1, $2, 'sample', $3, 'sample', $4)`,
        [exp.id, s1.id, s1.identifier, OWNER_A],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('keeps archived-target linking behaviour unchanged for allowed pairs', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await configureRule(owner, 'experiment', 'sample', 'sample')
    const exp = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Archive source',
    )
    const sample = await createRecord(owner, PROJ_A, 'sample', 'Archive target')
    await owner.query(`SELECT * FROM api.archive_record($1, $2)`, [
      sample.id,
      sample.metadata_version,
    ])
    const link = await createLink(owner, exp.id, {
      kind: 'sample',
      identifier: sample.identifier,
      id: sample.id,
      linkType: 'sample',
    })
    expect(link.target_record_id).toBe(sample.id)
  })

  it('still rejects cross-workspace targets with SB002 when no rules apply', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const other = await asAuthenticated(OWNER_B, WS_B)
    // `report` never carries rules in this suite, so the cross-workspace
    // rejection keeps its established SB002 code.
    const report = await createRecord(owner, PROJ_A, 'report', 'Cross source')
    const cross = await createRecord(other, PROJ_B, 'sample', 'Cross target')
    await expect(
      createLink(owner, report.id, {
        kind: 'sample',
        identifier: cross.identifier,
        id: cross.id,
        linkType: 'general',
      }),
    ).rejects.toMatchObject({ code: 'SB002' })
    // A constrained source model still fails the same attempt — the RPC's
    // same-workspace check runs before the insert, so SB002 keeps
    // precedence for id-addressed cross-workspace targets.
    const exp = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Cross constrained',
    )
    await expect(
      createLink(owner, exp.id, {
        kind: 'sample',
        identifier: cross.identifier,
        id: cross.id,
        linkType: 'sample',
      }),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('serializes concurrent inserts under max_links so the bound holds', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await configureRule(owner, 'experiment', 'sample', 'sample', 0, 1)
    const exp = await createRecord(owner, PROJ_A, 'experiment', 'Race source')
    const s1 = await createRecord(owner, PROJ_A, 'sample', 'Race S1')
    const s2 = await createRecord(owner, PROJ_A, 'sample', 'Race S2')
    const a = await asAuthenticated(OWNER_A, WS_A)
    const b = await asAuthenticated(OWNER_A, WS_A)
    // Two open transactions racing the same bound: without serialization
    // both would count zero committed links and both would commit,
    // overshooting max_links.
    await a.query('BEGIN')
    await b.query('BEGIN')
    const { rows: first } = await a.query(
      `SELECT * FROM api.create_record_link($1, 'sample', $2, 'sample', $3, NULL)`,
      [exp.id, s1.identifier, s1.id],
    )
    expect(first).toHaveLength(1)
    // The loser blocks on the matched rule-row lock until the winner
    // commits, then recounts and fails closed with the named error.
    const loser = b.query(
      `SELECT * FROM api.create_record_link($1, 'sample', $2, 'sample', $3, NULL)`,
      [exp.id, s2.identifier, s2.id],
    )
    await a.query('COMMIT')
    await expect(loser).rejects.toMatchObject({ code: 'SB081' })
    await b.query('ROLLBACK')
    const { rows: counted } = await owner.query(
      `SELECT count(*)::int AS n FROM api.record_links WHERE source_record_id = $1 AND link_type = 'sample'`,
      [exp.id],
    )
    expect(counted[0].n).toBe(1)
  })
})
