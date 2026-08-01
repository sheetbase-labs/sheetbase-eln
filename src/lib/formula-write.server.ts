import { Client } from 'pg'
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { env } from '#/env.server'
import { auth } from '#/lib/auth'
import { createSheetbaseHyperFormula } from './hyperformula-profile'
import {
  buildPersistedFormulaArtifact,
  calculationSheetName,
  FormulaSyntaxError,
  parseFormula,
} from './formula-ir'

const uuid = z.string().uuid()
const target = z.object({ tableId: uuid, rowId: uuid, columnId: uuid }).strict()
const versions = {
  expectedSchemaVersion: z.number().int().positive(),
  expectedRowVersion: z.number().int().positive(),
}
export const formulaWriteInput = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      target,
      ...versions,
      source: z.string().min(1).max(8192),
    })
    .strict(),
  z
    .object({
      operation: z.literal('update'),
      target,
      ...versions,
      expectedFormulaVersion: z.number().int().positive(),
      source: z.string().min(1).max(8192),
    })
    .strict(),
  z
    .object({
      operation: z.literal('remove'),
      target,
      ...versions,
      expectedFormulaVersion: z.number().int().positive(),
      replacement: z.unknown(),
    })
    .strict(),
])
export type FormulaWriteInput = z.infer<typeof formulaWriteInput>

type QueryResult<T extends QueryResultRow> = { rows: T[] }
export interface FormulaWriteDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  query: <T extends QueryResultRow>(
    text: string,
    values: unknown[],
  ) => Promise<QueryResult<T>>
  trustedWrite: (
    actor: string,
    write: Record<string, unknown>,
  ) => Promise<unknown>
}

type TableContext = {
  id: string
  resource_name: string
  schema_version: number
  lifecycle: string
  workspace_status: string
  membership_id: string | null
  record_id: string
}

export async function executeFormulaWrite(
  actor: string,
  input: FormulaWriteInput,
  deps: Pick<FormulaWriteDeps, 'query' | 'trustedWrite'>,
) {
  const context = await deps.query<TableContext>(
    `SELECT t.id,t.resource_name,t.schema_version,t.lifecycle,t.record_id,
            w.status workspace_status,m.id membership_id
       FROM api.scientific_tables t
       JOIN api.workspaces w ON w.id=t.workspace_id
       LEFT JOIN api.workspace_memberships m
         ON m.workspace_id=t.workspace_id AND m.user_id=$2
       JOIN api.records r ON r.id=t.record_id
      WHERE t.id=$1 AND r.archived_at IS NULL AND r.deleted_at IS NULL`,
    [input.target.tableId, actor],
  )
  const table = context.rows.at(0)
  if (
    !table ||
    !table.membership_id ||
    table.lifecycle !== 'active' ||
    table.workspace_status !== 'active'
  )
    throw Object.assign(new Error('Formula target is unavailable.'), {
      status: 403,
      code: 'forbidden',
    })
  if (!/^sheet_[a-z2-7]{26}$/.test(table.resource_name))
    throw new Error('Invalid generated scientific resource.')

  const notebookTables = await deps.query<{
    id: string
    name: string
    resource_name: string
  }>(
    `SELECT id,name,resource_name FROM api.scientific_tables
      WHERE record_id=$1 AND lifecycle='active' ORDER BY created_at,id`,
    [table.record_id],
  )
  const maps = await Promise.all(
    notebookTables.rows.map(async (candidate) => {
      if (!/^sheet_[a-z2-7]{26}$/.test(candidate.resource_name))
        throw new Error('Invalid generated scientific resource.')
      const [columns, rows] = await Promise.all([
        deps.query<{ id: string }>(
          `SELECT id FROM api.scientific_columns
            WHERE table_id=$1 AND lifecycle='active' ORDER BY display_order,id`,
          [candidate.id],
        ),
        // The generated identifier is checked against the closed grammar.
        deps.query<{ id: string }>(
          `SELECT id FROM api."${candidate.resource_name}" ORDER BY created_at,id LIMIT 10001`,
          [],
        ),
      ])
      if (rows.rows.length > 10_000 || columns.rows.length > 256)
        throw Object.assign(new Error('Formula calculation limits exceeded.'), {
          status: 422,
          code: 'limit',
        })
      return {
        tableId: candidate.id,
        name: candidate.name,
        rowIds: rows.rows.map((row) => row.id),
        columnIds: columns.rows.map((column) => column.id),
      }
    }),
  )
  const targetMaps = maps.find((candidate) => candidate.tableId === table.id)
  if (!targetMaps) throw new Error('Formula target map is unavailable.')
  const write: Record<string, unknown> = {
    operation: input.operation,
    target: input.target,
    expectedSchemaVersion: input.expectedSchemaVersion,
    expectedRowVersion: input.expectedRowVersion,
  }
  if (input.operation === 'remove') {
    write.expectedFormulaVersion = input.expectedFormulaVersion
    write.replacement = input.replacement
  } else {
    if (input.operation === 'update')
      write.expectedFormulaVersion = input.expectedFormulaVersion
    const parsed = parseFormula(input.source, {
      ...targetMaps,
      tables: maps,
    })
    if (parsed.status === 'supported') {
      const engine = createSheetbaseHyperFormula()
      try {
        for (const candidate of maps)
          engine.addSheet(calculationSheetName(candidate.tableId))
        const sheet = engine.getSheetId(calculationSheetName(table.id))
        const row = targetMaps.rowIds.indexOf(input.target.rowId)
        const column = targetMaps.columnIds.indexOf(input.target.columnId)
        if (sheet === undefined || row < 0 || column < 0)
          throw Object.assign(new Error('Formula target is unavailable.'), {
            status: 422,
            code: 'invalid_formula',
          })
        engine.setCellContents({ sheet, row, col: column }, [
          [parsed.artifact.engineExpression],
        ])
        if (!engine.getCellFormula({ sheet, row, col: column }))
          throw Object.assign(
            new Error('HyperFormula rejected the normalized formula.'),
            { status: 422, code: 'invalid_formula' },
          )
      } finally {
        engine.destroy()
      }
    }
    write.artifact = buildPersistedFormulaArtifact(parsed, table.id)
  }
  return deps.trustedWrite(actor, write)
}

function responseError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

export async function handleFormulaWrite(
  request: Request,
  deps: FormulaWriteDeps = defaultDeps,
) {
  const session = await deps.getSession(request.headers)
  if (!session)
    return responseError(401, 'unauthenticated', 'Authentication is required.')
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return responseError(
      400,
      'invalid_request',
      'A JSON request body is required.',
    )
  }
  const parsed = formulaWriteInput.safeParse(json)
  if (!parsed.success)
    return responseError(
      400,
      'invalid_request',
      'Invalid formula write request.',
    )
  try {
    const result = await executeFormulaWrite(session.user.id, parsed.data, deps)
    return Response.json(result)
  } catch (error) {
    const candidate = error as { code?: string; status?: number }
    if (error instanceof FormulaSyntaxError)
      return responseError(422, error.code, error.message)
    if (candidate.code === 'SB001')
      return responseError(
        409,
        'stale_version',
        'Formula data changed; reload and retry.',
      )
    if (candidate.code === '42501' || candidate.status === 403)
      return responseError(403, 'forbidden', 'Formula target is unavailable.')
    if (candidate.code === 'P0002')
      return responseError(
        404,
        'not_found',
        'Formula target row was not found.',
      )
    if (candidate.status === 422 || candidate.code === '22023')
      return responseError(
        422,
        candidate.code ?? 'invalid_formula',
        error instanceof Error ? error.message : 'Invalid formula.',
      )
    return responseError(
      500,
      'formula_write_failed',
      'Could not save the formula.',
    )
  }
}

const defaultDeps: FormulaWriteDeps = {
  getSession: (headers) => auth.api.getSession({ headers }),
  async query<T extends QueryResultRow>(text: string, values: unknown[]) {
    const client = new Client({ connectionString: env.DATABASE_URL })
    await client.connect()
    try {
      return await client.query<T>(text, values)
    } finally {
      await client.end()
    }
  },
  async trustedWrite(actor, write) {
    const client = new Client({ connectionString: env.FORMULA_DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE formula_writer')
      const result = await client.query<{ result: unknown }>(
        'SELECT internal.apply_trusted_formula_write($1,$2::jsonb) result',
        [actor, JSON.stringify(write)],
      )
      await client.query('COMMIT')
      return result.rows[0]?.result ?? null
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      await client.end()
    }
  },
}
