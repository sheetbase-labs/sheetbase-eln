/**
 * INT-03 — server-side enterprise connector operations endpoint.
 *
 * POST /api/connectors/source with an `operation` discriminator:
 *   test | discover | preview | import
 *
 * The browser never reaches the external system directly and never receives
 * decrypted credentials; every operation resolves the session server-side
 * and returns bounded, safe payloads. Errors use the same envelope as the
 * rest of the API (`{ error: { code, message } }`).
 */
import { createFileRoute } from '@tanstack/react-router'

import {
  boundedErrorMessage,
  ConnectorExecutionError,
} from '#/lib/connectors/enterprise/execution.server'
import {
  discoverConnectorSource,
  importConnectorSource,
  previewConnectorSource,
  testConnectorConnection,
} from '#/lib/connectors/enterprise/operations.server'

interface SourceOperationBody {
  operation?: unknown
  workspaceId?: unknown
  connectorId?: unknown
  query?: unknown
  selector?: unknown
  source?: unknown
  projectId?: unknown
  target?: unknown
  mappings?: unknown
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/connectors/source')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: SourceOperationBody
        try {
          body = (await request.json()) as SourceOperationBody
        } catch {
          return errorResponse(400, 'invalid_body', 'Request body must be JSON.')
        }
        if (
          typeof body['workspaceId'] !== 'string' ||
          typeof body['connectorId'] !== 'string'
        ) {
          return errorResponse(
            400,
            'invalid_body',
            'workspaceId and connectorId are required.',
          )
        }
        const base = {
          workspaceId: body['workspaceId'],
          connectorId: body['connectorId'],
        }
        try {
          switch (body['operation']) {
            case 'test': {
              const result = await testConnectorConnection(base)
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
            case 'discover': {
              const result = await discoverConnectorSource({
                ...base,
                query:
                  body['query'] && typeof body['query'] === 'object'
                    ? (body['query'] as Record<string, unknown>)
                    : {},
              })
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
            case 'preview': {
              if (!body['selector'] || typeof body['selector'] !== 'object') {
                return errorResponse(400, 'invalid_body', 'selector is required.')
              }
              const result = await previewConnectorSource({
                ...base,
                selector: body['selector'] as Record<string, unknown>,
              })
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
            case 'import': {
              if (!body['source'] || typeof body['source'] !== 'object') {
                return errorResponse(400, 'invalid_body', 'source is required.')
              }
              if (!body['target'] || typeof body['target'] !== 'object') {
                return errorResponse(400, 'invalid_body', 'target is required.')
              }
              const result = await importConnectorSource({
                ...base,
                source: body['source'] as Record<string, unknown>,
                projectId:
                  typeof body['projectId'] === 'string' ? body['projectId'] : null,
                target: body['target'] as never,
                mappings: Array.isArray(body['mappings'])
                  ? (body['mappings'] as Array<Record<string, unknown>>)
                  : null,
              })
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
            default:
              return errorResponse(
                400,
                'invalid_body',
                'operation must be test, discover, preview or import.',
              )
          }
        } catch (error) {
          if (error instanceof ConnectorExecutionError) {
            return errorResponse(400, error.code, boundedErrorMessage(error))
          }
          return errorResponse(500, 'operation_failed', boundedErrorMessage(error))
        }
      },
    },
  },
})
