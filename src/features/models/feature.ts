/**
 * Record types from the assistant: registries, request forms, the supplier
 * list and incident logs; fields (add as a draft or switch on in one go,
 * change, say what they measure, change one in use, give a plugin type, make
 * a sheet column a field); and changing what type a record is. The operations
 * are declared with the other schema operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'models',
})
