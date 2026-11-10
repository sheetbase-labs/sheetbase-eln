import { t } from '#/copy'
import type { AnalysisError } from '#/lib/analysis-definition'

export function describeExecutionError(error: AnalysisError): string {
  switch (error.code) {
    case 'missing_field':
      return t('data.analysisPanel.definitionMissingInputColumn', {
        count: error.fields.length,
        fields: error.fields.join(', '),
      })
    case 'empty_dataset':
      return t('data.analysisPanel.datasetHasRowsAnalyse')
    case 'no_statistic':
      return t('data.analysisPanel.analysisChartOnlySo')
    case 'insufficient_data':
      return t('data.analysisPanel.groupHasTooFew', {
        group: error.group,
        needed: error.needed,
      })
    case 'singular_fit':
      return t('data.analysisPanel.groupHasConstantPredictor', {
        group: error.group,
      })
    case 'curve_not_fitted':
      return t('data.analysisPanel.curveNotFitted', {
        group: error.group,
      })
    case 'needs_groups':
      return t('data.analysisPanel.needsGroups', {
        needed: error.needed,
        found: error.found,
      })
    case 'unknown_control':
      return t('data.analysisPanel.unknownControl', { control: error.control })
    case 'no_pairs':
      return t('data.analysisPanel.noPairs')
    case 'nonpositive_transform':
      return t('data.analysisPanel.nonpositiveTransform', {
        count: error.count,
        field: error.field,
      })
    case 'no_numeric_values':
      return t('data.analysisPanel.columnHasNumericValues', {
        field: error.field,
      })
    case 'method_mismatch':
      return t('data.analysisPanel.methodMismatchEvidenceRecords', {
        recorded: error.recorded,
        current: error.current,
      })
  }
}
