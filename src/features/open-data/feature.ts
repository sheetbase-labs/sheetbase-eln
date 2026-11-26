/**
 * Ontology terms and publishing from the assistant: link a model field to an
 * ontology term or unlink it, add, change or remove a publishing repository,
 * and discard or retry a publication. The operations are declared elsewhere;
 * this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'open-data',
})
