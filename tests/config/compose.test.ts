import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const composeRaw = readFileSync('compose.yaml', 'utf8')
const compose = parse(composeRaw) as {
  services: Record<string, any>
}
const previewComposeRaw = readFileSync('compose.preview.yaml', 'utf8')
const previewCompose = parse(previewComposeRaw) as {
  services: Record<string, any>
}

describe('compose.yaml service contract', () => {
  it('pins the PostgreSQL image', () => {
    expect(compose.services.postgres.image).toMatch(/^postgres:\d+/)
  })

  it('pins the PostgREST version', () => {
    expect(compose.services.postgrest.image).toMatch(
      /^sheetbase\/postgrest:v\d+\./,
    )
    expect(compose.services.postgrest.build.args.POSTGREST_VERSION).toMatch(
      /^v\d+\./,
    )
  })

  it('binds every published port to localhost only', () => {
    for (const [service, definition] of Object.entries(compose.services)) {
      for (const port of definition.ports ?? []) {
        expect(port, `${service} port ${port}`).toMatch(/^127\.0\.0\.1:/)
      }
    }
  })

  it('starts PostgREST only after PostgreSQL is healthy', () => {
    expect(compose.services.postgrest.depends_on.postgres.condition).toBe(
      'service_healthy',
    )
  })

  it('health-checks both services', () => {
    expect(compose.services.postgres.healthcheck.test.join(' ')).toContain(
      'pg_isready',
    )
    expect(compose.services.postgrest.healthcheck.test.join(' ')).toContain(
      '/ready',
    )
  })

  it('keeps secrets in environment configuration, not compose source', () => {
    expect(composeRaw).not.toContain('postgrest-dev-password')
    expect(composeRaw).not.toMatch(
      /PGRST_JWT_SECRET:\s*['"]?[A-Za-z0-9+/=]{16,}/,
    )
    for (const variable of [
      'POSTGRES_PASSWORD',
      'POSTGREST_AUTHENTICATOR_PASSWORD',
      'PGRST_DB_URI',
      'PGRST_JWT_SECRET',
    ]) {
      expect(composeRaw, variable).toContain(`\${${variable}:?`)
    }
  })
})

describe('compose.preview.yaml PR isolation contract', () => {
  it('requires an immutable PostgreSQL image and seeds the demo identity', () => {
    expect(previewComposeRaw).toContain(
      'image: ${SHEETBASE_POSTGRES_IMAGE:-postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15}',
    )
    expect(previewCompose.services.app.environment.SHEETBASE_PREVIEW_DEMO).toBe(
      'true',
    )
    expect(previewCompose.services.seed.command).toEqual([
      'node',
      '--import',
      'tsx',
      'src/db/seed/run.ts',
      '--demo',
    ])
  })

  it('uses a separate project and loopback-only, PR-specific app port', () => {
    expect(previewComposeRaw).toContain('name: ${SHEETBASE_PREVIEW_PROJECT:?')
    expect(previewCompose.services.app.ports[0]).toContain(
      '127.0.0.1:${SHEETBASE_PREVIEW_APP_PORT',
    )
    expect(previewCompose.services.app.ports[0]).not.toContain(':3000:3000')
  })

  it('keeps preview data disposable and services resource bounded', () => {
    expect(previewCompose.services.postgres.volumes.join(' ')).toContain(
      'postgres-data:/var/lib/postgresql',
    )
    expect(previewCompose.services.app.volumes.join(' ')).toContain(
      'object-storage:/app/.storage/objects',
    )
    for (const service of ['postgres', 'postgrest', 'app', 'migrate', 'seed']) {
      expect(previewCompose.services[service].mem_limit, service).toBeTruthy()
      expect(previewCompose.services[service].cpus, service).toBeTruthy()
      expect(previewCompose.services[service].pids_limit, service).toBeTruthy()
    }
  })

  it('does not configure OAuth credentials for concurrent previews', () => {
    expect(previewComposeRaw).not.toContain('GITHUB_CLIENT_ID')
    expect(previewComposeRaw).not.toContain('GITHUB_CLIENT_SECRET')
  })

  it('does not publish preview Postgres or PostgREST ports', () => {
    expect(previewCompose.services.postgres.ports).toBeUndefined()
    expect(previewCompose.services.postgrest.ports).toBeUndefined()
  })
})
