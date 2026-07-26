import { describe, expect, it } from 'vitest'

import {
  evaluateMigrationCompatibility,
  livenessResponse,
  readinessResponse,
} from './health'
import { REQUEST_ID_HEADER } from './request-id'

describe('livenessResponse', () => {
  it('returns 200 with status live and stamps the request id', async () => {
    const request = new Request('http://localhost/api/health/live', {
      headers: { [REQUEST_ID_HEADER]: 'probe-live-1' },
    })
    const response = livenessResponse(request)
    expect(response.status).toBe(200)
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('probe-live-1')
    expect(await response.json()).toEqual({ status: 'live' })
  })
})

describe('readinessResponse', () => {
  it('returns 200 when the report is ready', async () => {
    const request = new Request('http://localhost/api/health/ready')
    const response = readinessResponse(request, {
      status: 'ready',
      artifact: { version: 'local', digest: 'untracked' },
      database: { ok: true, latencyMs: 1 },
      postgrest: { ok: true, latencyMs: 2 },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ready')
    expect(body.database.ok).toBe(true)
    expect(body.postgrest.ok).toBe(true)
    // Error detail is stripped from the public body.
    expect(body.database.error).toBeUndefined()
  })

  it('returns 503 when either dependency is not ready', async () => {
    const request = new Request('http://localhost/api/health/ready')
    const response = readinessResponse(request, {
      status: 'not_ready',
      artifact: { version: 'local', digest: 'untracked' },
      database: { ok: true, latencyMs: 1 },
      postgrest: { ok: false, latencyMs: 2 },
    })
    expect(response.status).toBe(503)
    expect((await response.json()).postgrest.ok).toBe(false)
  })

  it('stamps a generated request id when none is provided', () => {
    const request = new Request('http://localhost/api/health/ready')
    const response = readinessResponse(request, {
      status: 'ready',
      artifact: { version: 'local', digest: 'untracked' },
      database: { ok: true, latencyMs: 1 },
      postgrest: { ok: true, latencyMs: 2 },
    })
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[a-f0-9]{32}$/)
  })
})

describe('evaluateMigrationCompatibility', () => {
  it('accepts only the exact migration baked into a deployed artifact', () => {
    expect(
      evaluateMigrationCompatibility('1784920000000', '1784920000000'),
    ).toEqual({
      status: 'compatible',
      expected: '1784920000000',
      applied: '1784920000000',
    })
    expect(
      evaluateMigrationCompatibility('1784920000000', '1784910000000'),
    ).toEqual({
      status: 'incompatible',
      expected: '1784920000000',
      applied: '1784910000000',
    })
  })

  it('reports local development as not checked when no artifact contract exists', () => {
    expect(evaluateMigrationCompatibility('untracked', null)).toEqual({
      status: 'not_checked',
      expected: 'untracked',
      applied: null,
    })
  })
})
