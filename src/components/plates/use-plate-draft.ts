/**
 * Reading a plate draft: the wells and readings the text and layout say, the
 * control columns applied, and the analysis the saved run would show.
 */
import { useMemo } from 'react'

import { analysePlate, defaultAssayConfig } from '#/lib/plate-assay'
import { FORMAT_DIMENSIONS } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'

import { assignControlColumns, mergePlate } from './merge-plate'

export function usePlateDraft({
  data,
  layout,
  formatChoice,
  negativeColumns,
  positiveColumns,
}: {
  data: string
  layout: string
  formatChoice: 'auto' | PlateFormat
  negativeColumns: string
  positiveColumns: string
}) {
  const merged = useMemo(() => mergePlate(data, layout), [data, layout])

  const format: PlateFormat | null =
    formatChoice === 'auto' ? merged.format : formatChoice

  // A reader's grid has no roles: the control columns the person names give it some.
  const parsed = useMemo(() => {
    const columns = format ? FORMAT_DIMENSIONS[format].cols : 0

    return {
      ...merged,
      wells: layout.trim()
        ? merged.wells
        : assignControlColumns(merged.wells, columns, {
            negative: negativeColumns,
            positive: positiveColumns,
          }),
    }
  }, [merged, layout, format, negativeColumns, positiveColumns])

  const controls = parsed.wells.filter(
    (w) => w.role === 'positive_control' || w.role === 'negative_control',
  ).length

  const samples = parsed.wells.filter((w) => w.role === 'sample').length

  const readCount = Object.values(parsed.readout).filter(
    (v) => v !== null,
  ).length

  // What the plate will say once saved: the same analysis the run page shows.
  const preview = useMemo(() => {
    if (!format || readCount === 0 || controls === 0) return null

    try {
      return analysePlate(parsed.wells, parsed.readout, defaultAssayConfig())
    } catch {
      return null
    }
  }, [format, readCount, controls, parsed.wells, parsed.readout])

  return { parsed, format, readCount, controls, samples, preview }
}
