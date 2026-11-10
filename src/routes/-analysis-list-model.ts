import { t } from '#/copy'

/** One saved analysis, as the list shows it whichever save it came from. */
export interface AnalysisRow {
  id: string
  kind: 'chart' | 'statistics'
  /** The display id when the row has one, else the start of its id. */
  identifier: string
  /** What a citation of this row names, for the Cited tab. */
  citeKey: string
  name: string
  /** The chart type or statistic, e.g. `line` or `descriptive`. */
  detail: string
  ownerId: string
  version: number
  updatedAt: string
  datasetId: string | undefined
}

/** What each kind of new analysis is called and how it is described. */
export const ANALYSIS_MODES = [
  {
    mode: 'chart',
    label: t('data.analysisList.chart'),
    start: t('data.analysisList.startChart'),
    body: t('data.analysisList.figureFromDatasetSnapshot'),
  },
  {
    mode: 'analyse',
    label: t('data.analysisList.analyse'),
    start: t('data.analysisList.startAnalyse'),
    body: t('data.analysisList.statisticsAssumptionChecks'),
  },
  {
    mode: 'compare',
    label: t('data.analysisList.compare'),
    start: t('data.analysisList.startCompare'),
    body: t('data.analysisList.twoSnapshotsSideSide'),
  },
] as const

export const analysisSorts = ['Updated', 'Name', 'ID'] as const

export type AnalysisSort = (typeof analysisSorts)[number]

const KIND_LABEL: Record<AnalysisRow['kind'], string> = {
  chart: t('data.analysisList.chart'),
  statistics: t('data.analysisList.statistics'),
}

export function tabLabelFor(tab: 'mine' | 'cited' | 'drafts'): string {
  return tab === 'cited'
    ? t('data.analysisList.citedRecords')
    : tab === 'mine'
      ? t('data.analysisList.mine')
      : t('data.analysisList.drafts')
}

export function kindLabel(row: AnalysisRow): string {
  return `${KIND_LABEL[row.kind]} · ${row.detail}`
}

/**
 * Why the list is empty, so a tab filter that matches nothing does not read as
 * a workspace with no analyses: the header above reports "N saved analyses"
 * from the unfiltered rows.
 */
/** The empty state's two lines of copy. */
export interface AnalysisEmptyCopy {
  title: string
  body: string
}

export function emptyCopyFor(
  needle: string,
  rowCount: number,
  tab: 'mine' | 'cited' | 'drafts' | undefined,
): AnalysisEmptyCopy {
  if (needle)
    return {
      title: t('data.analysisList.analysesMatch'),
      body: t('data.analysisList.analysisIdNameKind'),
    }

  if (rowCount > 0 && tab === 'cited')
    return {
      title: t('data.analysisList.analysesCitedRecords'),
      body: t('data.analysisList.analysisAppearsHereOnce'),
    }

  if (rowCount > 0 && tab === 'mine')
    return {
      title: t('data.analysisList.analysesOwn'),
      body: t('data.analysisList.haveSavedAnalysisWorkspace'),
    }

  if (rowCount > 0 && tab === 'drafts')
    return {
      title: t('data.analysisList.draftAnalyses'),
      body: t('data.analysisList.everyAnalysisWorkspaceHas'),
    }

  return {
    title: t('data.analysisList.analysesYet'),
    body: t('data.analysisList.analysisReadsPinnedDataset'),
  }
}
