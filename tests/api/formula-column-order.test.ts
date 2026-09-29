import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  executeFormulaWrite,
  type FormulaWriteDeps,
} from '../../src/lib/formula-write.server'
import { Client } from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: ['.env.local', '.env'] })

const DB_URL = process.env.DATABASE_URL!
const TABLE_ID = '0f17bc31-d99c-48bc-ab11-56152edc0109'
const TARGET_ROW_ID = 'ac0ccc1e-98f8-4335-9840-5d23f28a020b' // A=0, B=2.8, C=2.9, D=null (earliest created_at = row 1 in grid)
const COLUMN_D_ID = '4969c643-902f-4c11-a625-37d197a9f2ea' // Ct Mean (target column, display_order=4)
const COLUMN_B_ID = '9a43e4ac-ae73-4e60-b4f2-f66d7e010ad9' // Batch B Titer (display_order=2 → B)
const COLUMN_C_ID = '6e81b033-e9e6-4ecb-8bce-751b5b5dd19e' // Batch A Titer (display_order=3 → C)
const USER_ID = 'lAFXURMD5iV48M11xjM7iDpNKXiqAxVU'

async function makeDeps(): Promise<FormulaWriteDeps> {
  return {
    getSession: async () => ({ user: { id: USER_ID } }),
    query: async (text, values) => {
      const client = new Client({ connectionString: DB_URL })
      await client.connect()
      try {
        return await client.query(text, values as unknown[])
      } finally {
        await client.end()
      }
    },
    trustedWrite: async (actor, write) => {
      const client = new Client({
        connectionString: process.env.FORMULA_DATABASE_URL || DB_URL,
      })
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
}

async function cleanupFormula() {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    await client.query(
      'DELETE FROM api.formula_definitions WHERE target_table_id = $1',
      [TABLE_ID],
    )
    await client.query(
      `UPDATE api.sheet_ouzhxcsrxfchpedlguoeydxwma SET formula_column_ids = ARRAY[]::uuid[], col_sqw6kmdtrnf6hd5wghasmkewu4 = null WHERE id = $1`,
      [TARGET_ROW_ID],
    )
  } finally {
    await client.end()
  }
}

async function getFormulaBindings() {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const res = await client.query(
      'SELECT * FROM api.formula_definitions WHERE target_table_id = $1',
      [TABLE_ID],
    )
    return res.rows[0] ?? null
  } finally {
    await client.end()
  }
}

describe('formula write E2E: column ordering fix', () => {
  beforeEach(async () => {
    await cleanupFormula()
  })
  afterEach(async () => {
    await cleanupFormula()
  })

  it('persists =B1+C1 with correct column AND row bindings', async () => {
    const deps = await makeDeps()

    // Get current row version
    const client = new Client({ connectionString: DB_URL })
    await client.connect()
    const rowRes = await client.query(
      'SELECT version FROM api.sheet_ouzhxcsrxfchpedlguoeydxwma WHERE id = $1',
      [TARGET_ROW_ID],
    )
    const rowVersion = Number(rowRes.rows[0].version)
    await client.end()

    // =B1+C1 — row 1 is the target row (earliest created_at), B=Batch B Titer, C=Batch A Titer
    const result = await executeFormulaWrite(
      USER_ID,
      {
        operation: 'create',
        target: {
          tableId: TABLE_ID,
          rowId: TARGET_ROW_ID,
          columnId: COLUMN_D_ID,
        },
        expectedSchemaVersion: 1,
        expectedRowVersion: rowVersion,
        source: '=B1+C1',
      },
      deps,
    )

    expect(result).toBeTruthy()
    console.log('Write result:', JSON.stringify(result, null, 2))

    // Verify the formula was persisted with correct bindings
    const formula = await getFormulaBindings()
    expect(formula).toBeTruthy()
    console.log(
      'Persisted formula bindings:',
      JSON.stringify(formula.bindings, null, 2),
    )

    // Check source expression
    expect(formula.source_expression).toBe('=B1+C1')
    expect(formula.engine_expression).toBe('=(B1+C1)')

    // Check bindings
    const bindings = formula.bindings
    expect(bindings).toHaveLength(2)

    // slot 0 = B1 → should be Batch B Titer (9a43e4ac), target row
    expect(bindings[0].cell.columnId).toBe(COLUMN_B_ID)
    expect(bindings[0].cell.rowId).toBe(TARGET_ROW_ID)

    // slot 1 = C1 → should be Batch A Titer (6e81b033), target row
    expect(bindings[1].cell.columnId).toBe(COLUMN_C_ID)
    expect(bindings[1].cell.rowId).toBe(TARGET_ROW_ID)

    console.log('✅ Formula =B1+C1 persisted correctly!')
    console.log(
      '   B1 → column',
      bindings[0].cell.columnId,
      '(Batch B Titer, value 2.8)',
    )
    console.log(
      '   C1 → column',
      bindings[1].cell.columnId,
      '(Batch A Titer, value 2.9)',
    )
    console.log('   Row →', bindings[0].cell.rowId, '(A=0, B=2.8, C=2.9)')
    console.log('   Expected result: 2.8 + 2.9 = 5.7')
  })
})
