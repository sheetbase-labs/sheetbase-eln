/**
 * OpenAPI and MCP schemas generated from the lab surface list, so a table or
 * RPC added there is documented the same way as the hand-written ones.
 */
import type { Scope } from '#/lib/api-credential-scopes'
import { LAB_PARAM_NOTES, LAB_RPCS, LAB_TABLES } from '#/lib/lab-api-surface'
import type { LabType } from '#/lib/lab-api-surface'

/** A value a JSON Schema document can carry. */
type JsonSchemaValue =
  string | number | boolean | null | JsonSchemaValue[] | JsonSchema

/** One JSON Schema object: its keywords and their JSON values. */
interface JsonSchema {
  [keyword: string]: JsonSchemaValue
}

const SCALARS: Record<LabType, JsonSchema> = {
  uuid: { type: 'string', format: 'uuid' },
  text: { type: 'string' },
  int: { type: 'integer' },
  bigint: { type: 'integer', format: 'int64' },
  num: { type: 'number' },
  bool: { type: 'boolean' },
  ts: { type: 'string', format: 'date-time' },
  date: { type: 'string', format: 'date' },
  time: { type: 'string', format: 'time' },
  json: {
    description: 'JSON value.',
    $ref: '#/components/schemas/JsonValue',
  },
  'text[]': { type: 'array', items: { type: 'string' } },
  'int[]': { type: 'array', items: { type: 'integer' } },
  'uuid[]': { type: 'array', items: { type: 'string', format: 'uuid' } },
}

/** True for the scalar column types `SCALARS` documents, and nothing else. */
function isScalarType(value: string | undefined): value is LabType {
  return value !== undefined && Object.hasOwn(SCALARS, value)
}

function schemaFor(type: LabType): JsonSchema {
  return type === 'json'
    ? {
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/JsonValue' },
      }
    : { ...SCALARS[type] }
}

/** Row schemas keyed by the lab table they document. */
interface LabRowSchemas {
  [table: string]: JsonSchema
}

/** Row schemas for the lab tables, keyed like TABLE_ROW_SCHEMAS. */
export function labTableRowSchemas(): LabRowSchemas {
  const out: LabRowSchemas = {}

  for (const [table, def] of Object.entries(LAB_TABLES)) {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const [name, type, req] of def.columns) {
      properties[name] = req
        ? schemaFor(type)
        : { ...schemaFor(type), nullable: true }

      if (req) required.push(name)
    }

    out[table] = {
      type: 'object',
      additionalProperties: false,
      description: `\`api.${table}\` row (snake_case). ${def.summary}`,
      required,
      properties,
    }
  }

  return out
}

/** Pascal-case row schema name, as `tableSchemaName` builds it. */
function rowName(table: string): string {
  return `${table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Row`
}

/** Tables whose row schema exists outside the lab list. */
const OTHER_ROW_TABLES = new Set([
  'records',
  'record_models',
  'record_links',
  'saved_searches',
  'webhook_subscriptions',
  'pipeline_runs',
])

function pgrstRow(row: JsonSchema, description: string): JsonSchema {
  return {
    description: `${description} PostgREST returns a JSON array of composite rows by default.`,
    oneOf: [row, { type: 'array', items: row }],
  }
}

function resultSchema(result: string, summary: string): JsonSchema {
  if (result === 'void') {
    return { type: 'null', nullable: true, description: 'No content.' }
  }

  if (result === 'json') {
    return {
      type: 'object',
      additionalProperties: { $ref: '#/components/schemas/JsonValue' },
      description: `${summary} A JSON object.`,
    }
  }

  if (result === 'list:text') {
    return { type: 'array', items: { type: 'string' } }
  }

  if (result.startsWith('row:')) {
    const table = result.slice(4)
    const known = table in LAB_TABLES || OTHER_ROW_TABLES.has(table)

    const row: JsonSchema = known
      ? { $ref: `#/components/schemas/${rowName(table)}` }
      : {
          type: 'object',
          additionalProperties: { $ref: '#/components/schemas/JsonValue' },
        }

    return pgrstRow(row, summary)
  }

  if (result.startsWith('rows:')) {
    const properties: Record<string, JsonSchema> = {}

    for (const part of result.slice(5).split(',')) {
      const [name, type] = part.split('=')
      properties[name] = isScalarType(type) ? schemaFor(type) : {}
    }

    return {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties,
      },
    }
  }

  return isScalarType(result) ? schemaFor(result) : {}
}

function describeParam(name: string): string | undefined {
  return LAB_PARAM_NOTES[name]
}

export interface LabRpcContract {
  summary: string
  description: string
  required: string[]
  properties: Record<string, JsonSchema>
  result: JsonSchema
}

/** Request/result contracts keyed by the lab RPC they document. */
interface LabRpcContractMap {
  [rpc: string]: LabRpcContract
}

/** Request/result contracts for the lab RPCs, keyed like RPC_CONTRACTS. */
export function labRpcContracts(): LabRpcContractMap {
  const out: LabRpcContractMap = {}

  for (const [name, def] of Object.entries(LAB_RPCS)) {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const [pname, type, req] of def.params) {
      const note = describeParam(pname)
      const schema: JsonSchema = { ...schemaFor(type) }

      if (note) schema.description = note

      properties[pname] = schema

      if (req) required.push(pname)
    }

    out[name] = {
      summary: def.summary,
      description: def.description,
      required,
      properties,
      result: resultSchema(def.result, def.summary),
    }
  }

  return out
}

/** Table access (scope) for the lab tables, for EXTERNAL_TABLE_ACCESS. */
export const LAB_TABLE_ACCESS: Record<string, { read: Scope }> =
  Object.fromEntries(
    Object.entries(LAB_TABLES).map(([t, def]) => [
      t,
      { read: def.scope ?? 'lab:read' },
    ]),
  )

/** RPC scopes for the lab RPCs, for EXTERNAL_RPC_SCOPES. */
export const LAB_RPC_SCOPES: Record<string, Scope[]> = Object.fromEntries(
  Object.entries(LAB_RPCS).map(([n, d]) => [n, [d.scope]]),
)
