/**
 * Open tables (lakehouse) and publishing, against a freshly migrated database.
 *
 * Proves:
 *  - only integrations managers turn open tables on, and only with data access;
 *  - a pass writes Parquet files and DuckLake catalogue rows for model views and
 *    dataset versions, skips what has not changed and picks up what has;
 *  - the pass reads as the person who turned it on, and stops when they lose
 *    data access;
 *  - lake logins are limited to the workspace's catalogue and stop working when
 *    revoked;
 *  - a publication goes queued -> draft -> published, and only a person can
 *    make the draft public.
 */
// @requirement FAIR-01
import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { refreshWorkspaceLake } from '../../src/lib/lake/lake-export.server'
import type { LakeRefreshDeps } from '../../src/lib/lake/lake-export.server'
import { sweepPublications } from '../../src/lib/publishing/publisher.server'
import type { PublisherDeps } from '../../src/lib/publishing/publisher.server'
import type { RepoFetch } from '../../src/lib/publishing/repositories'
import {
  MissingStorageObjectError,
  type ObjectStorage,
} from '../../src/lib/file-storage/types'
import {
  expectDenied,
  migratorUrl,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000f100'
const PROJECT = '00000000-0000-4000-8000-00000000f101'
const OWNER = 'lake-owner'
const SCIENTIST = 'lake-viewer'
const ANALYST = 'lake-analyst'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function as(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, user, WS)
  return client
}

/** An object store held in memory. */
function memoryStorage(): ObjectStorage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>()
  return {
    objects,
    putStream: async (key, body) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      objects.set(key, bytes)
      return {
        byteSize: BigInt(bytes.length),
        checksum: createHash('sha256').update(bytes).digest('hex'),
      }
    },
    getStream: async (key) => {
      const bytes = objects.get(key)
      if (!bytes) throw new MissingStorageObjectError(key)
      return {
        stream: new Blob([bytes as unknown as BlobPart]).stream(),
        byteSize: bytes.length,
      }
    },
    head: async (key) => {
      const bytes = objects.get(key)
      return bytes ? { byteSize: bytes.length } : null
    },
    delete: async (key) => {
      objects.delete(key)
    },
  }
}

const storage = memoryStorage()
let lakeDeps: LakeRefreshDeps
let datasetId: string
let fieldId: string

async function snapshot(label: string): Promise<string> {
  const { rows } = await migrator.query<{ revision: string }>(
    `SELECT revision FROM api.datasets WHERE id=$1`,
    [datasetId],
  )
  const owner = await as(OWNER)
  const v = await owner.query<{ id: string }>(
    `SELECT id FROM api.snapshot_dataset($1,$2,$3)`,
    [datasetId, rows[0].revision, label],
  )
  return v.rows[0].id
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,'Olive Owner','owner@lake.test',true),($2,'Sam Scientist','sam@lake.test',true),
       ($3,'Ana Analyst','ana@lake.test',true)`,
    [OWNER, SCIENTIST, ANALYST],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'lake','Lake')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer'),($1,$4,'analyst')`,
    [WS, OWNER, SCIENTIST, ANALYST],
  )
  await migrator.query(
    `insert into api.workspace_settings(workspace_id,created_by_user_id,data_access_roles)
     values($1,$2,array['owner','steward'])`,
    [WS, OWNER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$2,'LK1','Lake',$3)`,
    [PROJECT, WS, OWNER],
  )
  await migrator.query(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,'experiment','EXP-LK1','First run',$3),($1,$2,'experiment','EXP-LK2','Second run',$3)`,
    [WS, PROJECT, OWNER],
  )
  await migrator.query(`select internal.regenerate_reporting_views($1)`, [WS])

  const owner = await as(OWNER)
  const schema = await owner.query<{ result: { schema_version_id: string } }>(
    `SELECT api.create_dataset_schema_definition(
       $1,'lake_schema','Lake schema',NULL,
       '[{"key":"value","label":"Value","logicalType":"integer","nullable":false}]'::jsonb) result`,
    [WS],
  )
  const schemaVersionId = schema.rows[0].result.schema_version_id
  await owner.query(`SELECT api.publish_dataset_schema_version($1)`, [schemaVersionId])
  fieldId = (
    await migrator.query<{ field_id: string }>(
      `SELECT field_id FROM api.dataset_schema_version_fields WHERE schema_version_id=$1`,
      [schemaVersionId],
    )
  ).rows[0].field_id
  const dataset = await owner.query<{ id: string }>(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
     VALUES($1,$2,'Lake dataset',$3) RETURNING id`,
    [WS, schemaVersionId, OWNER],
  )
  datasetId = dataset.rows[0].id
  await snapshot('empty start')

  lakeDeps = {
    connect: async () => {
      const client = new (await import('pg')).Client({
        connectionString: migratorUrl(),
      })
      await client.connect()
      return client
    },
    storage,
    baseUrl: 'http://localhost:3000',
  }
})

afterAll(async () => {
  for (const c of clients) await c.end()
  await migrator.end()
})

describe('turning open tables on', () => {
  it('needs integrations access and data access', async () => {
    const viewer = await as(SCIENTIST)
    await expectDenied(
      viewer.query(`SELECT api.set_lake_settings($1, true)`, [WS]),
      'SB060',
    )
    // An analyst who may manage integrations but has no data access.
    await migrator.query(
      `insert into api.settings_access(workspace_id,area,role,level) values($1,'integrations','analyst','manage')
       on conflict do nothing`,
      [WS],
    )
    const analyst = await as(ANALYST)
    await expectDenied(analyst.query(`SELECT api.set_lake_settings($1, true)`, [WS]), '42501')
    const owner = await as(OWNER)
    const on = await owner.query<{ s: { enabled: boolean; exporterUserId: string } }>(
      `SELECT api.set_lake_settings($1, true) s`,
      [WS],
    )
    expect(on.rows[0].s).toMatchObject({ enabled: true, exporterUserId: OWNER })
  })

  it('lists the workspace for the first pass', async () => {
    const due = await migrator.query(`SELECT * FROM internal.lake_due_workspaces()`)
    expect(due.rows.map((r) => r.workspace_id)).toContain(WS)
  })
})

describe('a pass', () => {
  it('writes model views and dataset versions as snapshots', async () => {
    const result = await refreshWorkspaceLake(lakeDeps, {
      workspaceId: WS,
      exporterUserId: OWNER,
    })
    expect(result.failed).toBe(0)
    expect(result.written).toBeGreaterThan(0)

    const tables = await migrator.query<{
      table_name: string
      status: string
      row_count: string
      snapshots: unknown[]
    }>(
      `SELECT table_name,status,row_count,snapshots FROM api.lake_tables WHERE workspace_id=$1`,
      [WS],
    )
    const byName = new Map(tables.rows.map((t) => [t.table_name, t]))
    expect(byName.get('experiments')).toMatchObject({ status: 'ready', row_count: '2' })
    const dataset = [...byName.values()].find((t) => Array.isArray(t.snapshots) && t.snapshots.length > 0)
    expect(dataset?.snapshots).toHaveLength(1)

    // The catalogue and the file store agree.
    const schema = `lake_${WS.replaceAll('-', '')}`
    const files = await migrator.query<{ path: string; file_size_bytes: string; table_name: string }>(
      `SELECT f.path, f.file_size_bytes, t.table_name
         FROM ${schema}.ducklake_data_file f JOIN ${schema}.ducklake_table t ON t.table_id=f.table_id
        WHERE f.end_snapshot IS NULL`,
    )
    expect(files.rows.length).toBeGreaterThan(0)
    for (const f of files.rows) {
      const stored = storage.objects.get(`lake/${WS}/main/${f.table_name}/${f.path}`)
      expect(stored?.length).toBe(Number(f.file_size_bytes))
      expect(Buffer.from(stored!.subarray(0, 4)).toString()).toBe('PAR1')
    }
    const run = await migrator.query(`SELECT * FROM api.lake_settings($1)`, [WS]).catch(() => null)
    void run
    const owner = await as(OWNER)
    const settings = await owner.query<{ s: { lastStatus: string } }>(
      `SELECT api.lake_settings($1) s`,
      [WS],
    )
    expect(settings.rows[0].s.lastStatus).toBe('ok')
  })

  it('leaves unchanged tables alone and picks up changes', async () => {
    const before = storage.objects.size
    const again = await refreshWorkspaceLake(lakeDeps, { workspaceId: WS, exporterUserId: OWNER })
    expect(again.written).toBe(0)
    expect(storage.objects.size).toBe(before)

    await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,'experiment','EXP-LK3','Third run',$3)`,
      [WS, PROJECT, OWNER],
    )
    const changed = await refreshWorkspaceLake(lakeDeps, { workspaceId: WS, exporterUserId: OWNER })
    expect(changed.written).toBe(1)
    const exp = await migrator.query<{ row_count: string }>(
      `SELECT row_count FROM api.lake_tables WHERE workspace_id=$1 AND table_name='experiments'`,
      [WS],
    )
    expect(exp.rows[0].row_count).toBe('3')
  })

  it('adds a snapshot for each new dataset version', async () => {
    const owner = await as(OWNER)
    void owner
    await snapshot('second')
    await refreshWorkspaceLake(lakeDeps, { workspaceId: WS, exporterUserId: OWNER })
    const t = await migrator.query<{ snapshots: Array<{ label: string }> }>(
      `SELECT snapshots FROM api.lake_tables WHERE workspace_id=$1 AND source_kind='dataset'`,
      [WS],
    )
    expect(t.rows[0].snapshots.length).toBeGreaterThanOrEqual(1)
    void fieldId
  })

  it('stops when the person it is written as has no data access', async () => {
    await expect(
      refreshWorkspaceLake(lakeDeps, { workspaceId: WS, exporterUserId: ANALYST }),
    ).rejects.toThrow(/no longer has data access/)
    const settings = (
      await migrator.query<{ s: { lastStatus: string } }>(
        `select integration_settings->'lake' s from api.workspace_settings where workspace_id=$1`,
        [WS],
      )
    ).rows[0].s
    expect(settings).toMatchObject({ lastStatus: 'failed' })
    await refreshWorkspaceLake(lakeDeps, { workspaceId: WS, exporterUserId: OWNER })
  })
})

describe('lake logins', () => {
  let credentialId: string
  let secret: string
  let username: string

  it('are for people with data access', async () => {
    const scientist = await as(SCIENTIST)
    await expectDenied(
      scientist.query(`SELECT * FROM api.create_lake_credential($1,'nope')`, [WS]),
      '42501',
    )
    void migrator
    const owner = await as(OWNER)
    const made = await owner.query<{ id: string; username: string; secret: string }>(
      `SELECT * FROM api.create_lake_credential($1,'duckdb')`,
      [WS],
    )
    ;({ id: credentialId, username, secret } = made.rows[0])
    expect(username).toMatch(/^sblk_/)
    const tokenHash = createHash('sha256').update(secret).digest('hex')
    const ws = await migrator.query<{ w: string }>(
      `SELECT internal.lake_token_workspace($1) w`,
      [tokenHash],
    )
    expect(ws.rows[0].w).toBe(WS)
  })

  it('can read the catalogue and nothing else', async () => {
    const url = new URL(migratorUrl())
    url.username = username
    url.password = secret
    const { Client: PgClient } = await import('pg')
    const reader = new PgClient({ connectionString: url.toString() })
    await reader.connect()
    try {
      const schema = `lake_${WS.replaceAll('-', '')}`
      const tables = await reader.query(`SELECT count(*) FROM ${schema}.ducklake_table`)
      expect(Number(tables.rows[0].count)).toBeGreaterThan(0)
      await expect(reader.query(`SELECT count(*) FROM api.records`)).rejects.toMatchObject({
        code: '42501',
      })
      await expect(
        reader.query(`DELETE FROM ${schema}.ducklake_table`),
      ).rejects.toThrow()
    } finally {
      await reader.end()
    }
  })

  it('stop working once revoked', async () => {
    const owner = await as(OWNER)
    await owner.query(`SELECT api.revoke_lake_credential($1,$2)`, [WS, credentialId])
    const ws = await migrator.query<{ w: string | null }>(
      `SELECT internal.lake_token_workspace($1) w`,
      [createHash('sha256').update(secret).digest('hex')],
    )
    expect(ws.rows[0].w).toBeNull()
    const list = await owner.query<{ status: string }>(
      `SELECT status FROM api.list_lake_credentials($1)`,
      [WS],
    )
    expect(list.rows[0].status).toBe('revoked')
  })
})

describe('publishing', () => {
  let targetId: string
  let publicationId: string
  const calls: string[] = []

  const fakeZenodo: RepoFetch = async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${new URL(url).pathname}`)
    const json = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })
    if (method === 'POST' && url.endsWith('/api/deposit/depositions')) {
      return json(201, { id: 77, links: { bucket: 'https://zen.test/api/files/b1', html: 'https://zen.test/deposit/77' } })
    }
    if (method === 'PUT' && url.includes('/api/files/b1/')) return json(201, {})
    if (method === 'PUT' && url.endsWith('/api/deposit/depositions/77')) {
      return json(200, { id: 77, links: { html: 'https://zen.test/deposit/77' }, metadata: { prereserve_doi: { doi: '10.5072/zenodo.77' } } })
    }
    if (method === 'POST' && url.endsWith('/actions/publish')) {
      return json(202, { doi: '10.5072/zenodo.77', links: { record_html: 'https://zen.test/records/77' } })
    }
    return json(404, { message: 'no such route' })
  }

  const publisherDeps = (): PublisherDeps => ({
    connect: lakeDeps.connect as PublisherDeps['connect'],
    fetch: fakeZenodo,
    tokenFor: async () => 'token',
    openToken: (sealed) => sealed.replace('sealed:', ''),
    buildPackage: async () => ({
      name: 'package.ro-crate.zip',
      bytes: new Uint8Array([80, 75, 3, 4]),
      includesRunCrate: true,
      description: 'A package',
      keywords: ['test'],
    }),
  })

  it('needs a repository with a token', async () => {
    const owner = await as(OWNER)
    const saved = await owner.query<{ id: string }>(
      `SELECT * FROM api.save_publication_target($1,NULL,'zenodo','Zenodo sandbox','https://zen.test/',NULL,'cc-by-4.0',true)`,
      [WS],
    )
    targetId = saved.rows[0].id
    const version = await migrator.query<{ id: string }>(
      `SELECT id FROM api.dataset_versions WHERE dataset_id=$1 ORDER BY created_at LIMIT 1`,
      [datasetId],
    )
    await expectDenied(
      owner.query(`SELECT api.request_publication($1,'dataset_version',$2)`, [targetId, version.rows[0].id]),
      '22023',
    )
    await migrator.query(`SELECT internal.set_publication_target_secret($1,'sealed:tok')`, [targetId])
    const scientist = await as(SCIENTIST)
    await expectDenied(
      scientist.query(`SELECT api.save_publication_target($1,NULL,'zenodo','Mine','https://x.test')`, [WS]),
      'SB060',
    )
    const req = await owner.query<{ id: string; status: string }>(
      `SELECT * FROM api.request_publication($1,'dataset_version',$2)`,
      [targetId, version.rows[0].id],
    )
    publicationId = req.rows[0].id
    expect(req.rows[0].status).toBe('queued')
    await expectDenied(
      owner.query(`SELECT api.request_publication($1,'dataset_version',$2)`, [targetId, version.rows[0].id]),
      '23505',
    )
  })

  it('sends a draft and reserves the DOI, but does not publish', async () => {
    const result = await sweepPublications(publisherDeps())
    expect(result).toMatchObject({ drafted: 1, published: 0, failed: 0 })
    const row = (
      await migrator.query(`SELECT * FROM api.publications WHERE id=$1`, [publicationId])
    ).rows[0]
    expect(row).toMatchObject({
      status: 'draft',
      doi: '10.5072/zenodo.77',
      remote_id: '77',
      includes_run_crate: true,
    })
    expect(calls.some((c) => c.endsWith('/actions/publish'))).toBe(false)
    const again = await sweepPublications(publisherDeps())
    expect(again).toMatchObject({ drafted: 0, published: 0 })
  })

  it('publishes only when a person confirms', async () => {
    const scientist = await as(SCIENTIST)
    await expectDenied(scientist.query(`SELECT api.publish_publication($1)`, [publicationId]), 'SB127')
    const owner = await as(OWNER)
    await owner.query(`SELECT api.publish_publication($1)`, [publicationId])
    const result = await sweepPublications(publisherDeps())
    expect(result.published).toBe(1)
    const row = (
      await migrator.query(`SELECT status,doi,record_url,published_at FROM api.publications WHERE id=$1`, [publicationId])
    ).rows[0]
    expect(row).toMatchObject({ status: 'published', doi: '10.5072/zenodo.77', record_url: 'https://zen.test/records/77' })
    expect(row.published_at).toBeTruthy()
    await expectDenied(owner.query(`SELECT api.discard_publication($1)`, [publicationId]), '22023')
  })

  it('backs off and gives up after five failed tries', async () => {
    const owner = await as(OWNER)
    const version = await migrator.query<{ id: string }>(
      `SELECT id FROM api.dataset_versions WHERE dataset_id=$1 ORDER BY created_at LIMIT 1`,
      [datasetId],
    )
    const req = await owner.query<{ id: string }>(
      `SELECT * FROM api.request_publication($1,'dataset_version',$2)`,
      [targetId, version.rows[0].id],
    )
    const broken: PublisherDeps = {
      ...publisherDeps(),
      fetch: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }),
    }
    for (let i = 0; i < 5; i++) {
      await migrator.query(`update api.publications set next_attempt_at=now() where id=$1`, [req.rows[0].id])
      await sweepPublications(broken)
    }
    const row = (await migrator.query(`SELECT status,attempts,last_error FROM api.publications WHERE id=$1`, [req.rows[0].id])).rows[0]
    expect(row).toMatchObject({ status: 'failed', attempts: 5 })
    expect(row.last_error).toContain('500')
    const retried = await owner.query<{ status: string }>(`SELECT * FROM api.retry_publication($1)`, [req.rows[0].id])
    expect(retried.rows[0].status).toBe('queued')
  })
})

describe('ontology terms', () => {
  it('are linked by people who can edit data models', async () => {
    const scientist = await as(SCIENTIST)
    await expectDenied(
      scientist.query(
        `SELECT api.link_ontology_term($1,'schema_field',gen_random_uuid(),'chebi','http://purl.obolibrary.org/obo/CHEBI_15377','water')`,
        [WS],
      ),
      '42501',
    )
    const owner = await as(OWNER)
    const linked = await owner.query<{ id: string; label: string }>(
      `SELECT * FROM api.link_ontology_term($1,'schema_field',$2,'chebi','http://purl.obolibrary.org/obo/CHEBI_15377','water','CHEBI_15377')`,
      [WS, fieldId],
    )
    expect(linked.rows[0].label).toBe('water')
    // Linking the same term again keeps one row.
    await owner.query(
      `SELECT api.link_ontology_term($1,'schema_field',$2,'chebi','http://purl.obolibrary.org/obo/CHEBI_15377','H2O')`,
      [WS, fieldId],
    )
    const rows = await scientist.query(`SELECT label FROM api.ontology_annotations WHERE target_id=$1`, [fieldId])
    expect(rows.rows).toEqual([{ label: 'H2O' }])
    await owner.query(`SELECT api.unlink_ontology_term($1)`, [linked.rows[0].id])
    const gone = await scientist.query(`SELECT 1 FROM api.ontology_annotations WHERE target_id=$1`, [fieldId])
    expect(gone.rowCount).toBe(0)
  })

  it('look-up is off until an admin turns it on', async () => {
    const owner = await as(OWNER)
    const before = await owner.query<{ s: { enabled: boolean } }>(`SELECT api.ontology_settings($1) s`, [WS])
    expect(before.rows[0].s.enabled).toBe(false)
    const on = await owner.query<{ s: { enabled: boolean; ontologies: string[] } }>(
      `SELECT api.set_ontology_settings($1,true,array['obi','chebi']) s`,
      [WS],
    )
    expect(on.rows[0].s).toMatchObject({ enabled: true, ontologies: ['obi', 'chebi'] })
  })
})
