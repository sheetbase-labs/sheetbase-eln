/**
 * Sheets from the assistant: save a sheet's current rows as a dataset, and move
 * a sheet to the newest published version of its layout when nothing needs deciding.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'sheet-composition',
})
