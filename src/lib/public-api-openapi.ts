/**
 * API-03: OpenAPI 3.1 description of the **service-credential** API that
 * exists today. Paths are generated from the API-07 allowlist
 * (`EXTERNAL_TABLE_ACCESS` / `EXTERNAL_RPC_SCOPES`). Human-session
 * attestation RPCs are listed here so tests can prove they are absent from
 * the spec.
 */
import {
  EXTERNAL_RPC_SCOPES,
  EXTERNAL_TABLE_ACCESS,
} from '#/lib/external-token'
import type { Scope } from '#/lib/api-credential-scopes'
import { VALID_SCOPES } from '#/lib/api-credential-scopes'

export const OPENAPI_SPEC_PATH =
  'docs/openapi/service-credentials-v0.json' as const

export const HUMAN_SESSION_ONLY_RPCS = [
  'submit_record_revision',
  'run_revision_checks',
  'sign_revision',
  'create_amendment',
] as const

const SCHEMA_AUTHORING_RPCS = [
  'create_dataset_schema_definition',
  'create_sheet_definition',
  'extract_sheet_definition_draft',
  'create_notebook_template',
] as const

type JsonSchema = Record<string, unknown>
type OpenApiOperation = Record<string, unknown>
type OpenApiPathItem = Record<string, unknown>

export interface ServiceCredentialOpenApi {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    description: string
  }
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string; description: string }>
  paths: Record<string, OpenApiPathItem>
  components: {
    securitySchemes: Record<string, unknown>
    schemas: Record<string, JsonSchema>
  }
}

function errorSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['error'],
    additionalProperties: false,
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          category: { type: 'string' },
          request_id: { type: 'string' },
        },
      },
    },
  }
}

function tokenErrorResponses(): Record<string, unknown> {
  return {
    '400': {
      description: 'invalid_request or invalid_scope',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '401': {
      description: 'invalid_credential',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '403': {
      description: 'revoked, expired, or insufficient_scope',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '429': {
      description: 'rate_limited',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
  }
}

function proxyErrorResponses(): Record<string, unknown> {
  return {
    '400': {
      description: 'validation_error',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '401': {
      description: 'unauthenticated — missing or invalid bearer token',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '403': {
      description:
        'permission_denied — missing scope, revoked credential, or RLS',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '404': {
      description: 'not_found or hidden by RLS',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
    '409': {
      description: 'stale_version or conflict',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    },
  }
}

function scopeExtension(scopes: readonly Scope[]): Record<string, unknown> {
  return {
    'x-sheetbase-scopes': [...scopes],
  }
}

function tagForTable(resource: string): string {
  if (
    resource.startsWith('dataset_schema') ||
    resource.startsWith('sheet_definition')
  ) {
    return 'Catalogues'
  }
  if (resource.startsWith('notebook_template')) return 'Templates'
  if (resource.startsWith('dataset')) return 'Datasets'
  if (resource.startsWith('sheet_')) return 'Sheets'
  return 'Projects'
}

function tagForRpc(resource: string, scopes: readonly Scope[]): string {
  if (resource.startsWith('query_dataset') || resource.includes('dataset')) {
    return 'Datasets'
  }
  if (
    resource.includes('sheet_instance') ||
    resource.includes('sheet_record')
  ) {
    return 'Sheets'
  }
  if (resource.includes('notebook_template')) return 'Templates'
  if (resource === 'preview_submission_digest') return 'Reviews'
  if (scopes.includes('models:read') || scopes.includes('models:write')) {
    return 'Models'
  }
  if (resource === 'search') return 'Search'
  return 'Projects'
}

function tableOperations(resource: string): OpenApiPathItem {
  const access = EXTERNAL_TABLE_ACCESS[resource]
  const item: OpenApiPathItem = {}
  const readOp: OpenApiOperation = {
    tags: [tagForTable(resource)],
    summary: `Read ${resource}`,
    operationId: `get_${resource}`,
    security: [{ bearerAuth: [] }],
    ...scopeExtension([access.read]),
    parameters: [
      {
        name: 'select',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'PostgREST column list, e.g. key,title',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1 },
      },
      {
        name: 'offset',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 0 },
      },
      {
        name: 'order',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'PostgREST order, e.g. created_at.desc',
      },
    ],
    responses: {
      '200': { description: `Rows from ${resource}` },
      ...proxyErrorResponses(),
    },
  }
  item.get = readOp
  item.head = {
    ...readOp,
    operationId: `head_${resource}`,
    summary: `Headers for ${resource}`,
  }

  if (!access.write) return item

  // Catalogue and Sheet Instance tables are GET-only; writes go through RPCs.
  // datasets INSERT is the only Core table write besides project-domain tables.
  const projectWritable = [
    'projects',
    'folders',
    'records',
    'blocks',
    'record_links',
    'record_field_definitions',
  ]
  if (resource === 'datasets') {
    item.post = {
      tags: ['Datasets'],
      summary: 'Create a Dataset (INSERT)',
      operationId: 'post_datasets',
      security: [{ bearerAuth: [] }],
      ...scopeExtension(['datasets:write']),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
          },
        },
      },
      responses: {
        '201': { description: 'Created Dataset' },
        ...proxyErrorResponses(),
      },
    }
    return item
  }
  if (!projectWritable.includes(resource)) return item

  item.post = {
    tags: ['Projects'],
    summary: `Create ${resource}`,
    operationId: `post_${resource}`,
    security: [{ bearerAuth: [] }],
    ...scopeExtension([access.write]),
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
        },
      },
    },
    responses: {
      '201': { description: `Created ${resource}` },
      ...proxyErrorResponses(),
    },
  }
  item.patch = {
    tags: ['Projects'],
    summary: `Update ${resource}`,
    operationId: `patch_${resource}`,
    security: [{ bearerAuth: [] }],
    ...scopeExtension([access.write]),
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
        },
      },
    },
    responses: {
      '200': { description: `Updated ${resource}` },
      ...proxyErrorResponses(),
    },
  }
  return item
}

function rpcOperation(resource: string, scopes: Scope[]): OpenApiOperation {
  return {
    tags: [tagForRpc(resource, scopes)],
    summary: resource.replaceAll('_', ' '),
    operationId: `rpc_${resource}`,
    security: [{ bearerAuth: [] }],
    ...scopeExtension(scopes),
    description:
      'PostgREST RPC. Request body fields use PostgreSQL argument names (`p_*`). Bounded list RPCs take `p_limit` / `p_offset` or a query object. Dataset commits require an idempotency key.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: true,
            description: 'RPC arguments named p_* as in PostgreSQL.',
          },
        },
      },
    },
    responses: {
      '200': { description: `Result of ${resource}` },
      ...proxyErrorResponses(),
    },
  }
}

function description(): string {
  return [
    'Service-credential API for Sheetbase v0.1.',
    '',
    'Authenticate with `POST /api/token`, then call `/api/db/*` with the returned JWT as `Authorization: Bearer`.',
    'Only operations an API key can complete are listed. Unknown paths fail closed.',
    '',
    'Human-session-only (not callable with an API key): `submit_record_revision`, `run_revision_checks`, `sign_revision`, `create_amendment` and other review-transition writers.',
    '`reviews:write` is mintable but does not open submit, sign, or amend.',
    '`reviews:read` opens `preview_submission_digest` only.',
    '',
    'Schema-authoring RPCs, file RPCs, and scientific-table REST are not part of this API.',
    'DELETE on `projects` is not granted to `api_client`.',
    '',
    'Narrative contract: `docs/public-api-contract.md`. Credential mechanics: `docs/external-api.md`.',
  ].join('\n')
}

export function buildServiceCredentialOpenApi(): ServiceCredentialOpenApi {
  const paths: Record<string, OpenApiPathItem> = {
    '/api/token': {
      post: {
        tags: ['Token'],
        summary: 'Exchange a credential for a short-lived JWT',
        operationId: 'exchangeToken',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TokenExchangeRequest' },
              example: {
                credential: 'sb_01234567_0123456789abcdef0123456789abcdef',
                scopes: ['datasets:read', 'datasets:write'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'JWT minted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenExchangeResponse' },
              },
            },
          },
          ...tokenErrorResponses(),
        },
      },
    },
  }

  for (const resource of Object.keys(EXTERNAL_TABLE_ACCESS).sort()) {
    paths[`/api/db/${resource}`] = tableOperations(resource)
  }

  for (const resource of Object.keys(EXTERNAL_RPC_SCOPES).sort()) {
    paths[`/api/db/rpc/${resource}`] = {
      post: rpcOperation(resource, EXTERNAL_RPC_SCOPES[resource]),
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Sheetbase service-credential API',
      version: '0.1.0',
      description: description(),
    },
    servers: [
      { url: 'https://app.sheetbase.co.uk', description: 'Production' },
      { url: 'https://dev.sheetbase.co.uk', description: 'Development demo' },
    ],
    tags: [
      {
        name: 'Token',
        description: 'Credential exchange. No bearer token required.',
      },
      { name: 'Projects', description: 'Project-domain tables and RPCs.' },
      {
        name: 'Datasets',
        description: 'Dataset query, commit, snapshot. Not schema authoring.',
      },
      {
        name: 'Sheets',
        description:
          'Sheet Instance reads and mutations. Does not author Sheet Definitions.',
      },
      { name: 'Models', description: 'Model record search and write-back.' },
      {
        name: 'Catalogues',
        description: 'schema:read GET of Dataset Schema and Sheet Definitions.',
      },
      {
        name: 'Templates',
        description: 'Notebook template catalogue and instantiation.',
      },
      { name: 'Search', description: 'Workspace search.' },
      {
        name: 'Reviews',
        description:
          'Digest preview only. Submit, sign, amend and revision checks are human-session-only.',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'JWT from POST /api/token. Claims: workspace_id, credential_id, scopes, role=api_client. Default TTL 300s.',
        },
      },
      schemas: {
        Error: errorSchema(),
        TokenExchangeRequest: {
          type: 'object',
          required: ['credential', 'scopes'],
          additionalProperties: false,
          properties: {
            credential: {
              type: 'string',
              description: 'sb_<8 hex prefix>_<32 hex secret>',
            },
            scopes: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: [...VALID_SCOPES] },
            },
          },
        },
        TokenExchangeResponse: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: { token: { type: 'string' } },
        },
      },
    },
  }
}

export function openApiRpcNames(spec: ServiceCredentialOpenApi): string[] {
  return Object.keys(spec.paths)
    .filter((path) => path.startsWith('/api/db/rpc/'))
    .map((path) => path.slice('/api/db/rpc/'.length))
    .sort()
}

export function openApiTableNames(spec: ServiceCredentialOpenApi): string[] {
  return Object.keys(spec.paths)
    .filter(
      (path) => path.startsWith('/api/db/') && !path.startsWith('/api/db/rpc/'),
    )
    .map((path) => path.slice('/api/db/'.length))
    .sort()
}

export { SCHEMA_AUTHORING_RPCS }
