import { readFileSync } from 'node:fs'
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const dockerfile = readFileSync('Dockerfile', 'utf8')
const deployComposeRaw = readFileSync('compose.deploy.yaml', 'utf8')
const deployCompose = parse(deployComposeRaw) as {
  services: Record<string, any>
}

describe('REL-001 immutable deployment artifact contract', () => {
  it('keeps planning read-only and refuses migration until a fresh complete backup succeeds', () => {
    const work = mkdtempSync(join(tmpdir(), 'sheetbase-deploy-gate-'))
    const bin = join(work, 'bin')
    mkdirSync(bin)
    // Only the Docker transport is substituted. The real deploy controller,
    // backup producer, gzip completion and manifest validation all execute.
    writeFileSync(
      join(bin, 'docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG"
case "$1" in
  image) printf '%s' "$TEST_IMAGE_LABELS" ;;
  exec) [ "$TEST_BACKUP_FAIL" != 1 ] || exit 7; printf 'SELECT 1;\\n' ;;
  volume) exit 0 ;;
  run) for arg in "$@"; do case "$arg" in /backup/*) target="\${arg#/backup/}" ;; esac; done
       tar -czf "$SHEETBASE_BACKUP_DIR/$target" --files-from /dev/null ;;
  compose) exit 9 ;;
  *) exit 8 ;;
esac
`,
      { mode: 0o700 },
    )
    const journal = JSON.parse(
      readFileSync('drizzle/meta/_journal.json', 'utf8'),
    )
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SHEETBASE_ENV: 'production',
      SHEETBASE_SECRET_SOURCE: 'secret-manager',
      SHEETBASE_APP_IMAGE: `example/app@sha256:${'a'.repeat(64)}`,
      SHEETBASE_POSTGREST_IMAGE: `example/postgrest@sha256:${'b'.repeat(64)}`,
      SHEETBASE_PYTHON_IMAGE: '',
      SHEETBASE_PYTHON_RUNNER_IMAGE: '',
      BETTER_AUTH_URL: 'https://recovery.test',
      DATABASE_URL: 'postgresql://test@postgres/sheetbase',
      SHEETBASE_READINESS_URL: 'https://recovery.test/api/health/ready',
      GITHUB_CLIENT_ID: 'test',
      GITHUB_CLIENT_SECRET: 'test',
      POSTGRES_USER: 'sheetbase',
      POSTGRES_DB: 'sheetbase',
      SHEETBASE_BACKUP_DIR: join(work, 'backups'),
      SHEETBASE_METRICS_TEXTFILE_DIR: '',
      // These bypass attempts must not affect the deployment's backup requirements.
      SHEETBASE_BACKUP_INCLUDE_OBJECTS: 'false',
      SHEETBASE_BACKUP_LOCAL: 'true',
      TEST_COMMAND_LOG: join(work, 'commands'),
      TEST_IMAGE_LABELS: JSON.stringify({
        'org.opencontainers.image.version': 'test-release',
        'org.opencontainers.image.revision': 'test-revision',
        'uk.co.sheetbase.expected-migration': String(
          journal.entries.at(-1).when,
        ),
      }),
    }
    try {
      const plan = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/deploy.ts', '--plan'],
        { env, encoding: 'utf8' },
      )
      expect(plan.status, plan.stderr).toBe(0)
      expect(existsSync(env.SHEETBASE_BACKUP_DIR)).toBe(false)
      expect(readFileSync(env.TEST_COMMAND_LOG, 'utf8')).not.toContain(
        'pg_dump',
      )
      const failed = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/deploy.ts', '--apply'],
        { env: { ...env, TEST_BACKUP_FAIL: '1' }, encoding: 'utf8' },
      )
      expect(failed.status).toBe(1)
      expect(failed.stderr).toContain('migration was not started')
      expect(readFileSync(env.TEST_COMMAND_LOG, 'utf8')).not.toContain(
        'run --rm migrate',
      )
      // Different store avoids a same-second set collision with the failed run.
      const completeEnv = {
        ...env,
        SHEETBASE_BACKUP_DIR: join(work, 'complete'),
      }
      const complete = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/deploy.ts', '--apply'],
        { env: completeEnv, encoding: 'utf8' },
      )
      expect(complete.status).toBe(1) // Deliberate migrate transport failure, AFTER backup.
      expect(complete.stderr).toContain('run --rm migrate failed')
      expect(
        existsSync(join(completeEnv.SHEETBASE_BACKUP_DIR, 'latest.json')),
      ).toBe(true)
      expect(readFileSync(env.TEST_COMMAND_LOG, 'utf8')).toContain(
        'volume inspect',
      )
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it('requires the build caller to supply a pinned Node base image', () => {
    // The ARG has a mutable default only to satisfy Dockerfile lint; CI
    // always overrides it with an immutable @sha256 digest via --build-arg.
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=/m)
    expect(dockerfile).toMatch(/^FROM \$\{NODE_IMAGE\}/m)
    expect(dockerfile).not.toMatch(/^FROM node:/m)
  })

  it('records version, source revision and migration compatibility metadata', () => {
    for (const label of [
      'org.opencontainers.image.version',
      'org.opencontainers.image.revision',
      'uk.co.sheetbase.expected-migration',
    ]) {
      expect(dockerfile).toContain(label)
    }
  })

  it('runs the production server emitted by the verified build', () => {
    expect(dockerfile).toContain('CMD ["node", "scripts/serve-production.mjs"]')
  })

  it('requires immutable application and PostgREST image inputs', () => {
    expect(deployCompose.services.app.image).toContain(
      '${SHEETBASE_APP_IMAGE:?',
    )
    expect(deployCompose.services.postgrest.image).toContain(
      '${SHEETBASE_POSTGREST_IMAGE:?',
    )
    expect(deployComposeRaw).not.toContain(':latest')
  })

  it('keeps migration explicit and gates the app on PostgREST readiness', () => {
    expect(deployCompose.services.migrate.profiles).toContain('deployment')
    // PLAT-01: the runner owns both the lock and Drizzle migration session.
    expect(deployCompose.services.migrate.command.join(' ')).toContain(
      'scripts/migrate-once.mjs',
    )
    expect(deployCompose.services.app.depends_on.postgrest.condition).toBe(
      'service_healthy',
    )
    expect(deployCompose.services.app.healthcheck.test.join(' ')).toContain(
      '/api/health/ready',
    )
  })

  it('uses the same migration runner for local and development upgrades', () => {
    const development = parse(readFileSync('compose.dev.yaml', 'utf8'))
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(development.services.migrate.command).toEqual([
      'node',
      'scripts/migrate-once.mjs',
    ])
    expect(manifest.scripts['db:migrate']).toBe('node scripts/migrate-once.mjs')
  })

  it('does not let Compose override artifact-baked version or migration identity', () => {
    expect(deployCompose.services.app.environment).not.toHaveProperty(
      'SHEETBASE_ARTIFACT_VERSION',
    )
    expect(deployCompose.services.app.environment).not.toHaveProperty(
      'SHEETBASE_EXPECTED_MIGRATION',
    )
    expect(deployCompose.services.app.environment).toHaveProperty(
      'SHEETBASE_ARTIFACT_DIGEST',
    )
  })

  it('requires startup readiness before the production adapter listens', () => {
    const adapter = readFileSync('scripts/serve-production.mjs', 'utf8')
    expect(adapter).toContain('await assertStartupReady()')
    expect(adapter.indexOf('await assertStartupReady()')).toBeLessThan(
      adapter.indexOf('server.listen('),
    )
  })
})
