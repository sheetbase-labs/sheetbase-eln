/**
 * Why work is held up: one read the assistant answers "what is stopping
 * EXP-0142 from being submitted", "what is left before I can submit" and "why
 * is DS-0311 flagged" with. It reads what the record pages compute
 * (`experiment_readiness`, `record_gates`, the latest review submission and
 * the dataset flags), so the answer cannot disagree with the page.
 *
 * Reading only: it sends no events. Tokens, MCP and the SDK already read the
 * same facts through those operations and tables, so it adds no API of its own.
 */
import { defineFeature } from '../define'
import { BLOCKERS_READ_TOOL } from './tool'

export const feature = defineFeature({
  name: 'blockers',
  assistantReadTools: [BLOCKERS_READ_TOOL],
})
