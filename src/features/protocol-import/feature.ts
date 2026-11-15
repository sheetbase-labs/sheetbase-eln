/**
 * Import a protocol from another source (protocols.io and others) as a draft
 * protocol. The sources themselves are plugins; this is the one lab action they
 * all end in.
 */
import { defineFeature } from '../define'
import { PROTOCOL_IMPORT_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'protocol-import',
  operations: PROTOCOL_IMPORT_OPERATIONS,
  eventLabels: { 'protocol.imported': 'A protocol is imported' },
})
