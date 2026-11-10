import { t } from '#/copy'
import { daysUntilDate } from '#/lib/calendar-days'
import { now as appNow } from '#/lib/clock'
import {
  CALIBRATION_DUE_SOON_DAYS,
  formatInstrumentDay,
} from '#/components/instruments/instruments-data'

/**
 * How an instrument's calibration stands, as the registry's calibration column
 * and the Calibration tab read it.
 */

export type CalibrationState = 'ok' | 'soon' | 'overdue' | 'na'

/** How an instrument's calibration stands, as the registry column and Calibration tab show it. */
export interface CalibrationStanding {
  state: CalibrationState
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'none'
}

/** The registry's calibration due column and its Calibration tab. */
export function calibrationState(
  dueAt: string | null | undefined,
  now: Date = appNow(),
): CalibrationStanding {
  if (!dueAt)
    return {
      state: 'na',
      label: t('library.instruments.list.notCalibrated'),
      tone: 'none',
    }

  const due = Date.parse(dueAt)

  if (Number.isNaN(due))
    return {
      state: 'na',
      label: t('library.instruments.list.notCalibrated'),
      tone: 'none',
    }

  const days = daysUntilDate(dueAt, now) ?? 0
  const day = formatInstrumentDay(dueAt)

  if (days < 0)
    return {
      state: 'overdue',
      label: t('library.instruments.list.dOverdue', { day, days: -days }),
      tone: 'bad',
    }

  if (days <= CALIBRATION_DUE_SOON_DAYS)
    return {
      state: 'soon',
      label: t('library.instruments.list.dueInD', { day, days }),
      tone: 'warn',
    }

  return { state: 'ok', label: day, tone: 'ok' }
}
