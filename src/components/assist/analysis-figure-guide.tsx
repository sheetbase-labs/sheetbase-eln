/**
 * ASSIST-03 — analysis-to-figure guide mount for the Analysis studio.
 *
 * Derives guide state from live studio state (selected source, loaded rows,
 * compare config validity, whether the compare config was promoted) and
 * wires next actions to the studio's own canonical paths: the chart-propose
 * accept runs the identical `promoteToChartSpec` hand-off the CompareView
 * uses, feeding the same follow-on the manual Promote button uses. The
 * notebook embed has no record context in the studio, so that accept
 * navigates to the notebook surface where the canonical embed lives.
 * The wrapper never mutates anything itself.
 */
import { GUIDED_ACCEPTS, evaluateAnalysisToFigure } from '#/lib/assist-guide'
import type { GuideAcceptKey } from '#/lib/assist-guide'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { validateComparativeViewConfig } from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'

import { GuidePanel } from './guide-panel'

export interface AnalysisFigureGuideProps {
  datasetId: string
  columnCount: number
  rowCount: number
  compareConfig: ComparativeViewConfig | null
  columns?: ChartColumn[]
  /** True once the compare config was promoted through the canonical hand-off. */
  chartSpecReady: boolean
  onPromoteGuide?: (spec: ChartSpec) => void
  onNavigateGuide?: (href: string) => void
}

export function AnalysisFigureGuide({
  datasetId,
  columnCount,
  rowCount,
  compareConfig,
  columns,
  chartSpecReady,
  onPromoteGuide,
  onNavigateGuide,
}: AnalysisFigureGuideProps) {
  const compareConfigValid =
    compareConfig !== null &&
    validateComparativeViewConfig(compareConfig).length === 0
  const workflow = evaluateAnalysisToFigure({
    datasetId,
    columnCount,
    rowCount,
    compareConfigValid,
    chartSpecReady,
    embeddedBlockId: null,
  })

  function handleAccept(key: GuideAcceptKey) {
    if (key === 'promoteToChartSpec') {
      if (!compareConfig || !compareConfigValid) return
      onPromoteGuide?.(
        GUIDED_ACCEPTS.promoteToChartSpec(compareConfig, columns),
      )
      return
    }
    // No notebook record exists in studio context (datasets carry no
    // record link): navigate to the dashboard resumption surface, where
    // notebooks live and the canonical embed accept runs. Guidance only
    // navigates — nothing is changed.
    onNavigateGuide?.('/')
  }

  return <GuidePanel workflow={workflow} onAccept={handleAccept} />
}
