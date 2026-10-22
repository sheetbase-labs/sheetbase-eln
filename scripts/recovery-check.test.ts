// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupPrefix } from '../src/lib/backup'
import { sha256File } from './backup-io'

describe('independent recovery checks', () => {
  it('detects missing, stale and failed backup/drill/readiness rather than trusting metrics reachability', async () => {
    const work = await mkdtemp(join(tmpdir(), 'sheetbase-recovery-check-'))
    let ready = true
    const server = createServer((_request, response) => {
      response.writeHead(ready ? 200 : 503, {
        'content-type': 'application/json',
      })
      response.end(
        JSON.stringify({
          status: ready ? 'ready' : 'not_ready',
          database: {
            migration: { status: ready ? 'compatible' : 'incompatible' },
          },
        }),
      )
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('test server has no port')
    const env = {
      ...process.env,
      SHEETBASE_BACKUP_DIR: work,
      SHEETBASE_DRILL_REPORT_PATH: join(work, 'drill.json'),
      SHEETBASE_METRICS_TEXTFILE_DIR: work,
      SHEETBASE_BACKUP_MAX_AGE_SECONDS: '3600',
      SHEETBASE_DRILL_MAX_AGE_SECONDS: '3600',
      SHEETBASE_RECOVERY_CHECK_MAX_AGE_SECONDS: '60',
      SHEETBASE_READINESS_URL: `http://127.0.0.1:${address.port}/api/health/ready`,
    }
    async function check() {
      const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/recovery-check.ts'],
        { env },
      ).then(
        (value) => ({ code: 0, stdout: value.stdout }),
        (error: { code: number; stdout: string }) => error,
      )
      return { code: result.code, result: JSON.parse(result.stdout) }
    }
    try {
      expect(await check()).toMatchObject({
        code: 1,
        result: { backup: false, drill: false, readiness: true },
      })
      const now = new Date()
      const prefix = backupPrefix(now)
      const dump = join(work, `${prefix}-db.sql.gz`)
      const archive = join(work, `${prefix}-objects.tar.gz`)
      await writeFile(dump, 'dump')
      await writeFile(archive, 'objects')
      const manifest = {
        formatVersion: 2,
        permissions: 'preserved',
        prefix,
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationMs: 0,
        retentionDays: 14,
        database: {
          container: 'test',
          database: 'test',
          bootstrapRole: 'migrator',
          dumpBytes: 4,
          dumpSha256: await sha256File(dump),
        },
        objects: { archiveBytes: 7, archiveSha256: await sha256File(archive) },
      }
      const manifestPath = join(work, `${prefix}-manifest.json`)
      await writeFile(manifestPath, JSON.stringify(manifest))
      await writeFile(join(work, 'latest.json'), JSON.stringify({ prefix }))
      await writeFile(
        env.SHEETBASE_DRILL_REPORT_PATH,
        JSON.stringify({ ok: true, finishedAt: now.toISOString() }),
      )
      expect(await check()).toMatchObject({
        code: 0,
        result: { backup: true, drill: true, readiness: true },
      })
      await writeFile(
        env.SHEETBASE_DRILL_REPORT_PATH,
        JSON.stringify({ ok: false, finishedAt: now.toISOString() }),
      )
      expect(await check()).toMatchObject({
        code: 1,
        result: { backup: true, drill: false, readiness: true },
      })
      await writeFile(
        env.SHEETBASE_DRILL_REPORT_PATH,
        JSON.stringify({ ok: true, finishedAt: now.toISOString() }),
      )
      await writeFile(archive, 'tamper!')
      expect(await check()).toMatchObject({
        code: 1,
        result: { backup: false, drill: true, readiness: true },
      })
      await writeFile(archive, 'objects')
      ready = false
      expect(await check()).toMatchObject({
        code: 1,
        result: { backup: true, drill: true, readiness: false },
      })
      ready = true
      const old = new Date(now.getTime() - 3_600_001).toISOString()
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, startedAt: old, finishedAt: old }),
      )
      await writeFile(
        env.SHEETBASE_DRILL_REPORT_PATH,
        JSON.stringify({ ok: true, finishedAt: old }),
      )
      expect(await check()).toMatchObject({
        code: 1,
        result: { backup: false, drill: false, readiness: true },
      })
      const metrics = await readFile(
        join(work, 'sheetbase_recovery.prom'),
        'utf8',
      )
      expect(metrics).toContain('sheetbase_recovery_backup_healthy 0\n')
      expect(metrics).toContain('sheetbase_recovery_check_max_age_seconds 60\n')
    } finally {
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      )
      await rm(work, { recursive: true, force: true })
    }
  })
})
