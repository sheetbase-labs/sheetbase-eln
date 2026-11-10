import { z } from 'zod'
import {
  AXIS_SCALES,
  CATEGORY_ORDER_MODES,
  CHART_TYPES,
  ERROR_BAR_BASES,
  ERROR_BAR_SOURCES,
  FILTER_OPS,
  HEATMAP_AGGREGATES,
  LEGEND_POSITIONS,
  NUMBER_FORMATS,
  TRANSFORMATION_KINDS,
} from '#/lib/chart-spec'
import type {
  ChartBlockPayload,
  ChartSpec,
  FrozenChart,
} from '#/lib/chart-spec'
import { ASSIGNMENT_ROLES, PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateMapBlockPayload, PlateMapSpec } from '#/lib/plate-map'
import {
  ANALYSIS_DEFINITION_VERSION,
  COLUMN_TRANSFORMS,
  COMPARISON_POST_HOCS,
  COMPARISON_TESTS,
} from '#/lib/analysis-definition'
import type { AnalysisBlockDefinition } from '#/lib/analysis-definition'
import type { AnalysisBlockPayload, FrozenAnalysis } from '#/lib/analysis-block'

// Structural decoding shared by the reader and editor. Cross-field scientific
// validation remains in the canonical block validators. Preserve extension
// fields at every object level, especially immutable frozen evidence.
const binding = z.looseObject({ fieldId: z.string() })

const dataset = z.looseObject({
  datasetId: z.string(),
  datasetVersionId: z.string().optional(),
})

const axis = z.looseObject({
  scale: z.enum(AXIS_SCALES),
  label: z.string().optional(),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  reverse: z.boolean().optional(),
  tickFormat: z.enum(NUMBER_FORMATS).optional(),
})

const reference = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('hline'),
    value: z.number(),
    label: z.string(),
  }),
  z.looseObject({
    kind: z.literal('vline'),
    value: z.number(),
    label: z.string(),
  }),
  z.looseObject({
    kind: z.literal('band'),
    axis: z.enum(['x', 'y']),
    lo: z.number(),
    hi: z.number(),
    label: z.string(),
  }),
  z.looseObject({ kind: z.literal('identity'), label: z.string().optional() }),
])

export const chartSpec: z.ZodType<ChartSpec> = z.looseObject({
  specVersion: z.number(),
  type: z.enum(CHART_TYPES),
  datasets: z.array(dataset),
  fields: z.looseObject({
    x: binding.nullable(),
    y: binding,
    series: binding.nullable(),
    color: binding.nullable(),
    size: binding.nullable(),
    facet: binding.nullable(),
    facetRow: binding.nullish(),
    facetCol: binding.nullish(),
    // Point-marker shape is a canonical ChartSpec wire key, retained for stored-payload compatibility.
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names
    shape: binding.nullish(),
    group: binding.nullish(),
    label: binding.nullish(),
  }),
  filters: z.array(
    z.looseObject({
      fieldId: z.string(),
      op: z.enum(FILTER_OPS),
      value: z.json(),
    }),
  ),
  transformations: z.array(
    z.looseObject({
      kind: z.enum(TRANSFORMATION_KINDS),
      params: z.record(z.string(), z.json()),
    }),
  ),
  typeParams: z.looseObject({
    histogram: z
      .looseObject({
        bins: z.number().optional(),
        binWidth: z.number().optional(),
      })
      .optional(),
    box: z.looseObject({ showOutliers: z.boolean().optional() }).optional(),
    heatmap: z
      .looseObject({
        xBins: z.number().optional(),
        yBins: z.number().optional(),
        aggregate: z.enum(HEATMAP_AGGREGATES).optional(),
        valueField: binding.nullable(),
      })
      .optional(),
    bar: z
      .looseObject({ stacking: z.enum(['grouped', 'stacked']).optional() })
      .optional(),
    strip: z.looseObject({ jitter: z.number().optional() }).optional(),
    summary: z
      .looseObject({ statistic: z.enum(['mean', 'median']).optional() })
      .optional(),
  }),
  display: z.looseObject({
    axes: z.looseObject({ x: axis, y: axis }),
    series: z.array(
      z.looseObject({
        identifier: z.string(),
        label: z.string(),
        color: z.string(),
        visible: z.boolean().optional(),
        lineWidth: z.number().optional(),
        pointSize: z.number().optional(),
        // Point-marker shape is a canonical ChartSpec wire key, retained for stored-payload compatibility.
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names
        shape: z.string().optional(),
      }),
    ),
    legend: z
      .looseObject({
        visible: z.boolean(),
        position: z.enum(LEGEND_POSITIONS).optional(),
      })
      .optional(),
    annotations: z
      .array(z.looseObject({ x: z.number(), y: z.number(), label: z.string() }))
      .optional(),
    caption: z.string().optional(),
    numberFormat: z
      .looseObject({
        kind: z.enum(NUMBER_FORMATS),
        digits: z.number().optional(),
      })
      .optional(),
    categoryOrder: z
      .looseObject({
        mode: z.enum(CATEGORY_ORDER_MODES),
        values: z.array(z.string()).optional(),
      })
      .optional(),
    palette: z.enum(['categorical', 'continuous', 'monochrome']).optional(),
    gridlines: z.boolean().optional(),
    pointOpacity: z.number().optional(),
  }),
  overlays: z.looseObject({
    errorBars: z
      .looseObject({
        source: z.enum(ERROR_BAR_SOURCES).optional(),
        fieldId: z.string().optional(),
        lowerFieldId: z.string().optional(),
        upperFieldId: z.string().optional(),
        basis: z.enum(ERROR_BAR_BASES),
        multiplier: z.number().optional(),
        statistic: z.enum(['mean', 'median']).optional(),
      })
      .nullable(),
    fit: z
      .looseObject({
        method: z.literal('ols'),
        degree: z.number().optional(),
        showBand: z.boolean().optional(),
        showEquation: z.boolean().optional(),
      })
      .nullish(),
    references: z.array(reference).optional(),
  }),
})

const column = z.looseObject({
  fieldId: z.string(),
  label: z.string(),
  logicalType: z.string(),
  unit: z.json().optional(),
})

const provenance = z.looseObject({
  datasetId: z.string(),
  datasetVersionId: z.string().optional(),
  schemaVersionNumber: z.number(),
  rowCount: z.number(),
  checksum: z.string(),
})

const frozenSeries = z.looseObject({
  identifier: z.string(),
  label: z.string(),
  color: z.string(),
  points: z.array(
    z.looseObject({
      x: z.number().nullable(),
      y: z.number().nullable(),
      yError: z.number().nullish(),
      yErrorLo: z.number().nullish(),
      yErrorHi: z.number().nullish(),
      label: z.string().optional(),
      rowId: z.string().optional(),
      recordId: z.string().optional(),
      size: z.number().optional(),
      box: z
        .looseObject({
          lo: z.number(),
          q1: z.number(),
          median: z.number(),
          q3: z.number(),
          hi: z.number(),
          outliers: z.array(z.number()),
          n: z.number(),
        })
        .optional(),
    }),
  ),
})

const frozenIdentity = {
  revisionId: z.string().nullable(),
  frozenAt: z.string(),
  frozenByUserId: z.string(),
  exclusionPolicy: z
    .enum(['include_flagged', 'exclude_bound_fields'])
    .optional(),
}

export const frozenChart: z.ZodType<FrozenChart> = z.looseObject({
  ...frozenIdentity,
  datasetProvenance: z.array(provenance),
  data: z.looseObject({
    columns: z.array(column),
    rows: z.array(z.record(z.string(), z.json())),
    series: z.array(frozenSeries),
    heatmap: z
      .looseObject({
        xLabels: z.array(z.string()),
        yLabels: z.array(z.string()).nullable(),
        cells: z.array(
          z.looseObject({
            x: z.number(),
            y: z.number(),
            value: z.number().nullable(),
            count: z.number(),
          }),
        ),
        min: z.number().nullable(),
        max: z.number().nullable(),
        aggregate: z.enum(HEATMAP_AGGREGATES),
      })
      .nullish(),
    facets: z
      .array(
        z.looseObject({ value: z.string(), series: z.array(frozenSeries) }),
      )
      .nullish(),
    facetsTotal: z.number().optional(),
  }),
})

export const chartPayload: z.ZodType<ChartBlockPayload> = z.looseObject({
  title: z.string().optional(),
  spec: chartSpec.optional(),
  provenance: z.string().optional(),
  frozen: frozenChart.nullish(),
})

export const plateSpec: z.ZodType<PlateMapSpec> = z.looseObject({
  specVersion: z.number(),
  format: z.enum(PLATE_FORMATS),
  rows: z.number(),
  cols: z.number(),
  wells: z.array(
    z.looseObject({
      wellCode: z.string(),
      row: z.number(),
      col: z.number(),
      role: z.enum(ASSIGNMENT_ROLES),
      sampleRef: z
        .looseObject({
          recordId: z.string(),
          identifier: z.string(),
          title: z.string(),
          archived: z.boolean().optional(),
        })
        .optional(),
      replicate: z.number().optional(),
      volume: z.looseObject({ value: z.number(), unit: z.string() }).optional(),
      notes: z.string().optional(),
    }),
  ),
  validation: z.looseObject({
    requiredRoles: z.array(z.enum(ASSIGNMENT_ROLES)).optional(),
    volumeMin: z.number().optional(),
    volumeMax: z.number().optional(),
    volumeUnit: z.string().optional(),
  }),
})

export const platePayload: z.ZodType<PlateMapBlockPayload> = z.looseObject({
  title: z.string().optional(),
  spec: plateSpec.optional(),
  provenance: z.string().optional(),
})

const definitionBase = {
  definitionVersion: z.literal(ANALYSIS_DEFINITION_VERSION),
  datasets: z.array(dataset),
  chart: chartSpec.nullish(),
}

export const analysisDefinition: z.ZodType<AnalysisBlockDefinition> =
  z.discriminatedUnion('kind', [
    z.looseObject({
      ...definitionBase,
      kind: z.literal('descriptive'),
      value: binding,
      group: binding.nullish(),
    }),
    z.looseObject({
      ...definitionBase,
      kind: z.literal('regression'),
      outcome: binding,
      predictor: binding,
      degree: z.number().optional(),
      outcomeTransform: z.enum(COLUMN_TRANSFORMS).optional(),
      predictorTransform: z.enum(COLUMN_TRANSFORMS).optional(),
      group: binding.nullish(),
    }),
    z.looseObject({
      ...definitionBase,
      kind: z.literal('curve'),
      dose: binding,
      response: binding,
      model: z.enum(['4pl', '5pl']).optional(),
      label: binding.nullish(),
      group: binding.nullish(),
    }),
    z.looseObject({
      ...definitionBase,
      kind: z.literal('comparison'),
      value: binding,
      group: binding,
      test: z.enum(COMPARISON_TESTS).optional(),
      postHoc: z.enum(COMPARISON_POST_HOCS).optional(),
      control: z.string().nullish(),
      pair: binding.nullish(),
      alpha: z.number().optional(),
    }),
    z.looseObject({
      ...definitionBase,
      kind: z.literal('survival'),
      time: binding,
      event: binding,
      group: binding.nullish(),
    }),
    z.looseObject({
      ...definitionBase,
      kind: z.literal('chart'),
      chart: chartSpec,
    }),
  ])

export const frozenAnalysis: z.ZodType<FrozenAnalysis> = z.looseObject({
  ...frozenIdentity,
  definition: analysisDefinition,
  definitionName: z.string().nullable(),
  definitionVersion: z.number(),
  methodVersion: z.number().optional(),
  columns: z.array(column),
  datasetProvenance: z.array(
    provenance.extend({
      datasetVersionId: z.string(),
      sourceDatasetRevision: z.number(),
    }),
  ),
})

export const analysisPayload: z.ZodType<AnalysisBlockPayload> = z.looseObject({
  title: z.string().optional(),
  definitionId: z.string().optional(),
  provenance: z.string().optional(),
  frozen: frozenAnalysis.nullish(),
})
