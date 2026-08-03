import { Client } from 'pg'
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import {
  SHEETBASE_PROFILE_FINGERPRINT,
  sheetbaseRuntimeFingerprint,
} from './hyperformula-profile'
import { buildScientificWorkbook } from './scientific-workbook'
import type { WorkbookCellAddress, WorkbookTable } from './scientific-workbook'
import type { ScientificLogicalType } from './scientific-sheet-data'

const requestInput = z.object({ recordId: z.string().uuid() }).strict()

interface SnapshotFormula {
  id: string
  version: number
  status: 'supported' | 'unsupported'
  address: WorkbookCellAddress
}
export interface CalculationSnapshot {
  recordId: string
  inputRevision: number
  schemaVersions: Record<string, number>
  tables: WorkbookTable[]
  formulas: SnapshotFormula[]
}
export interface CalculationDeps {
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>
  loadSnapshot: (
    actor: string,
    recordId: string,
  ) => Promise<CalculationSnapshot>
  finalize: (
    actor: string,
    snapshot: CalculationSnapshot,
    outcome: 'completed' | 'failed',
    results: CalculationResult[],
    diagnostic?: string,
  ) => Promise<CalculationResponse>
}
export interface CalculationResponse {
  recordId: string
  inputRevision: number
  status: 'completed' | 'failed'
  formulaCount: number
}
type CalculationResult = {
  formulaId: string
  formulaVersion: number
  status: 'completed' | 'unavailable'
  resultKind: 'value' | 'error' | 'none'
  value?: string | number | boolean | null
  errorCode?: string
  diagnostic?: string
}

export async function executeCalculation(
  actor: string,
  recordId: string,
  deps: Pick<CalculationDeps, 'loadSnapshot' | 'finalize'>,
) {
  let snapshot: CalculationSnapshot
  try {
    snapshot = await deps.loadSnapshot(actor, recordId)
  } catch (error) {
    console.error(
      '[calculation] snapshot load failed for record',
      recordId,
      ':',
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
  let workbook: ReturnType<typeof buildScientificWorkbook> | undefined
  let results: CalculationResult[]
  try {
    workbook = buildScientificWorkbook(snapshot.tables)
    results = snapshot.formulas.map<CalculationResult>((formula) => {
      if (formula.status === 'unsupported')
        return {
          formulaId: formula.id,
          formulaVersion: formula.version,
          status: 'unavailable',
          resultKind: 'none',
          errorCode: 'UNSUPPORTED',
        }
      const result = workbook!.get(formula.address)
      if (result.status === 'error')
        return {
          formulaId: formula.id,
          formulaVersion: formula.version,
          status: 'completed',
          resultKind: 'error',
          errorCode: result.error,
          diagnostic: `Formula evaluated to ${result.error}.`,
        }
      if (!result.logical.ok)
        return {
          formulaId: formula.id,
          formulaVersion: formula.version,
          status: 'completed',
          resultKind: 'error',
          errorCode: result.logical.code,
          diagnostic: 'Formula result did not match the target column type.',
        }
      return {
        formulaId: formula.id,
        formulaVersion: formula.version,
        status: 'completed',
        resultKind: 'value',
        value: result.logical.value,
      }
    })
  } catch (error) {
    // A failed worker commits one revision-bound failure state, never a partial
    // result set and never raw data or formula text as a diagnostic.
    console.error(
      '[calculation] workbook build/evaluation failed for record',
      recordId,
      ':',
      error instanceof Error ? error.message : String(error),
    )
    return deps.finalize(
      actor,
      snapshot,
      'failed',
      [],
      'Calculation worker failed.',
    )
  } finally {
    workbook?.destroy()
  }
  // Commit errors (especially revision CAS failures) are not worker failures
  // and must never overwrite a newer revision with a failed state.
  return deps.finalize(actor, snapshot, 'completed', results)
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

export async function handleCalculation(
  request: Request,
  deps: CalculationDeps = defaultDeps,
) {
  const session = await deps.getSession(request.headers)
  if (!session)
    return errorResponse(401, 'unauthenticated', 'Authentication is required.')
  let parsed: ReturnType<typeof requestInput.safeParse>
  try {
    parsed = requestInput.safeParse(await request.json())
  } catch {
    return errorResponse(400, 'invalid_request', 'A JSON body is required.')
  }
  if (!parsed.success)
    return errorResponse(400, 'invalid_request', 'Invalid calculation request.')
  try {
    const result = await executeCalculation(
      session.user.id,
      parsed.data.recordId,
      deps,
    )
    return Response.json(result, {
      status: result.status === 'failed' ? 500 : 200,
    })
  } catch (error) {
    const candidate = error as { code?: string; status?: number }
    if (candidate.code === 'SB001')
      return errorResponse(
        409,
        'stale_revision',
        'Notebook inputs changed during calculation; retry.',
      )
    if (candidate.code === '42501' || candidate.status === 403)
      return errorResponse(403, 'forbidden', 'Notebook is unavailable.')
    console.error(
      '[calculation] trusted finalize failed for record',
      parsed.data.recordId,
      ':',
      error instanceof Error ? error.message : String(error),
    )
    return errorResponse(
      500,
      'calculation_failed',
      'Trusted calculation did not complete.',
    )
  }
}

type RecordRow = QueryResultRow & {
  id: string
  calculation_input_revision: string
}
type TableRow = QueryResultRow & {
  id: string
  name: string
  resource_name: string
  schema_version: number
}
type ColumnRow = QueryResultRow & {
  id: string
  label: string
  field_name: string
  logical_type: ScientificLogicalType
  created_at: string
  option_ids: string[]
}
type FormulaRow = QueryResultRow & {
  id: string
  target_table_id: string
  target_row_id: string
  target_column_id: string
  source_expression: string
  template: unknown
  bindings: unknown
  engine_expression: string
  syntax_profile: string
  function_profile: string
  literal_profile: string
  engine_version: string
  status: 'supported' | 'unsupported'
  version: string
  dependencies: unknown
}

async function loadSnapshot(actor: string, recordId: string) {
  const client = new Client({ connectionString: env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    )
    const record = (
      await client.query<RecordRow>(
        `SELECT r.id,r.calculation_input_revision
           FROM api.records r
           JOIN api.workspaces w ON w.id=r.workspace_id AND w.status='active'
           JOIN api.workspace_memberships m
             ON m.workspace_id=r.workspace_id AND m.user_id=$2
          WHERE r.id=$1 AND r.archived_at IS NULL AND r.deleted_at IS NULL`,
        [recordId, actor],
      )
    ).rows.at(0)
    if (!record)
      throw Object.assign(new Error('Calculation target denied.'), {
        status: 403,
        code: '42501',
      })
    const tables = (
      await client.query<TableRow>(
        `SELECT id,name,resource_name,schema_version FROM api.scientific_tables
          WHERE record_id=$1 AND lifecycle='active' ORDER BY created_at,id`,
        [recordId],
      )
    ).rows
    const formulas = (
      await client.query<FormulaRow>(
        `SELECT f.*,
          coalesce((SELECT jsonb_agg(jsonb_build_object(
            'tableId',d.source_table_id,'rowId',d.source_row_id,
            'columnId',d.source_column_id
          ) ORDER BY d.source_table_id,d.source_row_id,d.source_column_id)
          FROM api.formula_dependencies d WHERE d.formula_id=f.id),'[]'::jsonb) dependencies
          FROM api.formula_definitions f WHERE f.record_id=$1 ORDER BY f.id`,
        [recordId],
      )
    ).rows
    const formulaByCell = new Map(
      formulas.map((formula) => [
        `${formula.target_table_id}/${formula.target_row_id}/${formula.target_column_id}`,
        formula,
      ]),
    )
    const workbookTables: WorkbookTable[] = []
    for (const table of tables) {
      if (!/^sheet_[a-z2-7]{26}$/.test(table.resource_name))
        throw new Error('Invalid generated scientific resource.')
      const columns = (
        await client.query<ColumnRow>(
          `SELECT c.id,c.label,c.field_name,c.logical_type,c.created_at,
            coalesce(array_agg(o.id ORDER BY o.display_order) FILTER (WHERE o.id IS NOT NULL),'{}') option_ids
            FROM api.scientific_columns c
            LEFT JOIN api.scientific_category_options o
              ON o.column_id=c.id AND o.lifecycle='active'
            WHERE c.table_id=$1 AND c.lifecycle='active'
            GROUP BY c.id ORDER BY c.created_at,c.id`,
          [table.id],
        )
      ).rows
      const rows = (
        await client.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(source) row FROM api."${table.resource_name}" source ORDER BY created_at,id LIMIT 10001`,
        )
      ).rows.map((item) => item.row)
      if (rows.length > 10_000 || columns.length > 256)
        throw new Error('Calculation profile dimensions exceeded.')
      workbookTables.push({
        id: table.id,
        name: table.name,
        columns: columns.map((column) => ({
          id: column.id,
          label: column.label,
          createdAt: column.created_at,
          logicalType: column.logical_type,
          categoryOptionIds: column.option_ids,
        })),
        rows: rows.map((row) => ({
          id: String(row.id),
          createdAt: String(row.created_at),
          cells: Object.fromEntries(
            columns.map((column) => {
              const formula = formulaByCell.get(
                `${table.id}/${String(row.id)}/${column.id}`,
              )
              return [
                column.id,
                {
                  literal: row[column.field_name],
                  ...(formula
                    ? {
                        formula: {
                          version: 1,
                          syntaxProfile: formula.syntax_profile,
                          functionProfile: formula.function_profile,
                          literalProfile: formula.literal_profile,
                          engineVersion: formula.engine_version,
                          status: formula.status,
                          source: formula.source_expression,
                          template: formula.template,
                          bindings: formula.bindings,
                          engineExpression: formula.engine_expression,
                          dependencies: formula.dependencies,
                        },
                      }
                    : {}),
                },
              ]
            }),
          ),
        })),
      })
    }
    await client.query('COMMIT')
    return {
      recordId: record.id,
      inputRevision: Number(record.calculation_input_revision),
      schemaVersions: Object.fromEntries(
        tables.map((table) => [table.id, table.schema_version]),
      ),
      tables: workbookTables,
      formulas: formulas.map((formula) => ({
        id: formula.id,
        version: Number(formula.version),
        status: formula.status,
        address: {
          tableId: formula.target_table_id,
          rowId: formula.target_row_id,
          columnId: formula.target_column_id,
        },
      })),
    } satisfies CalculationSnapshot
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

async function finalize(
  actor: string,
  snapshot: CalculationSnapshot,
  outcome: 'completed' | 'failed',
  results: CalculationResult[],
  diagnostic?: string,
) {
  const client = new Client({ connectionString: env.FORMULA_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE formula_writer')
    const response = await client.query<{ result: CalculationResponse }>(
      `SELECT internal.apply_trusted_calculation(
        $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9
      ) result`,
      [
        actor,
        snapshot.recordId,
        snapshot.inputRevision,
        outcome,
        JSON.stringify(results),
        JSON.stringify(snapshot.schemaVersions),
        SHEETBASE_PROFILE_FINGERPRINT,
        sheetbaseRuntimeFingerprint(),
        diagnostic ?? null,
      ],
    )
    await client.query('COMMIT')
    return response.rows[0].result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

const defaultDeps: CalculationDeps = {
  getSession: getAppSession,
  loadSnapshot,
  finalize,
}
