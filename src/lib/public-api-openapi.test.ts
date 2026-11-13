import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  EXTERNAL_RPC_SCOPES,
  EXTERNAL_TABLE_ACCESS,
  requiredScopes,
} from '#/lib/external-token'
import { errorEnvelope } from '#/lib/errors'
import { LAB_RPCS } from '#/lib/lab-api-surface'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import {
  HUMAN_SESSION_ONLY_RPCS,
  OPENAPI_SPEC_PATH,
  SCHEMA_AUTHORING_RPCS,
  buildExternalApiOpenApi,
  openApiRpcNames,
  openApiTableNames,
} from '#/lib/public-api-openapi'
import {
  POSTGREST_FILTER_OPERATORS,
  RPC_CONTRACTS,
  TOKEN_ERROR_CODES,
} from '#/lib/public-api-rpc-contracts'

const spec = buildExternalApiOpenApi()

const committed = z
  .json()
  .parse(JSON.parse(readFileSync(OPENAPI_SPEC_PATH, 'utf8')))

const packageJson = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .parse(JSON.parse(readFileSync('package.json', 'utf8')))

// These are OpenAPI 3.1 / JSON Schema keywords, not application field names.
const schemaContract = z.strictObject({
  $ref: z.string().optional(),
  type: z
    .union([
      z.enum([
        'object',
        'array',
        'string',
        'number',
        'integer',
        'boolean',
        'null',
      ]),
      z.array(
        z.enum([
          'object',
          'array',
          'string',
          'number',
          'integer',
          'boolean',
          'null',
        ]),
      ),
    ])
    .optional(),
  description: z.string().optional(),
  format: z.string().optional(),
  required: z.array(z.string()).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  pattern: z.string().optional(),
  nullable: z.boolean().optional(),
  const: z.json().optional(),
  enum: z.array(z.json()).optional(),
  default: z.json().optional(),
  get properties() {
    return z.record(z.string(), schemaContract).optional()
  },
  get items() {
    return z.union([z.boolean(), schemaContract]).optional()
  },
  get additionalProperties() {
    return z.union([z.boolean(), schemaContract]).optional()
  },
  get not() {
    return z.union([z.boolean(), schemaContract]).optional()
  },
  get oneOf() {
    return z.array(z.union([z.boolean(), schemaContract])).optional()
  },
  get anyOf() {
    return z.array(z.union([z.boolean(), schemaContract])).optional()
  },
  get allOf() {
    return z.array(z.union([z.boolean(), schemaContract])).optional()
  },
  get prefixItems() {
    return z.array(z.union([z.boolean(), schemaContract])).optional()
  },
})

const contentContract = z.object({
  'application/json': z.object({ schema: schemaContract }),
})

const requestContract = z.object({ content: contentContract })

const responsesContract = z.record(
  z.string(),
  z.object({ content: contentContract.optional() }),
)

const operationContract = z.object({
  description: z.string().optional(),
  'x-sheetbase-scopes': z.array(z.string()).optional(),
  requestBody: requestContract.optional(),
  responses: responsesContract,
  parameters: z.array(z.object({ $ref: z.string().optional() })).optional(),
})

const schemas = z
  .record(z.string(), schemaContract)
  .parse(spec.components.schemas)

const descriptionContract = z.object({ description: z.string() })

const envelopeContract = z.object({
  error: z.strictObject({
    category: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
})

function operation(path: string, method: string) {
  const item = spec.paths[path]
  expect(item, path).toBeTruthy()
  const op = item[method]
  expect(op, `${method} ${path}`).toBeTruthy()

  return operationContract.parse(op)
}

function rpcRequestSchema(name: string) {
  const op = operation(`/api/db/rpc/${name}`, 'post')

  const body = requestContract.parse(op.requestBody)

  return body.content['application/json'].schema
}

/** The parameters of a lab RPC, or undefined for one declared elsewhere. */
function labParams(name: string): number | undefined {
  return Object.entries(LAB_RPCS).find(([rpc]) => rpc === name)?.[1].params
    .length
}

describe('API-03 external OpenAPI', () => {
  it('keeps generate-routes and adds openapi:generate', () => {
    // The route generator still exists alongside the OpenAPI one. It runs the
    // wrapper, not `tsr generate` directly: the raw generator strips the
    // committed SSR registration block from routeTree.gen.ts.
    expect(packageJson.scripts['generate-routes']).toContain(
      'scripts/generate-routes.mjs',
    )
    expect(packageJson.scripts['openapi:generate']).toContain(
      'scripts/generate-public-openapi.ts',
    )
  })

  it('describes one external surface covering both credential kinds', () => {
    expect(spec.info.title).toBe('Sheetbase external API')
    const description = spec.info.description
    // Service credentials act as the workspace identity; personal tokens act
    // as their creating member.
    expect(description).toMatch(/role: 'api_client'/)
    expect(description).toMatch(/role: 'authenticated'/)
    expect(description).toMatch(/creating member/)
    expect(description).toMatch(/same canonical scopes/)
    expect(description).toMatch(/fail-closed external allowlist/)
  })

  it('states personal tokens have no browser session and stop with membership', () => {
    const description = spec.info.description
    expect(description).toMatch(/Removing or suspending the creating member/)
    expect(description).toMatch(/no `session_id` claim/)

    const bearer = descriptionContract.parse(
      spec.components.securitySchemes.bearerAuth,
    )

    expect(bearer.description).toMatch(/role=api_client/)
    expect(bearer.description).toMatch(/role=authenticated/)
    expect(bearer.description).toMatch(/no session_id claim/)
  })

  it('documents token exchange accepting both credential kinds', () => {
    const op = operation('/api/token', 'post')
    expect(op.description).toMatch(/service credentials/)
    expect(op.description).toMatch(/personal API tokens/)

    const body = requestContract.parse(
      operation('/api/token', 'post').requestBody,
    ).content['application/json'].schema

    expect(body.$ref).toBe('#/components/schemas/TokenExchangeRequest')

    const requestSchema = schemas.TokenExchangeRequest

    expect(requestSchema.properties?.credential.description).toMatch(
      /[Bb]oth service credentials and personal tokens/,
    )
  })

  it('matches the committed spec file', () => {
    expect(committed).toEqual(spec)
  })

  it('lists exactly the API-07 allowlisted tables and RPCs', () => {
    expect(openApiTableNames(spec)).toEqual(
      Object.keys(EXTERNAL_TABLE_ACCESS).sort(),
    )
    expect(openApiRpcNames(spec)).toEqual(
      Object.keys(EXTERNAL_RPC_SCOPES).sort(),
    )
  })

  it('records the same scopes requiredScopes() enforces', () => {
    for (const [resource, scopes] of Object.entries(EXTERNAL_RPC_SCOPES)) {
      const operationItem = operation(`/api/db/rpc/${resource}`, 'post')
      expect(operationItem['x-sheetbase-scopes']).toEqual(scopes)
      expect(requiredScopes('POST', { kind: 'rpc', resource })).toEqual(scopes)
    }

    for (const [resource, access] of Object.entries(EXTERNAL_TABLE_ACCESS)) {
      const getOp = operation(`/api/db/${resource}`, 'get')
      expect(getOp['x-sheetbase-scopes']).toEqual([access.read])
      expect(requiredScopes('GET', { kind: 'table', resource })).toEqual([
        access.read,
      ])
    }
  })

  it('does not publish human-session attestation RPCs', () => {
    const rpcs = openApiRpcNames(spec)

    for (const name of HUMAN_SESSION_ONLY_RPCS) {
      expect(rpcs).not.toContain(name)
      expect(spec.info.description).toContain(name)
    }

    expect(spec.info.description).toMatch(/reviews:write/)
    expect(spec.info.description).toMatch(
      /does not open submit, sign, or amend/,
    )
  })

  it('opens reviews:write only to approving and deciding, never submit, sign or amend', () => {
    const approvals = [
      'approve_approval_request',
      'return_approval_request',
      'approve_review',
      'reject_review',
      'request_changes_on_review',
    ]

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const value of Object.values(methods)) {
        const scopes =
          operationContract.parse(value)['x-sheetbase-scopes'] ?? []

        if (!scopes.includes('reviews:write')) continue
        expect(approvals.map((name) => `/api/db/rpc/${name}`)).toContain(path)
      }
    }

    const preview = operation('/api/db/rpc/preview_submission_digest', 'post')
    expect(preview['x-sheetbase-scopes']).toEqual(['reviews:read'])
  })

  it('omits schema-authoring and scientific-table paths', () => {
    const rpcs = openApiRpcNames(spec)

    for (const name of SCHEMA_AUTHORING_RPCS) {
      expect(rpcs).not.toContain(name)
    }

    expect(rpcs).not.toContain('query_dataset')
    expect(rpcs).not.toContain('create_scientific_table')
    expect(
      Object.keys(spec.paths).some((path) => path.includes('sheet_')),
    ).toBe(true)
    expect(
      Object.keys(spec.paths).some((path) =>
        /^\/api\/db\/sheet_[a-z2-7]{26}$/.test(path),
      ),
    ).toBe(false)
  })

  it('documents token exchange and omits DELETE on projects', () => {
    expect(operation('/api/token', 'post')).toBeTruthy()
    expect(spec.paths['/api/db/projects'].delete).toBeUndefined()
    expect(spec.openapi).toBe('3.1.0')
  })

  it('documents Dataset INSERT but not PATCH or DELETE', () => {
    expect(operation('/api/db/datasets', 'post')['x-sheetbase-scopes']).toEqual(
      ['datasets:write'],
    )
    expect(spec.paths['/api/db/datasets'].patch).toBeUndefined()
    expect(spec.paths['/api/db/datasets'].delete).toBeUndefined()
    expect(operation('/api/db/datasets', 'head')['x-sheetbase-scopes']).toEqual(
      ['datasets:read'],
    )
  })

  it('omits POST and PATCH on folders and record_field_definitions', () => {
    for (const resource of ['folders', 'record_field_definitions']) {
      expect(operation(`/api/db/${resource}`, 'get')).toBeTruthy()
      expect(spec.paths[`/api/db/${resource}`].post).toBeUndefined()
      expect(spec.paths[`/api/db/${resource}`].patch).toBeUndefined()
    }

    expect(spec.info.description).toMatch(/folders.*GET-only/)
  })

  it('splits token and proxy error schemas', () => {
    const tokenError = schemas.TokenError
    const proxyError = schemas.ProxyError

    expect(tokenError.properties?.error.required).toEqual(['code', 'message'])
    expect(tokenError.properties?.error.properties).toHaveProperty('code')
    expect(tokenError.properties?.error.properties).not.toHaveProperty(
      'category',
    )
    expect(proxyError.properties?.error.required).toEqual([
      'category',
      'message',
    ])
    expect(proxyError.properties?.error.properties).toHaveProperty('category')
    expect(proxyError.properties?.error.properties).not.toHaveProperty('code')

    const token400 = operation('/api/token', 'post').responses['400']

    expect(token400.content?.['application/json'].schema.$ref).toBe(
      '#/components/schemas/TokenError',
    )

    const db403 = operation('/api/db/projects', 'get').responses['403']

    expect(db403.content?.['application/json'].schema.$ref).toBe(
      '#/components/schemas/ProxyError',
    )
  })

  it('matches real token and proxy error envelopes', async () => {
    const tokenBody = {
      error: { code: 'invalid_credential', message: 'Invalid credential.' },
    }

    expect(TOKEN_ERROR_CODES).toContain(tokenBody.error.code)
    expect(tokenBody.error).not.toHaveProperty('category')

    const proxyResponse = errorEnvelope({
      category: 'stale_version',
      status: 409,
      message: 'Block version mismatch.',
      requestId: 'req-test',
    })

    const proxyBody = envelopeContract.parse(await proxyResponse.json())

    expect(Object.keys(proxyBody.error).sort()).toEqual([
      'category',
      'message',
      'request_id',
    ])
    expect(proxyBody.error).not.toHaveProperty('code')

    const invalidPath = await handleProxyRequest(
      new Request('http://localhost/api/db/not a path'),
      'not a path',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: async () => '',
        upstreamBaseUrl: 'http://upstream',
      },
    )

    const invalidBody = envelopeContract.parse(await invalidPath.json())

    expect(invalidPath.status).toBe(400)
    expect(invalidBody.error.category).toBe('validation_error')
    expect(invalidBody.error).not.toHaveProperty('code')
    expect(invalidBody.error).toHaveProperty('request_id')
  })

  it('documents concrete RPC arguments for every allowlisted RPC', () => {
    expect(Object.keys(RPC_CONTRACTS).sort()).toEqual(
      Object.keys(EXTERNAL_RPC_SCOPES).sort(),
    )

    for (const name of Object.keys(EXTERNAL_RPC_SCOPES)) {
      const schema = rpcRequestSchema(name)
      const contract = RPC_CONTRACTS[name]
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties).toEqual(contract.properties)
      expect(schema.required ?? []).toEqual(contract.required)
      const propertyNames = Object.keys(schema.properties ?? {})

      // A lookup that takes no arguments (such as the member list) has none.
      if (labParams(name) !== 0) expect(propertyNames.length).toBeGreaterThan(0)
      expect(propertyNames.every((key) => key.startsWith('p_'))).toBe(true)
    }
  })

  it('documents Dataset commit idempotency field and retry result', () => {
    const schema = rpcRequestSchema('commit_dataset_row_batch')
    expect(schema.required).toContain('p_idempotency_key')

    const key = schema.properties?.p_idempotency_key

    expect(key?.minLength).toBe(1)
    expect(key?.maxLength).toBe(128)

    const result = jsonContentSchema(
      operation('/api/db/rpc/commit_dataset_row_batch', 'post').responses,
      '200',
    )

    expect(result.properties?.idempotent.type).toBe('boolean')
    expect(
      operation('/api/db/rpc/commit_dataset_row_batch', 'post').description,
    ).toMatch(/idempotent: true/)
  })

  it('documents table Prefer count and filter operators', () => {
    const getOp = operation('/api/db/records', 'get')
    const refs = getOp.parameters?.map((parameter) => parameter.$ref)
    expect(refs).toContain('#/components/parameters/Prefer')
    expect(refs).toContain('#/components/parameters/ColumnFilter')
    expect(refs).toContain('#/components/parameters/Limit')

    const prefer = descriptionContract.parse(spec.components.parameters.Prefer)

    expect(prefer.description).toMatch(/count=exact/)

    const filter = descriptionContract.parse(
      spec.components.parameters.ColumnFilter,
    )

    for (const operator of ['eq', 'gte', 'in', 'ilike']) {
      expect(filter.description).toContain(operator)
    }

    expect(POSTGREST_FILTER_OPERATORS).toContain('eq')
  })

  it('documents query_dataset_rows filter object and bounds', () => {
    const schema = rpcRequestSchema('query_dataset_rows')

    const query = schema.properties?.p_query

    expect(query?.properties?.filters.maxItems).toBe(8)
    expect(query?.properties?.sort).toBeTruthy()

    const limit = schema.properties?.p_limit

    expect(limit?.minimum).toBe(1)
    expect(limit?.maximum).toBe(1000)
  })

  it('publishes concrete table GET/POST/PATCH schemas', () => {
    for (const resource of Object.keys(EXTERNAL_TABLE_ACCESS)) {
      const getSchema = jsonContentSchema(
        operation(`/api/db/${resource}`, 'get').responses,
        '200',
      )

      expect(getSchema.type).toBe('array')
      expect(getSchema.items).toEqual({
        $ref: `#/components/schemas/${pascalRow(resource)}`,
      })
      assertConcreteSchema(schemas[pascalRow(resource)], `${resource} row`)

      const access = EXTERNAL_TABLE_ACCESS[resource]

      if (!access.write) {
        expect(spec.paths[`/api/db/${resource}`].post).toBeUndefined()
        expect(spec.paths[`/api/db/${resource}`].patch).toBeUndefined()
        continue
      }

      const postSchema = requestContract.parse(
        operation(`/api/db/${resource}`, 'post').requestBody,
      ).content['application/json'].schema

      expect(postSchema.$ref).toMatch(
        new RegExp(`${pascalRow(resource)}Insert$`),
      )
      assertConcreteSchema(
        schemas[`${pascalRow(resource)}Insert`],
        `${resource} insert`,
      )

      const created = jsonContentSchema(
        operation(`/api/db/${resource}`, 'post').responses,
        '201',
      )

      expect(created.oneOf).toBeTruthy()

      if (resource === 'datasets') {
        expect(spec.paths['/api/db/datasets'].patch).toBeUndefined()
        continue
      }

      const patchSchema = requestContract.parse(
        operation(`/api/db/${resource}`, 'patch').requestBody,
      ).content['application/json'].schema

      expect(patchSchema.$ref).toMatch(
        new RegExp(`${pascalRow(resource)}Patch$`),
      )
      assertConcreteSchema(
        schemas[`${pascalRow(resource)}Patch`],
        `${resource} patch`,
      )
    }
  })

  it('publishes concrete RPC request and result schemas', () => {
    for (const name of Object.keys(EXTERNAL_RPC_SCOPES)) {
      const request = rpcRequestSchema(name)

      if (labParams(name) !== 0)
        assertConcreteSchema(request, `${name} request`)

      const result = jsonContentSchema(
        operation(`/api/db/rpc/${name}`, 'post').responses,
        '200',
      )

      expect(result).toEqual(RPC_CONTRACTS[name].result)
      assertConcreteSchema(result, `${name} result`)
    }

    const parameterInputs = rpcRequestSchema(
      'preview_sheet_instance_composition_adoption',
    ).properties?.p_parameter_inputs

    expect(parameterInputs?.type).toBe('array')
    expect(schemaContract.parse(parameterInputs?.items).$ref).toBe(
      '#/components/schemas/SheetParameterInput',
    )

    const changes = rpcRequestSchema('mutate_sheet_instance_calculations')
      .properties?.p_changes

    expect(changes?.type).toBe('array')
    expect(schemaContract.parse(changes?.items).$ref).toBe(
      '#/components/schemas/SheetCalculationChange',
    )
    expect(changes?.minItems).toBe(1)
    expect(changes?.maxItems).toBe(32)

    const sheetDecisions = rpcRequestSchema(
      'apply_sheet_instance_definition_upgrade',
    ).properties?.p_decisions

    expect(sheetDecisions?.type).toBe('array')
    expect(schemaContract.parse(sheetDecisions?.items).$ref).toBe(
      '#/components/schemas/SheetDefinitionUpgradeDecision',
    )

    const notebookDecisions = rpcRequestSchema(
      'apply_notebook_template_upgrade',
    ).properties?.p_decisions

    expect(notebookDecisions?.type).toBe('array')
    expect(schemaContract.parse(notebookDecisions?.items).$ref).toBe(
      '#/components/schemas/NotebookUpgradeDecision',
    )
  })

  it('publishes API-07 credential-attribution columns on strict row schemas', () => {
    const datasets = schemas.DatasetsRow
    const datasetVersions = schemas.DatasetVersionsRow
    const sheetInstances = schemas.SheetInstancesRow
    const records = schemas.RecordsRow

    expect(datasets.additionalProperties).toBe(false)
    expect(datasets.properties).toHaveProperty('created_by_credential_id')
    expect(datasetVersions.properties).toHaveProperty(
      'created_by_credential_id',
    )
    expect(sheetInstances.properties).toHaveProperty('created_by_credential_id')
    expect(sheetInstances.properties).toHaveProperty('updated_by_credential_id')
    expect(records.properties).toHaveProperty('updated_by_credential_id')
  })

  it('uses named JSON unions instead of empty value schemas', () => {
    const parameterInput = schemas.SheetParameterInput

    expect(
      schemaContract.parse(parameterInput.oneOf?.[0]).properties?.value.$ref,
    ).toBe('#/components/schemas/JsonScalar')

    const calculationResult = schemas.SheetCalculationResult

    expect(calculationResult.properties?.calculatedValue.$ref).toBe(
      '#/components/schemas/JsonValue',
    )

    const jsonScalar = schemas.JsonScalar

    expect(
      jsonScalar.oneOf
        ?.map((branch) => schemaContract.parse(branch).type)
        .sort(),
    ).toEqual(['boolean', 'null', 'number', 'string'])
    expect(
      jsonScalar.oneOf?.some(
        (branch) => schemaContract.parse(branch).type === 'integer',
      ),
    ).toBe(false)
  })
})

type Schema = z.infer<typeof schemaContract>

function pascalRow(table: string): string {
  return `${table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Row`
}

function jsonContentSchema(
  source: z.infer<typeof responsesContract>,
  key: string,
) {
  const response = source[key]
  const schema = response.content?.['application/json'].schema
  expect(schema, `${key} JSON schema`).toBeTruthy()

  return schemaContract.parse(schema)
}

const SCHEMA_KEYWORDS = new Set([
  '$ref',
  'type',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'properties',
  'items',
  'prefixItems',
  'additionalProperties',
  'const',
  'enum',
])

function assertConcreteSchema(
  schema: Schema,
  label: string,
  seen = new Set<string>(),
) {
  const walk = (
    node: Schema | boolean | Array<Schema | boolean>,
    path: string,
  ) => {
    if (node === true) return

    if (node === false) {
      throw new Error(`${label}: forbidden schema at ${path}`)
    }

    if (Array.isArray(node)) {
      for (const [index, item] of node.entries())
        walk(item, `${path}[${index}]`)

      return
    }

    const objectNode = schemaContract.parse(node)

    const keywords = Object.keys(objectNode).filter((key) =>
      SCHEMA_KEYWORDS.has(key),
    )

    if (keywords.length === 0) {
      throw new Error(
        `${label}: empty schema at ${path} (need type, $ref, oneOf, properties, items, or additionalProperties)`,
      )
    }

    if (objectNode.$ref !== undefined) {
      const name = objectNode.$ref.replace('#/components/schemas/', '')

      if (seen.has(name)) return
      seen.add(name)
      const target = schemas[name]
      expect(
        target,
        `${label} missing ${objectNode.$ref} at ${path}`,
      ).toBeTruthy()
      walk(schemaContract.parse(target), `${path}->${name}`)

      return
    }

    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      const branches = objectNode[key]

      if (branches) {
        expect(
          branches.length,
          `${label} ${path}.${key} must not be empty`,
        ).toBeGreaterThan(0)
        walk(branches, `${path}.${key}`)
      }
    }

    if (objectNode.not) walk(objectNode.not, `${path}.not`)

    if (
      objectNode.type === 'array' ||
      objectNode.items ||
      objectNode.prefixItems
    ) {
      expect(
        objectNode.items ?? objectNode.prefixItems,
        `${label} ${path} array items`,
      ).toBeTruthy()

      if (objectNode.items) walk(objectNode.items, `${path}.items`)

      if (objectNode.prefixItems)
        walk(objectNode.prefixItems, `${path}.prefixItems`)
    }

    const types = Array.isArray(objectNode.type)
      ? objectNode.type
      : objectNode.type
        ? [objectNode.type]
        : []

    const isObject =
      types.includes('object') ||
      objectNode.properties !== undefined ||
      objectNode.additionalProperties !== undefined

    if (objectNode.properties) {
      // schemaContract validates the property dictionary and each child schema.
      const properties = objectNode.properties
      expect(
        Object.keys(properties).length,
        `${label} ${path} object properties`,
      ).toBeGreaterThan(0)

      for (const [key, child] of Object.entries(properties)) {
        walk(child, `${path}.properties.${key}`)
      }
    }

    if (
      objectNode.additionalProperties &&
      objectNode.additionalProperties !== true
    ) {
      walk(objectNode.additionalProperties, `${path}.additionalProperties`)
    }

    if (
      isObject &&
      !objectNode.properties &&
      objectNode.additionalProperties !== true &&
      !objectNode.additionalProperties
    ) {
      throw new Error(
        `${label}: generic object schema at ${path} (need properties, $ref, oneOf, or additionalProperties)`,
      )
    }
  }

  walk(schema, label)
}
