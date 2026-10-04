import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  executeFormulaWrite,
  type FormulaWriteDeps,
} from '#/lib/formula-write.server'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { openMigratorWriter } from '../db/helpers'
import type { createScientificTableAsMigrator } from '../db/helpers'

describe('formula write E2E: column ordering fix', () => {
  it('persists =B1+C1 with correct column AND row bindings', async () => {
    const databaseUrl = process.env.DATABASE_URL
    const secret = process.env.PGRST_JWT_SECRET
    if (!databaseUrl || !secret)
      throw new Error('DATABASE_URL and PGRST_JWT_SECRET are required.')

    const workspaceId = randomUUID()
    const userId = `formula-order-${workspaceId}`
    const projectId = randomUUID()
    const recordId = randomUUID()
    const blockId = randomUUID()
    const sessionId = randomUUID()
    const admin = await openMigratorWriter(databaseUrl, userId, workspaceId)
    const writer = new Client({
      connectionString: process.env.FORMULA_DATABASE_URL ?? databaseUrl,
    })
    let resource: string | undefined
    try {
      await writer.connect()
      await admin.query(
        `INSERT INTO internal."user"(id,name,email,"emailVerified")
         VALUES ($1,'Formula order owner',$2,true)`,
        [userId, `${userId}@test.invalid`],
      )
      await admin.query(
        `INSERT INTO internal.session(id,token,"userId","expiresAt")
         VALUES ($1,$2,$3,now()+interval '1 hour')`,
        [sessionId, `${userId}-session`, userId],
      )
      await admin.query(
        `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,$2,'Formula order')`,
        [workspaceId, userId],
      )
      await admin.query(
        `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
         VALUES ($1,$2,'owner')`,
        [workspaceId, userId],
      )
      await admin.query(
        `INSERT INTO api.projects(id,workspace_id,key,title)
         VALUES ($1,$2,'FORMULA','Formula order')`,
        [projectId, workspaceId],
      )
      await admin.query(
        `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
         VALUES ($1,$2,$3,'experiment','FORMULA-001','Formula order notebook',$4)`,
        [recordId, workspaceId, projectId, userId],
      )
      await admin.query(
        `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id)
         VALUES ($1,$2,'sheet','{}',1,$3)`,
        [blockId, recordId, userId],
      )
      // The legacy public creation RPC is deliberately closed. Bootstrap
      // this persistence fixture as its migration owner without reopening it.
      const sheet = (
        await admin.query<{
          result: Awaited<ReturnType<typeof createScientificTableAsMigrator>>
        }>(
          `SELECT internal.create_scientific_table_impl($1,$2,$3::jsonb) result`,
          [
            blockId,
            'Formula order sheet',
            JSON.stringify(
              ['Input A', 'Input B', 'Input C', 'Output'].map((label) => ({
                label,
                logical_type: 'decimal',
                nullable: true,
              })),
            ),
          ],
        )
      ).rows[0].result
      resource = sheet.table.resource_name
      expect(resource).toMatch(/^sheet_[a-z2-7]{26}$/)
      // Reverse UUID order so an accidental ORDER BY id cannot pass.
      const columns = [...sheet.columns].sort((a, b) =>
        b.id.localeCompare(a.id),
      )
      const [columnA, columnB, columnC, columnD] = columns
      for (const column of columns)
        expect(column.field_name).toMatch(/^col_[a-z2-7]{26}$/)
      await admin.query(
        `UPDATE api.scientific_columns SET display_order=display_order+100
         WHERE table_id=$1`,
        [sheet.table.id],
      )
      for (const [index, column] of columns.entries())
        await admin.query(
          `UPDATE api.scientific_columns SET display_order=$2 WHERE id=$1`,
          [column.id, index + 1],
        )
      const [firstId, secondId] = [randomUUID(), randomUUID()].sort((a, b) =>
        b.localeCompare(a),
      )
      // Row 1 is the earliest timestamp, not the smallest UUID or the first
      // inserted row. Row 2's values expose a reference to the target row.
      const secondRow = (
        await admin.query<{ id: string; version: number }>(
          `INSERT INTO api.${resource}
           (id,created_at,${columnA.field_name},${columnB.field_name},${columnC.field_name})
           VALUES ($1,$2,$3,$4,$5) RETURNING id,version`,
          [secondId, '2026-01-02T00:00:00Z', 103, 31, 47],
        )
      ).rows[0]
      const firstRow = (
        await admin.query<{ id: string; version: number }>(
          `INSERT INTO api.${resource}
           (id,created_at,${columnA.field_name},${columnB.field_name},${columnC.field_name})
           VALUES ($1,$2,$3,$4,$5) RETURNING id,version`,
          [firstId, '2026-01-01T00:00:00Z', 101, 7, 19],
        )
      ).rows[0]
      const deps: Pick<FormulaWriteDeps, 'query' | 'trustedWrite'> = {
        query: (text, values) => admin.query(text, values),
        trustedWrite: async (actor, write) => {
          await writer.query('BEGIN')
          try {
            await writer.query('SET LOCAL ROLE formula_writer')
            const result = await writer.query<{ result: unknown }>(
              'SELECT internal.apply_trusted_formula_write($1,$2::jsonb) result',
              [actor, JSON.stringify(write)],
            )
            await writer.query('COMMIT')
            return result.rows[0].result
          } catch (error) {
            await writer.query('ROLLBACK')
            throw error
          }
        },
      }
      const result = await executeFormulaWrite(
        userId,
        {
          operation: 'create',
          target: {
            tableId: sheet.table.id,
            rowId: secondRow.id,
            columnId: columnD.id,
          },
          expectedSchemaVersion: sheet.table.schema_version,
          expectedRowVersion: Number(secondRow.version),
          source: '=B1+C1',
        },
        deps,
      )
      expect(result).toMatchObject({ status: 'supported', version: 1 })

      // Read the durable artifact through authenticated PostgREST, not a
      // captured write argument. Both references must bind to row 1 even
      // though the formula itself belongs to row 2.
      const token = await mintPostgrestToken(secret, {
        userId,
        workspaceId,
        sessionId,
      })
      const response = await fetch(
        `${process.env.POSTGREST_URL ?? 'http://localhost:3001'}/formula_definitions?target_table_id=eq.${sheet.table.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject([
        {
          target_table_id: sheet.table.id,
          target_row_id: secondRow.id,
          target_column_id: columnD.id,
          source_expression: '=B1+C1',
          engine_expression: '=(B1+C1)',
          bindings: [
            {
              kind: 'cell',
              slot: 0,
              cell: { columnId: columnB.id, rowId: firstRow.id },
            },
            {
              kind: 'cell',
              slot: 1,
              cell: { columnId: columnC.id, rowId: firstRow.id },
            },
          ],
        },
      ])
    } finally {
      try {
        if (resource && /^sheet_[a-z2-7]{26}$/.test(resource))
          await admin.query(`DROP TABLE IF EXISTS api.${resource}`)
        await admin.query(
          'DELETE FROM api.formula_definitions WHERE workspace_id=$1',
          [workspaceId],
        )
        await admin.query(
          'DELETE FROM api.scientific_tables WHERE workspace_id=$1',
          [workspaceId],
        )
        await admin.query('DELETE FROM api.records WHERE workspace_id=$1', [
          workspaceId,
        ])
        await admin.query('DELETE FROM api.projects WHERE workspace_id=$1', [
          workspaceId,
        ])
        await admin.query('DELETE FROM api.workspaces WHERE id=$1', [
          workspaceId,
        ])
        await admin.query('DELETE FROM internal."user" WHERE id=$1', [userId])
        await admin.query("SELECT pg_notify('pgrst','reload schema')")
      } finally {
        await writer.end()
        await admin.end()
      }
    }
  })
})
