/**
 * A grid of columns and rows written into a notebook as an ad hoc sheet.
 * Seeds describe results as a plain grid; this turns one into the sheet block
 * the notebook shows, through the same database function that carries an old
 * snapshot's table into a new notebook.
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

export const gridPayload = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
})

export type GridPayload = z.infer<typeof gridPayload>

export interface GridSheetBlock {
  id: string
  recordId: string
  order: number
  payload: GridPayload
  createdBy: string | null
}

/** Write the sheet block unless a block with this id is already there. */
export async function insertGridSheetBlock(
  db: Db,
  block: GridSheetBlock,
): Promise<void> {
  const present = await db.execute(
    sql`select 1 from api.blocks where id = ${block.id}`,
  )

  if (present.rows.length) return

  await db.execute(sql`
    insert into api.blocks (id, record_id, type, "order", payload, created_by_user_id)
    values (${block.id}, ${block.recordId}, 'sheet', ${block.order},
            jsonb_build_object('instanceId', internal.grid_to_sheet_instance(
              ${block.recordId}::uuid, ${JSON.stringify(block.payload)}::jsonb,
              ${block.id}, ${block.createdBy})),
            ${block.createdBy})
    on conflict do nothing`)
}
