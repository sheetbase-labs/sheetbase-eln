/**
 * Workspace settings from the assistant: the editing and registration rules,
 * AI settings, ID prefixes, who gets data access, the publishing policy,
 * working hours for the scheduler, which roles reach which settings area,
 * the sign-in group handover, open tables, ontology lookup and plugin
 * runner points. The operations are declared elsewhere; this folder holds
 * the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'workspace-settings',
})
