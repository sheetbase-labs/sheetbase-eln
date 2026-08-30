/**
 * SCI-04 freeze evidence is a Dataset Version pin plus ChartSpec.
 * Tests rematerialise with the TypeScript pipeline rather than stored series.
 */
import type { Client } from 'pg'

import {
  materialiseChart,
  materialiseFacetedCharts,
} from '#/lib/chart-spec'
import type {
  ChartColumn,
  ChartSpec,
  FacetedChart,
  FrozenChart,
  MaterialisedChart,
} from '#/lib/chart-spec'

export async function loadPinnedVersionRows(
  client: Client,
  versionId: string,
): Promise<Record<string, unknown>[]> {
  const res = await client.query<{ values: Record<string, unknown> | null }>(
    `SELECT COALESCE(
       jsonb_object_agg(
         vv.field_id::text,
         COALESCE(
           to_jsonb(vv.numeric_value),
           to_jsonb(vv.integer_value),
           to_jsonb(vv.text_value),
           to_jsonb(vv.boolean_value),
           to_jsonb(vv.date_value),
           to_jsonb(vv.timestamp_value)
         )
       ) FILTER (WHERE vv.field_id IS NOT NULL),
       '{}'::jsonb
     ) AS values
     FROM api.dataset_version_rows vr
     LEFT JOIN api.dataset_version_values vv
       ON vv.dataset_version_id = vr.dataset_version_id
      AND vv.row_id = vr.row_id
     WHERE vr.dataset_version_id = $1
     GROUP BY vr.row_id
     ORDER BY vr.row_id`,
    [versionId],
  )
  return res.rows.map((row) => row.values ?? {})
}

export function columnsFromFrozen(frozen: FrozenChart): ChartColumn[] {
  return frozen.data.columns.map((column) => ({
    id: column.fieldId,
    label: column.label,
    logicalType: column.logicalType,
    unit: column.unit,
  }))
}

export function rematerialiseFrozenChart(
  spec: ChartSpec,
  frozen: FrozenChart,
  rows: Record<string, unknown>[],
): MaterialisedChart {
  return materialiseChart(spec, columnsFromFrozen(frozen), rows)
}

export function rematerialiseFrozenFacets(
  spec: ChartSpec,
  frozen: FrozenChart,
  rows: Record<string, unknown>[],
): { panels: FacetedChart[]; total: number } {
  return materialiseFacetedCharts(spec, columnsFromFrozen(frozen), rows)
}
