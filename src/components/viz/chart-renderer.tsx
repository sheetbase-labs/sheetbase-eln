import * as React from 'react'

import { Skeleton } from '#/components/ui/skeleton'
import type { ChartRendererProps } from './chart-renderer-impl'

export type {
  ChartRendererProps,
  ChartSelection,
  PlotSelectionProps,
} from './chart-renderer-impl'

export { CHART_PALETTE } from '#/lib/chart-spec'

/**
 * The renderer draws with the charts package (about 600 KB), which only
 * screens with a chart need. It loads on first use, so every other page no
 * longer downloads it. Until it arrives, a placeholder the size of the plot
 * holds the space, so the layout does not jump.
 */
const LazyChartRenderer = React.lazy(() =>
  import('./chart-renderer-impl').then((module) => ({
    default: module.ChartRenderer,
  })),
)

export function ChartRenderer(props: ChartRendererProps) {
  return (
    <React.Suspense
      fallback={
        <Skeleton
          className={props.fillPlot ? 'h-full w-full' : 'w-full'}
          style={
            props.fillPlot ? undefined : { height: props.plotHeight ?? 240 }
          }
        />
      }
    >
      <LazyChartRenderer {...props} />
    </React.Suspense>
  )
}
