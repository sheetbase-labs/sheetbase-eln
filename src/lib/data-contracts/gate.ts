/**
 * What the check before an import or pipeline commit says, in words.
 */
import { t } from '#/copy'
import { kindLabel } from './rules'
import type { ContractGateReport, ContractRuleResult } from './types'

/** The block-mode rules that found a problem. */
export function blockingResults(
  report: ContractGateReport,
): ContractRuleResult[] {
  return (report.results ?? []).filter(
    (result) => result.status === 'fail' && result.mode === 'block',
  )
}

/** One line for a run log or an error: which rules broke. */
export function describeGateBlock(report: ContractGateReport): string {
  const problems = blockingResults(report).map((result) =>
    result.field
      ? t('contracts.pipeline.problem', {
          rule: kindLabel(result.kind),
          field: result.field,
        })
      : t('contracts.pipeline.problemNoField', {
          rule: kindLabel(result.kind),
        }),
  )
  return t('contracts.pipeline.blocked', {
    contract: report.contractName ?? '',
    problems: problems.join(', '),
  })
}
