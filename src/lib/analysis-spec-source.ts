import { z } from 'zod'

import type { AnalysisViewWire } from '#/lib/analysis-studio-data'

/** The part of a stored chart spec the source lookup reads. */
const storedChartSourceSchema = z.object({
  datasets: z
    .array(z.object({ datasetId: z.string().optional() }))
    .optional()
    .nullable(),
})

/**
 * The first source dataset of a saved spec. Stored specs are untyped JSON, so
 * one without a `datasets` array must read as "no source", not crash a list.
 */
export function specSourceDatasetId(
  spec: AnalysisViewWire['charts'][number],
): string | undefined {
  const parsed = storedChartSourceSchema.safeParse(spec)

  return parsed.success ? parsed.data.datasets?.[0]?.datasetId : undefined
}
