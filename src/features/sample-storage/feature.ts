/**
 * Samples and storage from the assistant: take part of a sample for an
 * experiment, record a label print, count a freezer (scan, resolve, cancel),
 * send or amend a shipment, block a box position, set a material's hazards,
 * and set up sample workflows and release rules. The operations themselves are
 * declared with the sample operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'sample-storage',
})
