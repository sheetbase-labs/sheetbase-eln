import type { LabTable } from '#/lib/lab-api-surface'

/** Material stock tables tokens may read (`lab:read`). */
export const REAGENT_LAB_TABLES = {
  reagent_movements: {
    summary:
      'The stock ledger of a material: each receipt, use, quarantine or restore, with the change, the quantity after it and why. Write with `record_reagent_movement`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['reagent_record_id', 'uuid', 1],
      ['operation', 'text', 1],
      ['quantity_delta', 'num', 1],
      ['resulting_quantity', 'num', 1],
      ['unit', 'text', 0],
      ['supplier', 'text', 0],
      ['catalog_no', 'text', 0],
      ['lot', 'text', 0],
      ['expiry', 'date', 0],
      ['reason', 'text', 0],
      ['actor_user_id', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
