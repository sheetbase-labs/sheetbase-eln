/**
 * The search index (api.search_documents): who can see which rows, what each
 * block type contributes, that renames reach the notebooks that mention them,
 * the query syntax, and the filter tree.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BLOCK_TYPES } from '#/lib/blocks/registry'

import { prepareTestDatabase } from './helpers'

const WS = '0d052000-0000-4000-8000-00000000000a'
const OPEN = '0d052000-0000-4000-8000-0000000001a1'
const CLOSED = '0d052000-0000-4000-8000-0000000001a2'
const ADMIN = 'si-admin'
const AUTHOR = 'si-author'
const MEMBER = 'si-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function ids(
  client: Client,
  query: string,
  extra = '',
): Promise<string[]> {
  const { rows } = await client.query<{ identifier: string }>(
    `select identifier from api.search(p_query := $1::text${extra}, p_limit := 100)`,
    [query],
  )
  return rows.map((r) => r.identifier).sort()
}

async function record(
  identifier: string,
  title: string,
  opts: { project?: string; kind?: string; status?: string; by?: string } = {},
): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      WS,
      opts.project ?? null,
      opts.kind ?? 'experiment',
      identifier,
      title,
      opts.status ?? 'in_progress',
      opts.by ?? ADMIN,
    ],
  )
  return rows[0].id
}

async function block(
  recordId: string,
  type: string,
  payload: unknown,
  order = 1,
): Promise<void> {
  await migrator.query(
    `insert into api.blocks(record_id,type,payload,"order",created_by_user_id) values($1,$2,$3::jsonb,$4,$5)`,
    [recordId, type, JSON.stringify(payload), order, ADMIN],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const u of [ADMIN, AUTHOR, MEMBER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [u, `${u}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'si','Search index')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'owner'),($1,$3,'member'),($1,$4,'member')`,
    [WS, ADMIN, AUTHOR, MEMBER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
       ($1,$3,'SIA','Open project',$4),($2,$3,'SIB','Closed project',$4)`,
    [OPEN, CLOSED, WS, ADMIN],
  )
  // Everyone sees the open project; only the admin sees the closed one.
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,granted_by_user_id)
     values($1,$2,$3,true,$3),($1,$2,$4,true,$3),($1,$2,$5,true,$3),($1,$6,$3,true,$3)
     on conflict do nothing`,
    [WS, OPEN, ADMIN, AUTHOR, MEMBER, CLOSED],
  )
})

afterAll(async () => {
  for (const c of clients) await c.end()
  await migrator.end()
})

describe('visibility mirrors the source tables', () => {
  let draft: string
  beforeAll(async () => {
    await record('SI-OPEN-1', 'Quokka assay open', { project: OPEN })
    await record('SI-CLOSED-1', 'Quokka assay closed', { project: CLOSED })
    draft = await record('SI-DRAFT-1', 'Quokka draft notebook', {
      project: OPEN,
      status: 'draft',
      by: AUTHOR,
    })
    const author = await actor(AUTHOR)
    await author.query(
      `select api.create_record_comment($1, 'record', '{}'::jsonb, 'quokka comment on the draft')`,
      [draft],
    )
  })

  it('shows a member without access to a project nothing from it', async () => {
    const member = await actor(MEMBER)
    expect(await ids(member, 'quokka')).toEqual(['SI-OPEN-1'])
  })

  it('shows a draft experiment, and the comments on it, to its author only', async () => {
    const author = await actor(AUTHOR)
    const found = await ids(author, 'quokka')
    expect(found).toContain('SI-DRAFT-1')
    const { rows } = await author.query(
      `select 1 from api.search(p_query := 'quokka comment', p_result_type := 'comment')`,
    )
    expect(rows).toHaveLength(1)
    const member = await actor(MEMBER)
    const { rows: hidden } = await member.query(
      `select 1 from api.search(p_query := 'quokka comment', p_result_type := 'comment')`,
    )
    expect(hidden).toHaveLength(0)
  })

  it('shows an admin everything', async () => {
    const admin = await actor(ADMIN)
    expect((await ids(admin, 'quokka')).filter(Boolean)).toEqual([
      'SI-CLOSED-1',
      'SI-DRAFT-1',
      'SI-OPEN-1',
    ])
  })

  it('does not index email addresses', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'test.invalid')).toEqual([])
  })
})

describe('what each block type contributes', () => {
  const SAMPLES: Record<string, unknown> = {
    rich_text: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'zebrafinch ' },
              { type: 'text', text: 'incubation', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      },
    },
    checklist: { items: [{ text: 'zebrafinch item', checked: false }] },
    linked_record: {
      targetKind: 'sample',
      targetIdentifier: 'SMP-ZEBRA',
      linkType: 'uses',
      label: 'zebrafinch sample',
    },
    callout: { text: 'zebrafinch warning', variant: 'warning' },
    conclusion: { text: 'zebrafinch result', verdict: 'supported' },
    table: { columns: ['zebrafinch col'], rows: [['cell value']] },
    sheet: { instanceId: '0d052000-0000-4000-8000-0000000000ff' },
    chart: { title: 'zebrafinch chart', spec: {} },
    analysis: { title: 'zebrafinch analysis' },
    plate_map: {
      title: 'zebrafinch plate',
      spec: { wells: [{ wellCode: 'A1', role: 'blank' }] },
    },
    file: {
      fileRecordId: '0d052000-0000-4000-8000-0000000000fe',
      fileIdentifier: 'FILE-ZEBRA',
      displayName: 'zebrafinch.csv',
      mediaType: 'text/csv',
      byteSize: 1,
    },
    metric: { label: 'zebrafinch yield', value: 4, unit: '%' },
    procedure_step: { text: 'zebrafinch step', note: 'done' },
    protocol_reference: {
      protocolIdentifier: 'PRT-ZEBRA',
      protocolTitle: 'zebrafinch protocol',
      version: '2',
      approvalStatus: 'approved',
    },
    materials: {
      items: [
        { identifier: 'MAT-ZEBRA', title: 'zebrafinch buffer', unit: { symbol: 'mL' } },
      ],
    },
    pipeline_output: { label: 'zebrafinch output' },
    signature_request: { requestedUserName: 'zebrafinch signer', meaning: 'reviewed', note: '' },
    corrective_actions: { items: [{ action: 'zebrafinch fix', ownerName: 'Pat', status: 'open' }] },
    dataset_import: { sheetName: 'zebrafinch sheet' },
  }

  it('has a sample for every block type', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...BLOCK_TYPES].sort())
  })

  it.each(BLOCK_TYPES.map((t) => [t]))('%s yields readable text', async (type) => {
    const { rows } = await migrator.query<{ t: string }>(
      `select internal.block_search_text($1, $2::jsonb) t`,
      [type, JSON.stringify(SAMPLES[type])],
    )
    const text = rows[0].t
    // Sheet and file blocks name rows that do not exist here; every other
    // type reads its words straight from the payload.
    if (type !== 'sheet') expect(text.toLowerCase()).toContain(type === 'dataset_import' || type === 'pipeline_output' ? 'zebrafinch' : type === 'linked_record' ? 'smp-zebra' : 'zebra')
    // Keys and node names are structure, not words.
    expect(text).not.toMatch(/\b(paragraph|doc|payload|targetKind|marks)\b/)
  })

  it('reads a rich-text paragraph the way it is written', async () => {
    const { rows } = await migrator.query<{ t: string }>(
      `select internal.block_search_text('rich_text', $1::jsonb) t`,
      [JSON.stringify(SAMPLES.rich_text)],
    )
    expect(rows[0].t).toBe('zebrafinch incubation')
  })

  it('falls back to string values for an unknown type', async () => {
    const { rows } = await migrator.query<{ t: string }>(
      `select internal.block_search_text('quantum_state', '{"label":"entangled"}'::jsonb) t`,
    )
    expect(rows[0].t).toBe('entangled')
  })
})

describe('keeping the index current', () => {
  it('finds a notebook by its block text and by a renamed link target', async () => {
    const target = await record('SI-TGT-1', 'Original target name', { project: OPEN })
    const nb = await record('SI-NB-1', 'Notebook with a link', { project: OPEN })
    await block(nb, 'linked_record', {
      targetKind: 'sample',
      targetIdentifier: 'SI-TGT-1',
      linkType: 'uses',
      targetId: target,
    })
    await block(
      nb,
      'rich_text',
      { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ocelot lysate' }] }] } },
      2,
    )
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'ocelot')).toEqual(['SI-NB-1'])
    expect(await ids(admin, 'Original')).toContain('SI-NB-1')

    await migrator.query(`update api.records set title = 'Renamed marmoset target' where id = $1`, [target])
    expect(await ids(admin, 'marmoset')).toEqual(['SI-NB-1', 'SI-TGT-1'])
    expect(await ids(admin, 'Original')).toEqual([])
  })

  it('drops a deleted record from the index', async () => {
    const r = await record('SI-DEL-1', 'Platypus to delete', { project: OPEN })
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'platypus')).toEqual(['SI-DEL-1'])
    await migrator.query(`update api.records set deleted_at = now() where id = $1`, [r])
    expect(await ids(admin, 'platypus')).toEqual([])
  })

  it('rebuilds to the same rows (the backfill and the triggers agree)', async () => {
    const before = await migrator.query(
      `select object_type, object_id, tsv::text, body from api.search_documents order by 1, 2`,
    )
    await migrator.query(`select internal.search_reindex_all()`)
    const after = await migrator.query(
      `select object_type, object_id, tsv::text, body from api.search_documents order by 1, 2`,
    )
    expect(after.rows).toEqual(before.rows)
  })
})

describe('the query', () => {
  beforeAll(async () => {
    await record('DS-0311-X', 'Chromatography fractions', { project: OPEN })
    await record('SI-Q-2', 'Buffer exchange with tris', { project: OPEN })
    await record('SI-Q-3', 'Buffer exchange only', { project: OPEN })
    await record('SI-Q-4', 'Tris alone', { project: OPEN })
  })

  it('excludes a -word', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'buffer -tris')).toEqual(['SI-Q-3'])
  })

  it('reads OR', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'buffer OR tris')).toEqual(['SI-Q-2', 'SI-Q-3', 'SI-Q-4'])
  })

  it('reads a quoted phrase', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, '"buffer exchange"')).toEqual(['SI-Q-2', 'SI-Q-3'])
  })

  it('matches the word being typed as a prefix', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'chrom')).toEqual(['DS-0311-X'])
  })

  it('finds an identifier from its first characters', async () => {
    const admin = await actor(ADMIN)
    expect(await ids(admin, 'DS-03')).toEqual(['DS-0311-X'])
    expect(await ids(admin, '0311')).toEqual(['DS-0311-X'])
  })

  it('browses by recency when the query is empty', async () => {
    const admin = await actor(ADMIN)
    const { rows } = await admin.query(`select 1 from api.search(p_query := '', p_limit := 5)`)
    expect(rows).toHaveLength(5)
  })
})

describe('the filter tree', () => {
  const group = (combinator: string, ...children: unknown[]) => ({
    type: 'group',
    combinator,
    children,
  })
  const cond = (field: string, operator: string, value?: unknown) => ({
    type: 'condition',
    field,
    operator,
    value,
  })

  async function filtered(filter: unknown, query = 'buffer'): Promise<string[]> {
    const admin = await actor(ADMIN)
    const { rows } = await admin.query<{ identifier: string }>(
      `select identifier from api.search(p_query := $1::text, p_filter := $2::jsonb, p_limit := 100)`,
      [query, JSON.stringify(filter)],
    )
    return rows.map((r) => r.identifier).sort()
  }

  it('combines AND, OR and NOT', async () => {
    expect(await filtered(group('AND', cond('type', 'eq', 'record'), cond('kind', 'eq', 'experiment')))).toEqual(['SI-Q-2', 'SI-Q-3'])
  })

  it('NOT means none of the children match', async () => {
    expect(await filtered(group('NOT', cond('status', 'eq', 'in_progress')))).toEqual([])
    expect(await filtered(group('OR', cond('status', 'eq', 'nope'), cond('project', 'eq', OPEN)))).toEqual(['SI-Q-2', 'SI-Q-3'])
  })

  it('filters on tags, dates, archived and fields', async () => {
    await migrator.query(`update api.records set tags = array['wet-lab'] where identifier = 'SI-Q-2'`)
    expect(await filtered(cond('tags', 'eq', 'wet-lab'))).toEqual(['SI-Q-2'])
    expect(await filtered(cond('updated', 'withinLastDays', 1))).toEqual(['SI-Q-2', 'SI-Q-3'])
    expect(await filtered(cond('created', 'lt', '2000-01-01'))).toEqual([])
    expect(await filtered(cond('archived', 'eq', false))).toEqual(['SI-Q-2', 'SI-Q-3'])
    expect(await filtered(cond('fields.locked', 'eq', false))).toEqual(['SI-Q-2', 'SI-Q-3'])
  })

  it('treats an empty group as no filter', async () => {
    expect(await filtered(group('AND'))).toEqual(['SI-Q-2', 'SI-Q-3'])
  })

  it.each([
    ['unknown field', cond('password', 'eq', 'x')],
    ['unknown operator', cond('status', 'drop', 'x')],
    ['unknown combinator', group('XOR', cond('status', 'eq', 'x'))],
    ['a bad date', cond('created', 'gt', 'tomorrow-ish')],
    ['a quote that tries to escape', cond('fields.a\'b', 'eq', 'x')],
  ])('rejects %s with 22023', async (_name, filter) => {
    const admin = await actor(ADMIN)
    await expect(
      admin.query(`select * from api.search(p_query := 'buffer', p_filter := $1::jsonb)`, [JSON.stringify(filter)]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('rejects a filter that nests too deep or has too many conditions', async () => {
    let deep: unknown = cond('status', 'eq', 'x')
    for (let i = 0; i < 6; i++) deep = group('AND', deep)
    const admin = await actor(ADMIN)
    await expect(
      admin.query(`select * from api.search(p_filter := $1::jsonb)`, [JSON.stringify(deep)]),
    ).rejects.toMatchObject({ code: '22023' })
    const wide = group('AND', ...Array.from({ length: 51 }, () => cond('status', 'eq', 'x')))
    await expect(
      admin.query(`select * from api.search(p_filter := $1::jsonb)`, [JSON.stringify(wide)]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('keeps a value from becoming SQL', async () => {
    const ok = await filtered(cond('kind', 'eq', "x'; drop table api.records; --"))
    expect(ok).toEqual([])
    const admin = await actor(ADMIN)
    const { rows } = await admin.query(`select count(*)::int n from api.records`)
    expect(rows[0].n).toBeGreaterThan(0)
  })
})

describe('facets', () => {
  it('add up to the search total for text, filtered and browse queries', async () => {
    const admin = await actor(ADMIN)
    const filter = JSON.stringify({
      type: 'group',
      combinator: 'NOT',
      children: [{ type: 'condition', field: 'project', operator: 'eq', value: CLOSED }],
    })
    for (const q of ['quokka', 'buffer OR tris', 'chrom', '']) {
      const { rows: total } = await admin.query<{ n: string }>(
        `select coalesce(max(total_count), 0) n from api.search(p_query := $1::text, p_filter := $2::jsonb, p_limit := 1)`,
        [q, filter],
      )
      const { rows: facets } = await admin.query<{ n: string }>(
        `select coalesce(sum(match_count), 0) n from api.search_facets(p_query := $1::text, p_filter := $2::jsonb)`,
        [q, filter],
      )
      expect(Number(facets[0].n), q).toBe(Number(total[0].n))
    }
  })
})
