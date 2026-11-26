import { isRpcActionOf } from '#/lib/assistant-rpc-cards'
import type { RpcAction, RpcCardInfo } from '#/lib/assistant-rpc-cards'

/** Analysis and chart cards (see `#/lib/assistant-rpc-cards`). */
export const ANALYSIS_CARDS = [
  {
    tool: 'sheetbase.analysis.save_view',
    covers: ['save_analysis_view'],
    words: ['Save view', 'Saving…', 'View saved'],
    does: 'save an analysis view',
  },
  {
    tool: 'sheetbase.analysis.save_definition',
    covers: ['save_analysis_definition'],
    words: ['Save analysis', 'Saving…', 'Analysis saved'],
    does: 'save an analysis',
  },
  {
    tool: 'sheetbase.analysis.compose',
    covers: ['compose_analysis_definition'],
    words: ['Make analysis', 'Making…', 'Analysis made'],
    does: 'make an analysis from a chart',
  },
  {
    tool: 'sheetbase.analysis.resolve_sources',
    covers: ['resolve_analysis_view_sources'],
    words: ['Decide', 'Deciding…', 'Decided'],
    does: 'decide about newer analysis data',
  },
  {
    tool: 'sheetbase.notebook_chart.freeze',
    covers: [
      'freeze_chart',
      'unfreeze_chart',
      'freeze_analysis_block',
      'unfreeze_analysis_block',
    ],
    words: ['Apply', 'Applying…', 'Done'],
    does: 'freeze or unfreeze a notebook chart',
  },
  {
    tool: 'sheetbase.notebook_chart.bind_revision',
    covers: ['bind_chart_revision'],
    words: ['Pin chart', 'Pinning…', 'Chart pinned'],
    does: 'pin a notebook chart to a revision',
  },
] as const satisfies readonly RpcCardInfo[]

export type AnalysisCardsProposeToolName =
  (typeof ANALYSIS_CARDS)[number]['tool']

export type AnalysisCardsAction = RpcAction<AnalysisCardsProposeToolName>

export const isAnalysisCardsAction =
  isRpcActionOf<AnalysisCardsProposeToolName>(ANALYSIS_CARDS)
