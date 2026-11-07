/**
 * Search by meaning: vectors are only ever visible where the object they were
 * read from is, ranking returns the closest object once, and choosing where
 * text is sent needs a person's browser session.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000a410'
const PROJECT = '00000000-0000-4000-8000-00000000a411'
const HIDDEN_PROJECT = '00000000-0000-4000-8000-00000000a412'
const BLOT = '00000000-0000-4000-8000-00000000a420'
const CULTURE = '00000000-0000-4000-8000-00000000a421'
const SECRET = '00000000-0000-4000-8000-00000000a422'
const TWIN = '00000000-0000-4000-8000-00000000a423'
const OWNER = 'sem-owner'
const VIEWER = 'sem-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

/** A unit vector along axis `a`, tilted toward axis `b`, 1024 wide. */
function vec(a: number, b = a, tilt = 0): string {
  const out = new Array<number>(1024).fill(0)
  out[a] = Math.sqrt(1 - tilt * tilt)
  if (b !== a) out[b] = tilt
  return `[${out.join(',')}]`
}

async function store(
  id: string,
  chunk: number,
  text: string,
  vector: string,
): Promise<void> {
  await migrator.query(
    `INSERT INTO api.search_embeddings
       (workspace_id, object_type, object_id, chunk_no, chunk_text, text_hash, model_id, embedding)
     VALUES ($1, 'record', $2, $3, $4, 'h', 'test:model', $5::extensions.vector)`,
    [WS, id, chunk, text, vector],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Sem Owner', 'sem-owner@sheetbase.test', true),
      ('${VIEWER}', 'Sem Viewer', 'sem-viewer@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'sem-ws', 'Sem WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'), ('${WS}', '${VIEWER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'sem', 'Sem', '${OWNER}'),
      ('${HIDDEN_PROJECT}', '${WS}', 'semh', 'Hidden', '${OWNER}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: VIEWER,
    canView: true,
    canEdit: false,
  })
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id) VALUES
      ('${BLOT}', '${WS}', '${PROJECT}', 'experiment', 'EXP-S1', 'Western blot transfer', 'in_progress', '${OWNER}'),
      ('${CULTURE}', '${WS}', '${PROJECT}', 'experiment', 'EXP-S2', 'Cell culture passaging', 'in_progress', '${OWNER}'),
      ('${TWIN}', '${WS}', '${PROJECT}', 'experiment', 'EXP-S4', 'Blot transfer repeat', 'in_progress', '${OWNER}'),
      ('${SECRET}', '${WS}', '${HIDDEN_PROJECT}', 'experiment', 'EXP-S3', 'Hidden blot work', 'in_progress', '${OWNER}')`,
  )
  await store(
    BLOT,
    0,
    'EXP-S1 · Western blot transfer\nTransfer at 100 V',
    vec(0),
  )
  await store(
    BLOT,
    1,
    'EXP-S1 · Western blot transfer\nBlock in milk',
    vec(0, 2, 0.4),
  )
  await store(
    TWIN,
    0,
    'EXP-S4 · Blot transfer repeat\nSame transfer',
    vec(0, 2, 0.2),
  )
  await store(CULTURE, 0, 'EXP-S2 · Cell culture passaging\nSplit 1:5', vec(1))
  await store(
    SECRET,
    0,
    'EXP-S3 · Hidden blot work\nTransfer secrets',
    vec(0, 3, 0.05),
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function as(userId: string, session = true): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
      ...(session ? { session_id: 'sess-1' } : {}),
    }),
  ])
  return client
}

describe('api.semantic_search', () => {
  it('ranks the closest object first and returns each object once', async () => {
    const owner = await as(OWNER)
    const { rows } = await owner.query<{
      identifier: string
      similarity: number
      chunk_no: number
    }>(
      `SELECT identifier, similarity, chunk_no FROM api.semantic_search($1::real[], 10)`,
      [JSON.parse(vec(0))],
    )
    expect(rows.map((row) => row.identifier)).toEqual([
      'EXP-S1',
      'EXP-S3',
      'EXP-S4',
      'EXP-S2',
    ])
    expect(rows[0]).toMatchObject({ identifier: 'EXP-S1', chunk_no: 0 })
    expect(rows[0]!.similarity).toBeGreaterThan(0.99)
    expect(new Set(rows.map((row) => row.identifier)).size).toBe(rows.length)
  })

  it('never returns an object the caller cannot see', async () => {
    const viewer = await as(VIEWER)
    const { rows } = await viewer.query<{ identifier: string }>(
      `SELECT identifier FROM api.semantic_search($1::real[], 10)`,
      [JSON.parse(vec(0))],
    )
    expect(rows.map((row) => row.identifier)).not.toContain('EXP-S3')
    expect(rows.map((row) => row.identifier)).toContain('EXP-S1')
    const { rows: raw } = await viewer.query(
      `SELECT object_id FROM api.search_embeddings WHERE object_id = '${SECRET}'`,
    )
    expect(raw).toHaveLength(0)
  })

  it('rejects a vector of the wrong width', async () => {
    const owner = await as(OWNER)
    await expect(
      owner.query(`SELECT * FROM api.semantic_search(ARRAY[1,0]::real[], 5)`),
    ).rejects.toThrow(/1024/)
  })
})

describe('api.similar_work', () => {
  it('finds work that reads alike, without the object itself', async () => {
    const viewer = await as(VIEWER)
    const { rows } = await viewer.query<{ identifier: string }>(
      `SELECT identifier FROM api.similar_work('record', '${BLOT}', 5)`,
    )
    expect(rows[0]?.identifier).toBe('EXP-S4')
    expect(rows.map((row) => row.identifier)).not.toContain('EXP-S1')
    expect(rows.map((row) => row.identifier)).not.toContain('EXP-S3')
  })

  it('returns nothing for an object with no vectors', async () => {
    const owner = await as(OWNER)
    const { rows } = await owner.query(
      `SELECT * FROM api.similar_work('record', '${SECRET.replace('a422', 'ffff')}', 5)`,
    )
    expect(rows).toHaveLength(0)
  })
})

describe('semantic search settings', () => {
  it('needs a person in a browser session', async () => {
    const token = await as(OWNER, false)
    await expect(
      token.query(
        `SELECT api.set_semantic_search_settings('${WS}', true, 'local-embed', false)`,
      ),
    ).rejects.toThrow(/human session required/)
  })

  it('needs the owner', async () => {
    const member = await as(VIEWER)
    await expect(
      member.query(
        `SELECT api.set_semantic_search_settings('${WS}', true, 'local-embed', false)`,
      ),
    ).rejects.toThrow(/owner required/)
  })

  it('needs a profile to turn it on', async () => {
    const owner = await as(OWNER)
    await expect(
      owner.query(
        `SELECT api.set_semantic_search_settings('${WS}', true, null, false)`,
      ),
    ).rejects.toThrow(/choose an embeddings profile/)
  })

  it('drops the vectors when the model changes and reports progress', async () => {
    await migrator.query(
      `INSERT INTO api.workspace_settings (workspace_id, created_by_user_id) VALUES ('${WS}', '${OWNER}') ON CONFLICT DO NOTHING`,
    )
    const owner = await as(OWNER)
    const first = await owner.query<{ s: Record<string, unknown> }>(
      `SELECT api.set_semantic_search_settings('${WS}', true, 'local-embed', true) AS s`,
    )
    expect(first.rows[0]!.s).toMatchObject({
      enabled: true,
      profile: 'local-embed',
      literatureEnabled: true,
    })
    // First choice of profile starts from nothing: vectors written for no
    // profile are cleared.
    expect(first.rows[0]!.s).toMatchObject({ indexedDocuments: 0 })
    await store(BLOT, 0, 'x', vec(0))
    const same = await owner.query<{ s: Record<string, unknown> }>(
      `SELECT api.set_semantic_search_settings('${WS}', true, 'local-embed', true) AS s`,
    )
    expect(same.rows[0]!.s).toMatchObject({ indexedDocuments: 1 })
    const changed = await owner.query<{ s: Record<string, unknown> }>(
      `SELECT api.set_semantic_search_settings('${WS}', true, 'other-embed', true) AS s`,
    )
    expect(changed.rows[0]!.s).toMatchObject({ indexedDocuments: 0 })
  })
})

describe('the embedding sweep', () => {
  const profile = {
    id: 'local-embed',
    label: 'Local',
    kind: 'local' as const,
    baseUrl: 'http://localhost:11434/v1',
    model: 'chat',
    embeddingModel: 'nomic',
    pricing: {
      inputMicrousdPerMillionTokens: 0,
      outputMicrousdPerMillionTokens: 0,
    },
  }
  const calls: string[][] = []
  const embed = async (_p: unknown, _k: unknown, texts: readonly string[]) => {
    calls.push([...texts])
    return {
      vectors: texts.map(() => JSON.parse(vec(5)) as number[]),
      tokens: texts.length,
      model: 'nomic',
    }
  }

  it('reads nothing for a workspace that has not opted in', async () => {
    const { sweepEmbeddings } = await import('#/lib/embedding-index.server')
    await migrator.query(
      `UPDATE api.workspace_settings SET ai_enabled = true, semantic_search_enabled = false,
         embeddings_profile = 'local-embed' WHERE workspace_id = '${WS}'`,
    )
    await migrator.query(
      `DELETE FROM api.search_embeddings WHERE workspace_id = '${WS}'`,
    )
    const done = await sweepEmbeddings(migrator, [profile], { embed })
    expect(done.embedded).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('reads new text once, then leaves it alone until it changes', async () => {
    const { sweepEmbeddings } = await import('#/lib/embedding-index.server')
    await migrator.query(
      `UPDATE api.workspace_settings SET semantic_search_enabled = true
        WHERE workspace_id = '${WS}'`,
    )
    const first = await sweepEmbeddings(migrator, [profile], { embed })
    expect(first.failed).toBe(0)
    expect(first.embedded).toBeGreaterThanOrEqual(4)
    const sent = calls.flat().join('\n')
    expect(sent).toContain('EXP-S1 · Western blot transfer')

    const again = await sweepEmbeddings(migrator, [profile], { embed })
    expect(again.scanned).toBe(0)

    await migrator.query(
      `UPDATE api.records SET title = 'Western blot transfer, revised' WHERE id = '${BLOT}'`,
    )
    const changed = await sweepEmbeddings(migrator, [profile], { embed })
    expect(changed.embedded).toBe(1)
    const { rows } = await migrator.query<{ chunk_text: string }>(
      `SELECT chunk_text FROM api.search_embeddings WHERE object_id = '${BLOT}'`,
    )
    expect(rows[0]!.chunk_text).toContain('revised')
  })

  it('skips a cloud profile until the workspace has consented', async () => {
    const { usableWorkspaces } = await import('#/lib/embedding-index.server')
    const cloud = {
      ...profile,
      id: 'cloud-embed',
      kind: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKeyEnv: 'SEM_TEST_KEY',
    }
    process.env.SEM_TEST_KEY = 'k'
    await migrator.query(
      `UPDATE api.workspace_settings SET embeddings_profile = 'cloud-embed',
         ai_cloud_egress_enabled = false WHERE workspace_id = '${WS}'`,
    )
    expect((await usableWorkspaces(migrator, [cloud])).size).toBe(0)
    await migrator.query(
      `UPDATE api.workspace_settings SET ai_cloud_egress_enabled = true
        WHERE workspace_id = '${WS}'`,
    )
    expect((await usableWorkspaces(migrator, [cloud])).size).toBe(1)
  })
})
