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
import { z } from 'zod'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import {
  connectorImportMappingsSchema,
  connectorImportTargetSchema,
} from '#/lib/connectors/enterprise/adapter'

import {
  boundedErrorMessage,
  ConnectorExecutionError,
} from '#/lib/connectors/enterprise/errors'
import {
  discoverConnectorSource,
  importConnectorSource,
  previewConnectorSource,
  testConnectorConnection,
} from '#/lib/connectors/enterprise/operations.server'

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/connectors/source')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof pipelineJsonObjectSchema>

        try {
          body = pipelineJsonObjectSchema.parse(await request.json())
        } catch {
          return errorResponse(
            400,
            'invalid_body',
            'Request body must be JSON.',
          )
        }

        const identity = z
          .object({ workspaceId: z.string(), connectorId: z.string() })
          .safeParse(body)

        if (!identity.success) {
          return errorResponse(
            400,
            'invalid_body',
            'workspaceId and connectorId are required.',
          )
        }

        const base = identity.data

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
                  pipelineJsonObjectSchema.safeParse(body['query']).data ?? {},
              })

              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }

            case 'preview': {
              const selector = pipelineJsonObjectSchema.safeParse(
                body['selector'],
              )

              if (!selector.success) {
                return errorResponse(
                  400,
                  'invalid_body',
                  'selector is required.',
                )
              }

              const result = await previewConnectorSource({
                ...base,
                selector: selector.data,
              })

              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }

            case 'import': {
              const source = pipelineJsonObjectSchema.safeParse(body['source'])

              if (!source.success) {
                return errorResponse(400, 'invalid_body', 'source is required.')
              }

              const target = connectorImportTargetSchema.safeParse(
                body['target'],
              )

              if (!target.success) {
                return errorResponse(400, 'invalid_body', 'target is required.')
              }

              const mappings = connectorImportMappingsSchema.safeParse(
                body['mappings'],
              )

              if (Array.isArray(body['mappings']) && !mappings.success) {
                return errorResponse(
                  400,
                  'invalid_body',
                  'mappings must describe source columns and target fields.',
                )
              }

              const result = await importConnectorSource({
                ...base,
                source: source.data,
                projectId: z.string().safeParse(body['projectId']).data ?? null,
                target: target.data,
                mappings: mappings.data ?? null,
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

          return errorResponse(
            500,
            'operation_failed',
            boundedErrorMessage(error),
          )
        }
      },
    },
  },
})
