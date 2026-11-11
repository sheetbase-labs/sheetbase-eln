/**
 * The Analysis Studio's three modes, in tab order, and the label each one
 * carries. A module of its own so the sections module exports components only.
 */
import { z } from 'zod'

import { t } from '#/copy'

/** The studio modes, in tab order: the strip announces these as tabs. */
export const STUDIO_MODES = ['chart', 'analyse', 'compare'] as const

export const studioModeSchema = z.enum(STUDIO_MODES)

export type StudioMode = z.infer<typeof studioModeSchema>

export const STUDIO_MODE_LABEL: Record<StudioMode, string> = {
  chart: t('data.analysisStudio.chartBuilder'),
  analyse: t('data.analysisStudio.analyse'),
  compare: t('data.analysisStudio.compare'),
}
