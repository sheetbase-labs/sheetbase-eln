/**
 * Material stock: the movement ledger and the attention counts. A movement
 * changes the material record, so it reaches webhooks as `record.updated`.
 */
import { defineFeature } from '../define'
import { REAGENT_LAB_TABLES } from './api-tables'
import { REAGENT_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'reagents',
  operations: REAGENT_OPERATIONS,
  labTables: REAGENT_LAB_TABLES,
})
