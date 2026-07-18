import { describe, expect, it } from 'vitest'

import { livenessResponse, readinessResponse } from './health'
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
      database: { ok: true, latencyMs: 1 },
      postgrest: { ok: true, latencyMs: 2 },
    })
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[a-f0-9]{32}$/)
  })
})
