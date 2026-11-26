/**
 * Records from the assistant: add a record of any type (a material or reagent,
 * a lab-defined record type), archive or restore one, link two, and register
 * a new lot of a material. The operations themselves are declared with the
 * other record operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'records',
})
