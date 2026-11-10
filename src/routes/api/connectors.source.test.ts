// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Route } from './connectors.source'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

describe('connector source request boundary', () => {
  it('refuses malformed import contracts before any authenticated source operation', async () => {
    const handlers = Route.options.server?.handlers

    if (!handlers || !('POST' in handlers))
      throw new Error('Connector handlers are missing')

    const post = handlers.POST

    if (!post || !('apply' in post))
      throw new Error('Connector POST handler is missing')

    for (const body of [
      null,
      {
        workspaceId: 'w',
        connectorId: 'c',
        operation: 'preview',
        selector: [],
      },
      {
        workspaceId: 'w',
        connectorId: 'c',
        operation: 'import',
        source: {},
        target: {},
      },
      {
        workspaceId: 'w',
        connectorId: 'c',
        operation: 'import',
        source: {},
        target: { schemaVersionId: 'v', fields: [] },
        mappings: [{ source: 'Signal', kind: 'field', field: { id: 'f' } }],
      },
    ]) {
      const response = await post({
        request: new Request('http://localhost/api/connectors/source', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        context: undefined,
        params: {},
        pathname: '/api/connectors/source',
        next: () => {
          throw new Error('Unexpected middleware continuation')
        },
      })

      if (!(response instanceof Response))
        throw new Error('Connector handler did not return an HTTP response')
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_body' },
      })
    }
  })
})
