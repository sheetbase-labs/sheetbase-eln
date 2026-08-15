import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const composeRaw = readFileSync('compose.yaml', 'utf8')
const compose = parse(composeRaw) as {
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
