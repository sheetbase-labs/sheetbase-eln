import type { AnalysisViewWire } from '#/lib/analysis-studio-data'

/**
 * The first source dataset of a saved spec. Stored specs are untyped JSON, so
 * one without a `datasets` array must read as "no source", not crash a list.
 */
export function specSourceDatasetId(
  spec: AnalysisViewWire['spec'],
): string | undefined {
  const datasets = (spec as { datasets?: { datasetId?: string }[] }).datasets
  return datasets?.[0]?.datasetId
}
