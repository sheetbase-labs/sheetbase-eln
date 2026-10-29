import { describe, expect, it } from 'vitest'

import { isSameOriginRequest } from './request-origin'

const post = (url: string, headers: Record<string, string>) =>
  new Request(url, { method: 'POST', headers })

describe('isSameOriginRequest', () => {
  it('accepts the request URL origin', () => {
    expect(
      isSameOriginRequest(
        post('http://localhost:3000/api/x', {
          origin: 'http://localhost:3000',
        }),
      ),
    ).toBe(true)
  })

  it('accepts the public origin behind a proxy that terminates TLS', () => {
    // The server sees http://app.example internally; the browser sends https.
    expect(
      isSameOriginRequest(
        post('http://app.example/api/x', {
          origin: 'https://app.example',
          host: 'app.example',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(true)
  })

  it('uses the forwarded host when the proxy rewrites it', () => {
    expect(
      isSameOriginRequest(
        post('http://10.0.0.5:3000/api/x', {
          origin: 'https://lab.example.com',
          'x-forwarded-host': 'lab.example.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(true)
  })

  it('accepts the configured public URL', () => {
    expect(
      isSameOriginRequest(
        post('http://10.0.0.5:3000/api/x', {
          origin: 'https://lab.example.com',
        }),
        'https://lab.example.com/',
      ),
    ).toBe(true)
  })

  it('rejects another site, a missing origin and a forged protocol only', () => {
    expect(
      isSameOriginRequest(
        post('http://app.example/api/x', { origin: 'https://evil.example' }),
      ),
    ).toBe(false)
    expect(isSameOriginRequest(post('http://app.example/api/x', {}))).toBe(
      false,
    )
    expect(
      isSameOriginRequest(
        post('http://app.example/api/x', {
          origin: 'https://evil.example',
          host: 'app.example',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe(false)
  })
})
