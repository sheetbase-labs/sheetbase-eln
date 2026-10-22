/**
 * PLAT-01 — restore verification evidence. `verifyRestoredDatabase` must
 * accept a fully-migrated, healthy database and reject a restored backup
 * that is missing core schema, RLS guards or the RPC surface — i.e. it must
 * detect an unusable backup rather than merely checking that a file exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { backupManifestSchema } from '../../src/lib/backup'
import { sha256File } from '../../scripts/backup-io'

import {
  verifyObjectArchive,
  verifyRestoredDatabaseWithClient,
} from '#/lib/restore-verification'

import { prepareTestDatabase } from './helpers'

describe('restore verification', () => {
  let context: Awaited<ReturnType<typeof prepareTestDatabase>>

  beforeAll(async () => {
    context = await prepareTestDatabase()
  })

  afterAll(async () => {
    await context.migrator.end()
  })

  it('accepts a fully migrated database as usable Sheetbase state', async () => {
    const report = await verifyRestoredDatabaseWithClient(context.migrator)
    expect(report.checks.filter((c) => !c.ok)).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts.workspaces).toBe(0)
  })

  it('rejects a restored database that lost a core table', async () => {
    // The drill database is disposable; no transaction needed. Restore the
    // name in finally so this suite always leaves the schema intact.
    await context.migrator.query(
      'ALTER TABLE api.connector_runs RENAME TO connector_runs_drill_hidden',
    )
    let report: Awaited<ReturnType<typeof verifyRestoredDatabaseWithClient>>
    try {
      report = await verifyRestoredDatabaseWithClient(context.migrator)
    } finally {
      await context.migrator.query(
        'ALTER TABLE api.connector_runs_drill_hidden RENAME TO connector_runs',
      )
    }

    const after = await verifyRestoredDatabaseWithClient(context.migrator)
    expect(after.ok).toBe(true)
    expect(report.ok).toBe(false)
    expect(
      report.checks.find((c) => c.name === 'table_connector_runs')?.ok,
    ).toBe(false)
  })

  it('rejects a restored database without the migration journal', async () => {
    await context.migrator.query(
      'ALTER SCHEMA drizzle RENAME TO drizzle_drill_hidden',
    )
    let report: Awaited<ReturnType<typeof verifyRestoredDatabaseWithClient>>
    try {
      report = await verifyRestoredDatabaseWithClient(context.migrator)
    } finally {
      await context.migrator.query(
        'ALTER SCHEMA drizzle_drill_hidden RENAME TO drizzle',
      )
    }

    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.name === 'migrations_applied')?.ok).toBe(
      false,
    )
  })
})

describe('verifyObjectArchive', () => {
  const rows = [
    {
      storage_key: 'a/b/obj1',
      byte_size: '100',
      status: 'active',
      checksum: 'a'.repeat(64),
    },
    {
      storage_key: 'a/b/obj2',
      byte_size: '50',
      status: 'deleted',
      checksum: null,
    },
  ]

  it('accepts when every active object is present with a matching size', () => {
    const report = verifyObjectArchive(
      [
        { name: 'a/b/obj1', size: 100, sha256: 'a'.repeat(64) },
        { name: 'a/b/extra', size: 10, sha256: 'b'.repeat(64) },
      ],
      rows,
    )
    expect(report.ok).toBe(true)
  })

  it('rejects missing object bytes', () => {
    const report = verifyObjectArchive([], rows)
    expect(report.ok).toBe(false)
    expect(
      report.checks.find((c) => c.name === 'object_bytes_present')?.ok,
    ).toBe(false)
  })

  it('rejects size mismatches', () => {
    const report = verifyObjectArchive(
      [{ name: 'a/b/obj1', size: 99, sha256: 'a'.repeat(64) }],
      rows,
    )
    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.name === 'object_sizes_match')?.ok).toBe(
      false,
    )
  })

  it('rejects metadata rows with an empty archive', () => {
    const report = verifyObjectArchive([], rows)
    expect(
      report.checks.find((c) => c.name === 'object_metadata_present')?.ok,
    ).toBe(false)
  })

  it('accepts an empty archive when no metadata rows exist', () => {
    const report = verifyObjectArchive([], [])
    expect(report.ok).toBe(true)
  })

  it('rejects same-size tampering and absent metadata checksums', () => {
    const entry = { name: 'a/b/obj1', size: 100, sha256: 'b'.repeat(64) }
    expect(verifyObjectArchive([entry], rows).ok).toBe(false)
    expect(
      verifyObjectArchive([entry], [{ ...rows[0], checksum: null }]).ok,
    ).toBe(false)
  })
})

describe('populated producer-to-replacement recovery', () => {
  it('preserves frozen results, object hashes, owners and request-role permissions in an isolated cluster', async () => {
    const context = await prepareTestDatabase()
    const work = await mkdtemp(join(tmpdir(), 'sheetbase-recovery-test-'))
    const store = join(work, 'store')
    const backups = join(work, 'backups')
    const pgBin = execFileSync('pg_config', ['--bindir'], {
      encoding: 'utf8',
    }).trim()
    const source = new URL(process.env.DATABASE_URL!)
    const database = (
      await context.migrator.query('select current_database() AS name')
    ).rows[0].name
    const env = {
      ...process.env,
      PATH: `${pgBin}:${process.env.PATH}`,
      PGHOST: source.hostname,
      PGPORT: source.port || '5432',
      PGPASSWORD: decodeURIComponent(source.password),
      POSTGRES_USER: decodeURIComponent(source.username),
      POSTGRES_DB: database,
      SHEETBASE_BACKUP_LOCAL: 'true',
      SHEETBASE_BACKUP_OBJECT_DIR: store,
      SHEETBASE_BACKUP_DIR: backups,
    }
    let restored: string | undefined
    try {
      const ws = '71000000-0000-4000-8000-000000000001'
      const otherWs = '71000000-0000-4000-8000-000000000002'
      const project = '72000000-0000-4000-8000-000000000001'
      const record = '73000000-0000-4000-8000-000000000001'
      const file = '73000000-0000-4000-8000-000000000002'
      const object = '74000000-0000-4000-8000-000000000001'
      const schema = '75000000-0000-4000-8000-000000000001'
      const schemaVersion = '75000000-0000-4000-8000-000000000002'
      const field = '75000000-0000-4000-8000-000000000003'
      const dataset = '76000000-0000-4000-8000-000000000001'
      const version = '76000000-0000-4000-8000-000000000002'
      const row = '76000000-0000-4000-8000-000000000003'
      const storageKey = `${ws}/${object}/${'a'.repeat(32)}`
      const bytes = Buffer.from('time,titre\n0,1.25\n3,-7.5\n')
      const checksum = createHash('sha256').update(bytes).digest('hex')
      await mkdir(join(store, ws, object), { recursive: true })
      await writeFile(join(store, storageKey), bytes)
      await context.migrator.query(`
        INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
          ('recovery-owner','Owner','owner@recovery.test',true),('recovery-viewer','Viewer','viewer@recovery.test',true);
        INSERT INTO api.workspaces(id,slug,name) VALUES ('${ws}','recovery','Recovery'),('${otherWs}','recovery-other','Other');
        INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ('${ws}','recovery-owner','owner'),('${ws}','recovery-viewer','viewer');
        INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id) VALUES ('${project}','${ws}','REC','Recovery','recovery-owner');
        INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,granted_by_user_id)
          VALUES ('${ws}','${project}','recovery-viewer',true,false,'recovery-owner');
        INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES
          ('${record}','${ws}','${project}','experiment','REC-1','Recovered experiment','recovery-owner'),
          ('${file}','${ws}','${project}','file','REC-2','Evidence.csv','recovery-owner');
        INSERT INTO api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) VALUES ('${schema}','${ws}','recovery_schema','Recovery schema','active');
        INSERT INTO api.dataset_schema_versions(id,schema_id,version,lifecycle) VALUES ('${schemaVersion}','${schema}',1,'draft');
        INSERT INTO api.dataset_schema_version_fields(id,schema_version_id,field_id,key,label,logical_type,nullable,display_order)
          VALUES (gen_random_uuid(),'${schemaVersion}','${field}','titre','Titre','decimal',true,1);
        UPDATE api.dataset_schema_versions SET lifecycle='active',published_at=now() WHERE id='${schemaVersion}';
        INSERT INTO api.datasets(id,workspace_id,schema_version_id,name,primary_project_id) VALUES ('${dataset}','${ws}','${schemaVersion}','Results','${project}');
        INSERT INTO api.dataset_versions(id,dataset_id,workspace_id,schema_version_id,source_dataset_revision,label)
          VALUES ('${version}','${dataset}','${ws}','${schemaVersion}',1,'Frozen result');
        INSERT INTO api.dataset_version_rows(dataset_version_id,row_id,revision) VALUES ('${version}','${row}',1);
        INSERT INTO api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,numeric_value) VALUES ('${version}','${row}','${field}',0,-7.5);
      `)
      await context.migrator.query(
        `INSERT INTO api.file_objects(id,workspace_id,record_id,storage_key,display_name,media_type,byte_size,checksum,status,storage_backend,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,'evidence.csv','text/csv',$5,$6,'active','local','recovery-owner','recovery-owner')`,
        [object, ws, file, storageKey, bytes.length, checksum],
      )
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/backup.ts'], {
        env,
        encoding: 'utf8',
      })
      const pointer = JSON.parse(
        await readFile(join(backups, 'latest.json'), 'utf8'),
      )
      const manifestPath = join(backups, `${pointer.prefix}-manifest.json`)
      const manifest = backupManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      )
      expect((await stat(backups)).mode & 0o777).toBe(0o700)
      expect(
        (await stat(join(backups, `${pointer.prefix}-db.sql.gz`))).mode & 0o777,
      ).toBe(0o600)
      const args = [
        '--import',
        'tsx',
        'scripts/restore-drill.ts',
        '--manifest',
        manifestPath,
        '--local',
      ]
      const restoredRun = spawnSync(
        process.execPath,
        [...args, '--keep', '--self-test'],
        { env, encoding: 'utf8' },
      )
      const result = JSON.parse(restoredRun.stdout.trim().split('\n').at(-1)!)
      restored = result.work
      expect(restoredRun.status, restoredRun.stderr + restoredRun.stdout).toBe(
        0,
      )
      expect(result.message).toBe('restore drill passed')
      expect(
        result.verification.access.checks.map(
          (item: { ok: boolean }) => item.ok,
        ),
      ).toEqual([true, true, true])
      const request = new Client({
        host: restored,
        user: 'authenticator',
        database: 'sheetbase_restore',
      })
      await request.connect()
      try {
        await request.query('SET ROLE authenticated')
        await request.query(
          `SELECT set_config('request.jwt.claims',$1,false)`,
          [
            JSON.stringify({
              sub: 'recovery-owner',
              role: 'authenticated',
              workspace_id: ws,
            }),
          ],
        )
        const values = await request.query(
          'SELECT numeric_value::text FROM api.dataset_version_values WHERE dataset_version_id=$1',
          [version],
        )
        expect(values.rows).toEqual([{ numeric_value: '-7.5' }])
        const listed = await request.query(
          'SELECT api.dataset_version_list($1) AS versions',
          [dataset],
        )
        expect(JSON.stringify(listed.rows)).toContain('Frozen result')
        const projects = await request.query(
          'SELECT count(*)::int AS n FROM api.projects',
        )
        expect(projects.rows).toEqual([{ n: 1 }]) // The drill's write probe rolled back.
        const admin = new Client({
          host: restored,
          user: 'postgres',
          database: 'sheetbase_restore',
        })
        await admin.connect()
        try {
          await admin.query('REVOKE SELECT ON api.records FROM authenticated')
          expect((await verifyRestoredDatabaseWithClient(admin)).ok).toBe(false)
          await expect(
            request.query('SELECT id FROM api.records'),
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await admin.query('GRANT SELECT ON api.records TO authenticated')
          await admin.end()
        }
      } finally {
        await request.end()
      }
      expect(await readFile(join(restored!, 'objects', storageKey))).toEqual(
        bytes,
      )
      // A fresh valid archive with same-size changed bytes must fail the per-object hash,
      // even when its archive hash is honestly updated in the manifest.
      await writeFile(join(store, storageKey), Buffer.alloc(bytes.length, 'x'))
      const archive = join(backups, `${pointer.prefix}-objects.tar.gz`)
      execFileSync('tar', ['-czf', archive, '-C', store, '.'])
      manifest.objects = {
        archiveBytes: (await stat(archive)).size,
        archiveSha256: await sha256File(archive),
      }
      await writeFile(manifestPath, JSON.stringify(manifest))
      const tampered = spawnSync(process.execPath, args, {
        env,
        encoding: 'utf8',
      })
      expect(tampered.status).toBe(1)
      expect(tampered.stdout).toContain(
        '"name":"object_checksums_match","ok":false',
      )
      const corrupt = await readFile(archive)
      corrupt[corrupt.length - 1] ^= 1
      await writeFile(archive, corrupt)
      const archiveTamper = spawnSync(process.execPath, args, {
        env,
        encoding: 'utf8',
      })
      expect(archiveTamper.status).toBe(1)
      expect(archiveTamper.stdout).not.toContain('restore drill passed')
    } finally {
      if (restored) {
        execFileSync(join(pgBin, 'pg_ctl'), [
          '-D',
          join(restored, 'pgdata'),
          '-m',
          'immediate',
          '-w',
          'stop',
        ])
        await rm(restored, { recursive: true, force: true })
      }
      await context.migrator.end()
      await rm(work, { recursive: true, force: true })
    }
  }, 60_000)
})
