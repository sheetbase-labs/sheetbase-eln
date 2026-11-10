import { t } from '#/copy'
import type { QcRule } from '#/lib/run-qc'

/** Rules in the order the catalogue lists them, for chips and checkboxes. */
export function ruleLabel(rule: QcRule): string {
  return t(`quality.runQc.rules.${rule}`)
}
