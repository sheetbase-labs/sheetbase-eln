import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const dockerfile = readFileSync('Dockerfile', 'utf8')
const deployComposeRaw = readFileSync('compose.deploy.yaml', 'utf8')
const deployCompose = parse(deployComposeRaw) as {
  services: Record<string, any>
}

describe('REL-001 immutable deployment artifact contract', () => {
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
