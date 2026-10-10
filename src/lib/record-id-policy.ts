/**
 * CORE-04.10 Record-ID policy seam.
 *
 * CORE-04 uses the Model-owned generated identifier assigned by
 * `api.create_model_record`: `{PREFIX}-YYYY-NNNN`. Sheet creation must not
 * invent a second generator or accept user-supplied/override IDs. Future
 * Model-configurable modes can extend `RecordIdPolicy.mode` without changing
 * Sheet identity (UUID remains the relationship key).
 */
import { KIND_PREFIX, identifierPattern } from './scientific-records'
import type { ScientificRecordKind } from './scientific-records'

export const RECORD_ID_POLICY_OWNER = 'api.create_model_record' as const

export type RecordIdPolicyMode = 'generated'

export interface RecordIdPolicy {
  mode: RecordIdPolicyMode
  format: 'PREFIX-YYYY-NNNN'
  uniqueness: 'project'
  owner: typeof RECORD_ID_POLICY_OWNER
}

export const CURRENT_RECORD_ID_POLICY: RecordIdPolicy = {
  mode: 'generated',
  format: 'PREFIX-YYYY-NNNN',
  uniqueness: 'project',
  owner: RECORD_ID_POLICY_OWNER,
}

/** Prefixes assigned by `create_model_record` / `create_record`. */
export const RECORD_KIND_PREFIX: Record<string, string> = {
  experiment: 'EXP',
  protocol_template: 'PRT',
  report: 'RPT',
  sample: KIND_PREFIX.sample,
  material: KIND_PREFIX.material,
  file: 'FILE',
  notebook_template: 'NBK',
}

export function recordIdPattern(kind: string): RegExp | null {
  if (kind in KIND_PREFIX) {
    return identifierPattern(kind as ScientificRecordKind)
  }
  const prefix = RECORD_KIND_PREFIX[kind]
  if (!prefix) return null
  return new RegExp(`^${prefix}-\\d{4}-\\d{4}$`)
}

export function isGeneratedRecordId(kind: string, identifier: string): boolean {
  const pattern = recordIdPattern(kind)
  return pattern ? pattern.test(identifier) : false
}

export function assertSheetUsesModelRecordIds(): RecordIdPolicy {
  return CURRENT_RECORD_ID_POLICY
}
