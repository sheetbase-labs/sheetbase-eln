/**
 * What publishing a new version of a model would do to its contract: which
 * rules point at a field the new version no longer has, or at a field whose
 * type or unit changed so the rule no longer fits.
 */
import type { ContractRule } from './types'
import { isFieldRule } from './rules'

export interface ContractFieldRef {
  /** The field's key (dataset) or field name (record model). */
  key: string
  logicalType: string
  unit?: string | null
}

export type ContractImpactReason = 'removed' | 'not_number' | 'unit_changed'

export interface ContractImpact {
  rule: ContractRule
  reason: ContractImpactReason
}

const NUMBER_TYPES = new Set(['integer', 'decimal'])

export function contractImpact(
  rules: readonly ContractRule[],
  next: readonly ContractFieldRef[],
): ContractImpact[] {
  const byKey = new Map(next.map((field) => [field.key, field]))
  const out: ContractImpact[] = []

  for (const rule of rules) {
    if (!isFieldRule(rule.kind) || !rule.field) continue
    const field = byKey.get(rule.field)

    if (!field) {
      out.push({ rule, reason: 'removed' })
      continue
    }

    if (rule.kind === 'range' && !NUMBER_TYPES.has(field.logicalType)) {
      out.push({ rule, reason: 'not_number' })
      continue
    }

    if (rule.kind === 'units') {
      const allowed = new Set(rule.units ?? [])

      if (!field.unit || !allowed.has(field.unit)) {
        out.push({ rule, reason: 'unit_changed' })
      }
    }
  }

  return out
}
