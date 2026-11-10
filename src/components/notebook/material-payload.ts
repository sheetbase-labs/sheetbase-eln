import { z } from 'zod'
import type { MaterialItem } from '#/lib/protocol-materials'

/** Decode stored material lines for both reading and editing. The save-time
 * block validator still enforces identifiers, positive amounts and timestamps. */
export const materialItems = z
  .array(
    z.looseObject({
      id: z.string(),
      materialRecordId: z.string(),
      kind: z.enum(['sample', 'material']),
      identifier: z.string(),
      title: z.string(),
      quantity: z.number(),
      unit: z.looseObject({
        code: z.string(),
        symbol: z.string(),
        quantityKind: z.string().optional(),
      }),
      note: z.string().optional(),
      observedAt: z.string(),
    }) satisfies z.ZodType<MaterialItem>,
  )
  .default([])
