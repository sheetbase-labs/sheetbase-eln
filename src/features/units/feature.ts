/**
 * Units: the built-in lab unit table, values typed in another unit ("2 g" in
 * an mg field) and what was typed, on the API, MCP, the assistant and in
 * pipelines. The conversion happens in the database on every write, so it
 * sends no events of its own: the write it is part of does.
 */
import { UNITS_LAB_TABLES } from './api-tables'
import { UNITS_CONVERT_TOOL, UNITS_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'units',
  operations: UNITS_OPERATIONS,
  labTables: UNITS_LAB_TABLES,
  assistantReadTools: [UNITS_CONVERT_TOOL],
})
