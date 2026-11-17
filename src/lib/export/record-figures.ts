/**
 * The figures of a signed record, worked out on the server so the PDF can draw
 * them. A frozen chart carries its series; a frozen analysis is rebuilt from
 * the Dataset Version it pinned, the same way the notebook draws it.
 */
import { z } from 'zod'

import {
  chartSpec,
  frozenAnalysis,
  frozenChart,
} from '#/components/notebook/scientific-payload'
import { analysisBlockParts } from '#/lib/analysis-definition'
import {
  chartUsedFieldIds,
  materialiseFrozenChart,
  materialiseFrozenFacets,
  materialiseLiveChart,
} from '#/lib/chart-data'
import { filterRowsByFlags } from '#/lib/dataset-flags'
import { materialiseFacetedCharts } from '#/lib/chart-spec'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'
import type { DatasetRowInput } from '#/lib/dataset-product'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { figureFromChart } from './chart-figure'
import type { PdfFigure } from './chart-figure'
import { postgrestRpc } from '#/lib/request-auth'

type Payload = Record<string, z.infer<typeof z.json>>

const PAGE = 1000
const ROW_CEILING = 100_000

const block = z.object({
  id: z.string().optional(),
  type: z.string(),
  payload: z.record(z.string(), z.json()).catch({}),
})

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()])

const page = z.object({
  rows: z.array(
    z.object({ rowId: z.string(), values: z.record(z.string(), cell) }),
  ),
  totalCount: z.number(),
})

async function pinnedRows(versionId: string, expected: number, token: string) {
  if (expected > ROW_CEILING) return null
  const rows: DatasetRowInput[] = []

  for (let offset = 0; offset < expected || offset === 0; offset += PAGE) {
    const res = await postgrestRpc(
      'query_dataset_version_rows',
      { p_dataset_version_id: versionId, p_limit: PAGE, p_offset: offset },
      token,
    )

    const parsed = page.safeParse(res.body)

    if (res.status >= 400 || !parsed.success) return null

    for (const row of parsed.data.rows)
      rows.push({ ...row.values, [CHART_ROW_ID_KEY]: row.rowId })

    if (parsed.data.rows.length < PAGE) break
  }

  return rows
}

async function analysisFigure(
  title: string,
  payload: Payload,
  token: string,
): Promise<PdfFigure | null> {
  const frozen = frozenAnalysis.safeParse(payload.frozen)

  if (!frozen.success) return null

  const spec = analysisBlockParts(frozen.data.definition).chart
  const pin = frozen.data.datasetProvenance.at(0)

  if (!spec || !pin) return null

  const rows = await pinnedRows(pin.datasetVersionId, pin.rowCount, token)

  if (!rows) return null

  const flags =
    frozen.data.exclusionPolicy === 'exclude_bound_fields'
      ? await postgrestRpc(
          'analysis_dataset_version_flags',
          { p_dataset_version_id: pin.datasetVersionId },
          token,
        ).then((res) =>
          res.status < 400 && Array.isArray(res.body)
            ? z.array(z.custom<DatasetValueFlag>()).parse(res.body)
            : [],
        )
      : []

  const columns = frozen.data.columns.map((c) => ({
    id: c.fieldId,
    label: c.label,
    logicalType: c.logicalType,
    unit: c.unit,
  }))

  const chart = materialiseLiveChart(spec, {
    source: {
      datasetId: pin.datasetId,
      name: 'Pinned Dataset Version',
      workspaceId: '',
      schemaVersionId: '',
      schemaVersionNumber: pin.schemaVersionNumber,
      revision: pin.sourceDatasetRevision,
      columns,
    },
    rows,
    flags,
    truncated: false,
    totalCount: pin.rowCount,
  })

  const facets = spec.fields.facet
    ? materialiseFacetedCharts(
        spec,
        columns,
        filterRowsByFlags(rows, flags, chartUsedFieldIds(spec)),
      ).panels
    : null

  return figureFromChart(title, spec, chart, facets)
}

function chartBlockFigure(title: string, payload: Payload): PdfFigure | null {
  const spec = chartSpec.safeParse(payload.spec)
  const frozen = frozenChart.safeParse(payload.frozen)

  if (!spec.success || !frozen.success) return null

  return figureFromChart(
    title,
    spec.data,
    materialiseFrozenChart(frozen.data),
    materialiseFrozenFacets(frozen.data)?.panels,
  )
}

/** Every analysis and chart block of a snapshot, keyed by block id. */
export async function buildRecordFigures(
  blockSnapshot: z.infer<typeof z.json>,
  token: string,
): Promise<Map<string, PdfFigure>> {
  const blocks = z.array(block).catch([]).parse(blockSnapshot)

  const found = await Promise.all(
    blocks.map(async (b) => {
      if (!b.id || (b.type !== 'analysis' && b.type !== 'chart')) return null
      const title = z.string().catch('').parse(b.payload.title)

      const figure = await (
        b.type === 'analysis'
          ? analysisFigure(title, b.payload, token)
          : Promise.resolve(chartBlockFigure(title, b.payload))
      ).catch(() => null)

      return figure ? ([b.id, figure] as const) : null
    }),
  )

  return new Map(found.flatMap((entry) => (entry ? [entry] : [])))
}

export type { PdfFigure }
