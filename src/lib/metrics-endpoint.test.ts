import { describe, expect, it } from 'vitest'

import { handleMetricsRequest } from './metrics-endpoint'

const TOKEN = 'metrics-token-value-at-least-32-chars-long!!'

describe('metrics endpoint access model', () => {
  it('serves exposition when the bearer token matches', async () => {
    const response = await handleMetricsRequest(
      new Request('http://localhost/api/metrics', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      { token: TOKEN, environment: 'production' },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const body = await response.text()
    expect(body).toContain('sheetbase_http_requests_total')
    // Correlation: the endpoint honours request ids like every other route.
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('rejects a wrong token without leaking the surface', async () => {
    const response = await handleMetricsRequest(
      new Request('http://localhost/api/metrics', {
        headers: {
          authorization: 'Bearer wrong-token-wrong-token-wrong-token',
        },
      }),
      { token: TOKEN, environment: 'production' },
    )
    expect(response.status).toBe(401)
  })

  it('fails closed in deployed environments when no token is configured', async () => {
    for (const environment of ['staging', 'production'] as const) {
      const response = await handleMetricsRequest(
        new Request('http://localhost/api/metrics'),
        { environment },
      )
      expect(response.status).toBe(404)
    }
  })

  it('allows unauthenticated scraping in development without a token', async () => {
    const response = await handleMetricsRequest(
      new Request('http://localhost/api/metrics'),
      { environment: 'development' },
    )
    expect(response.status).toBe(200)
  })
})
