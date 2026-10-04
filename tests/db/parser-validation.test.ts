import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectDenied,
  prepareTestDatabase,
  setActorJwt,
  TEST_DATABASE,
} from './helpers'

const workspace = randomUUID()
const otherWorkspace = randomUUID()
let migrator: Client
let steward: Client
let apiClient: Client
let server: Client
const signature = { requiredHeaders: ['sample', 'ntu'] }
const checksum = 'a'.repeat(64)

beforeAll(async () => {
  const db = await prepareTestDatabase()
  migrator = db.migrator
  await migrator.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES ('parser-qa','QA','parser-qa@test.invalid',true)`,
  )
  await migrator.query(
    'INSERT INTO api.workspaces (id,slug,name) VALUES ($1,$2,$2)',
    [workspace, workspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES ($1,'parser-qa','steward')`,
    [workspace],
  )
  await migrator.query(`INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
    ('parser-importer','Importer','parser-importer@test.invalid',true),
    ('parser-unrelated','Member','parser-unrelated@test.invalid',true),
    ('parser-viewer','Viewer','parser-viewer@test.invalid',true),
    ('parser-outsider','Steward','parser-outsider@test.invalid',true)`)
  await migrator.query(
    'INSERT INTO api.workspaces (id,slug,name) VALUES ($1,$2,$2)',
    [otherWorkspace, otherWorkspace],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id,user_id,role) VALUES
    ($1,'parser-importer','member'),($1,'parser-unrelated','member'),($1,'parser-viewer','viewer'),($2,'parser-outsider','steward')`,
    [workspace, otherWorkspace],
  )
  steward = await db.asRole('authenticator')
  await steward.query('SET ROLE authenticated')
  await setActorJwt(steward, 'parser-qa', workspace)
  apiClient = await db.asRole('authenticator')
  await apiClient.query('SET ROLE api_client')
  await setActorJwt(apiClient, 'parser-qa', workspace)
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = `/${TEST_DATABASE}`
  server = new Client({ connectionString: url.toString() })
  await server.connect()
  await server.query('SET ROLE service_role')
  await setActorJwt(server, 'parser-qa', workspace)
})

afterAll(async () => {
  await Promise.all(
    [migrator, steward, apiClient, server].filter(Boolean).map((c) => c.end()),
  )
})

async function fixture() {
  const parser = randomUUID(),
    version = randomUUID(),
    file = randomUUID()
  await migrator.query(
    `INSERT INTO api.parsers(id,workspace_id,key,name,format) VALUES ($1::uuid,$2,($1::uuid)::text,'Test CSV','csv')`,
    [parser, workspace],
  )
  await migrator.query(
    `INSERT INTO api.parser_versions(id,workspace_id,parser_id,version,signature) VALUES ($1,$2,$3,1,$4)`,
    [version, workspace, parser, signature],
  )
  await migrator.query(
    `INSERT INTO api.dataset_import_files(id,workspace_id,filename,byte_size,checksum,storage_key,format,created_by_user_id) VALUES ($1::uuid,$2,'test.csv',25,$3,($1::uuid)::text,'csv','parser-importer')`,
    [file, workspace, checksum],
  )
  return { parser, version, file }
}

function record(
  client: Client,
  f: Awaited<ReturnType<typeof fixture>>,
  expected = { signature, mapping: {} },
  hash = checksum,
  ok = true,
) {
  return client.query(
    'SELECT internal.record_parser_validation($1,$2,$3,$4::jsonb,$5::jsonb)',
    [
      f.version,
      f.file,
      hash,
      JSON.stringify(expected),
      JSON.stringify({
        ok,
        fileId: f.file,
        checksum: hash,
        rowCount: 2,
        headers: ['sample', 'ntu'],
        errors: ok ? [] : ['Mismatch'],
      }),
    ],
  )
}

describe('DSET-06 retained-file validation and approval authority', () => {
  it('keeps authored parser registration instrument and format scope canonical', async () => {
    const instrument = randomUUID()
    await migrator.query(
      `INSERT INTO api.instruments(id,workspace_id,name) VALUES ($1,$2,'Other workspace instrument')`,
      [instrument, otherWorkspace],
    )
    const key = randomUUID()
    await expectDenied(
      steward.query(
        `SELECT api.create_parser_version($1,$2,'Cross-scope','csv',1,'{}','{}',$3)`,
        [workspace, key, instrument],
      ),
      'SB106',
    )
    await steward.query(
      `SELECT api.create_parser_version($1,$2,'Canonical','csv',1,'{}')`,
      [workspace, key],
    )
    await expectDenied(
      steward.query(
        `SELECT api.create_parser_version($1,$2,'Mislabeled','tsv',2,'{}')`,
        [workspace, key],
      ),
      'SB107',
    )
  })

  it('denies authenticated/api_client evidence and direct status forgery', async () => {
    const f = await fixture()
    for (const client of [steward, apiClient]) {
      await expectDenied(record(client, f), '42501')
      await expectDenied(
        client.query(
          `UPDATE api.parser_versions SET status='validated',test_result='{"ok":true}',validated_at=now() WHERE id=$1`,
          [f.version],
        ),
        '42501',
      )
    }
  })

  it('rejects approval without successful retained evidence, not just a validated status', async () => {
    const f = await fixture()
    await expectDenied(
      steward.query('SELECT api.approve_parser_version($1)', [f.version]),
      '22023',
    )
    await migrator.query(
      `UPDATE api.parser_versions SET status='validated',validated_at=now(),test_result='{"ok":true}' WHERE id=$1`,
      [f.version],
    )
    await expectDenied(
      steward.query('SELECT api.approve_parser_version($1)', [f.version]),
      '22023',
    )
  })

  it('does not allow ensure_parser to create an approved or validated version', async () => {
    for (const status of ['validated', 'approved']) {
      await expectDenied(
        steward.query(
          `SELECT api.ensure_parser($1,$2,'Forged','csv',1,'{}','{}',NULL,$3)`,
          [workspace, randomUUID(), status],
        ),
        '22023',
      )
    }
  })

  it('persists trusted matching evidence and then allows governed approval', async () => {
    const f = await fixture()
    await record(server, f)
    const result = await steward.query(
      'SELECT * FROM api.approve_parser_version($1)',
      [f.version],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'approved',
      approved_by_user_id: 'parser-qa',
    })
    expect(result.rows[0].test_result).toMatchObject({
      ok: true,
      fileId: f.file,
      checksum,
    })
  })

  it('rejects stale definition and mismatched retained checksum at recording', async () => {
    const f = await fixture()
    await expectDenied(
      record(server, f, {
        signature: { requiredHeaders: ['other'] },
        mapping: {},
      }),
      '22023',
    )
    await expectDenied(record(server, f, undefined, 'b'.repeat(64)), '22023')
  })

  it('rejects approval after either the mapping, signature or retained checksum changed', async () => {
    for (const mutation of ['mapping', 'signature', 'checksum']) {
      const f = await fixture()
      await record(server, f)
      if (mutation === 'checksum') {
        await migrator.query(
          'UPDATE api.dataset_import_files SET checksum=$1 WHERE id=$2',
          ['b'.repeat(64), f.file],
        )
      } else {
        await migrator.query(
          `UPDATE api.parser_versions SET ${mutation}=$1::jsonb WHERE id=$2`,
          [JSON.stringify({ changed: true }), f.version],
        )
      }
      await expectDenied(
        steward.query('SELECT api.approve_parser_version($1)', [f.version]),
        '22023',
      )
    }
  })

  it('does not approve a genuine failed validation, and denies other-workspace and ordinary actor authority', async () => {
    const f = await fixture()
    await record(server, f, undefined, undefined, false)
    await expectDenied(
      steward.query('SELECT api.approve_parser_version($1)', [f.version]),
      '22023',
    )
    try {
      await setActorJwt(server, 'parser-importer', workspace)
      await expectDenied(record(server, f), '42501')
      await setActorJwt(server, 'parser-outsider', otherWorkspace)
      await expectDenied(record(server, f), '42501')
      await expectDenied(
        server.query(
          'SELECT internal.record_parser_import_failure($1,$2,$3,$4)',
          [f.file, f.version, 'mismatch', 'Denied'],
        ),
        '42501',
      )
      await setActorJwt(steward, 'parser-importer', workspace)
      await expectDenied(
        steward.query('SELECT api.approve_parser_version($1)', [f.version]),
        '42501',
      )
    } finally {
      await setActorJwt(server, 'parser-qa', workspace)
      await setActorJwt(steward, 'parser-qa', workspace)
    }
  })

  it('resolves a failed test after authoritative approval of its corrected next version', async () => {
    const f = await fixture()
    await record(server, f, undefined, undefined, false)
    const next = (
      await steward.query(
        `SELECT api.create_parser_version($1,$2,'Corrected','csv',2,$3) AS result`,
        [workspace, f.parser, signature],
      )
    ).rows[0].result.parserVersionId
    await record(server, { ...f, version: next })
    const work = () =>
      steward.query(
        'SELECT source_id FROM api.my_work_items WHERE source_id=$1',
        [f.file],
      )
    expect((await work()).rows).toHaveLength(1)
    await steward.query('SELECT api.approve_parser_version($1)', [next])
    expect((await work()).rows).toHaveLength(0)
  })

  it('routes only to the importer and scientific administrators, records request intent, and clears after trusted remediation', async () => {
    const f = await fixture()
    await server.query(
      'SELECT internal.record_parser_import_failure($1,$2,$3,$4)',
      [f.file, f.version, 'mismatch', 'Mismatch'],
    )
    try {
      for (const [user, ws, expected] of [
        ['parser-importer', workspace, 1],
        ['parser-unrelated', workspace, 0],
        ['parser-viewer', workspace, 0],
        ['parser-outsider', otherWorkspace, 0],
      ] as const) {
        await setActorJwt(steward, user, ws)
        expect(
          (
            await steward.query(
              'SELECT source_id FROM api.my_work_items WHERE source_id=$1',
              [f.file],
            )
          ).rows,
        ).toHaveLength(expected)
      }
      await setActorJwt(steward, 'parser-importer', workspace)
      const request = await steward.query(
        'SELECT * FROM api.request_parser_update($1)',
        [f.file],
      )
      expect(request.rows[0].parser_failure).toMatchObject({
        requestedByUserId: 'parser-importer',
        code: 'mismatch',
      })
      await expectDenied(
        steward.query(
          `UPDATE api.dataset_import_files SET parser_failure=NULL WHERE id=$1`,
          [f.file],
        ),
        '42501',
      )
      await expectDenied(
        apiClient.query('SELECT api.request_parser_update($1)', [f.file]),
        '42501',
      )
      await record(server, f)
      expect(
        (
          await steward.query(
            'SELECT source_id FROM api.my_work_items WHERE source_id=$1',
            [f.file],
          )
        ).rows,
      ).toHaveLength(0)
      await expectDenied(
        steward.query('SELECT api.request_parser_update($1)', [f.file]),
        '22023',
      )
    } finally {
      await setActorJwt(steward, 'parser-qa', workspace)
    }
  })

  it('keeps authoritative parser failure work open despite client parse-status forgery', async () => {
    const f = await fixture()
    await server.query(
      'SELECT internal.record_parser_import_failure($1,$2,$3,$4)',
      [f.file, f.version, 'parser_mismatch', 'Required headers do not match'],
    )
    const read = () =>
      steward.query(
        `SELECT source_type, source_id, parser_version_id FROM api.my_work_items
       WHERE source_type='dataset_import_file' AND source_id=$1`,
        [f.file],
      )
    expect((await read()).rows).toEqual([
      {
        source_type: 'dataset_import_file',
        source_id: f.file,
        parser_version_id: f.version,
      },
    ])
    await steward.query(
      `SELECT api.record_dataset_import_file_parse($1,'parsed',NULL)`,
      [f.file],
    )
    expect((await read()).rows).toHaveLength(1)
    for (const client of [steward, apiClient]) {
      await expectDenied(
        client.query(
          'SELECT internal.record_parser_import_failure($1,$2,$3,$4)',
          [f.file, f.version, 'parser_mismatch', 'Forged'],
        ),
        '42501',
      )
    }
  })
})
