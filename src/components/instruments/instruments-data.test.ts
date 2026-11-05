/**
 * LAB-06 / R5-CONFIG-02 — the evidence the registry reports, so the list and the
 * inspector cannot describe the same instrument differently: an automated method
 * without a validated parser, and a calibration stated by the most recent work
 * rather than by the latest due date.
 */
import { describe, expect, it } from 'vitest'

import {
  CALIBRATION_DUE_SOON_DAYS,
  calibrationStatus,
  formatInstrumentDay,
  intakeHealth,
  latestCalibrationByInstrument,
  parserReadinessByInstrument,
} from './instruments-data'
import type { InstrumentCalibrationRow } from './instruments-data'

function calibration(
  row: Pick<
    InstrumentCalibrationRow,
    'id' | 'instrumentId' | 'performedAt' | 'dueAt'
  >,
): InstrumentCalibrationRow {
  return {
    certificateFileId: null,
    performedByUserId: null,
    notes: null,
    ...row,
  }
}

describe('registry calibration standing', () => {
  it('reads the calibration performed most recently, not the one due last', () => {
    const latest = latestCalibrationByInstrument([
      // An older certificate that expires later must not mask the recalibration
      // that already came due: the instrument is overdue, not valid.
      calibration({
        id: 'cal-old',
        instrumentId: 'ins-1',
        performedAt: '2026-01-10T00:00:00.000Z',
        dueAt: '2027-01-10T00:00:00.000Z',
      }),
      calibration({
        id: 'cal-new',
        instrumentId: 'ins-1',
        performedAt: '2026-09-01T00:00:00.000Z',
        dueAt: '2026-10-01T00:00:00.000Z',
      }),
      calibration({
        id: 'cal-other',
        instrumentId: 'ins-2',
        performedAt: '2026-08-01T00:00:00.000Z',
        dueAt: '2027-08-01T00:00:00.000Z',
      }),
    ])

    expect(latest.get('ins-1')?.id).toBe('cal-new')
    expect(latest.get('ins-2')?.id).toBe('cal-other')
    expect(
      calibrationStatus(
        latest.get('ins-1')?.dueAt ?? null,
        new Date('2026-10-13T00:00:00.000Z'),
      ),
    ).toEqual({ tone: 'bad', label: 'Overdue' })
  })

  it('uses one due-soon window, the one the registry list and its filter share', () => {
    const now = new Date('2026-10-13T00:00:00.000Z')
    const inside = new Date(
      now.getTime() + CALIBRATION_DUE_SOON_DAYS * 86_400_000,
    ).toISOString()
    const beyond = new Date(
      now.getTime() + (CALIBRATION_DUE_SOON_DAYS + 1) * 86_400_000,
    ).toISOString()

    expect(calibrationStatus(inside, now)).toEqual({
      tone: 'warn',
      label: 'Due soon',
    })
    expect(calibrationStatus(beyond, now)).toEqual({
      tone: 'ok',
      label: 'Valid',
    })
  })
})

describe('registry intake health', () => {
  it('never reads waiting-for-data for an automated method with no validated parser', () => {
    const readiness = parserReadinessByInstrument(
      [
        { id: 'parser-1', instrumentId: 'ins-1' },
        { id: 'parser-2', instrumentId: 'ins-2' },
      ],
      new Set(['parser-2']),
    )

    expect(readiness.get('ins-1')).toBe(false)
    expect(readiness.get('ins-2')).toBe(true)
    expect(
      intakeHealth('filedrop', {
        parserReady: readiness.get('ins-1') ?? false,
      }),
    ).toEqual({ tone: 'warn', label: 'Parser not validated' })
  })

  it('keeps the import evidence as the answer once a validated parser is attached', () => {
    expect(
      intakeHealth('webhook', { parserReady: true, lastImport: null }),
    ).toEqual({ tone: 'draft', label: 'Waiting for first data' })
  })
})

describe('registry day labels', () => {
  it('writes a stored calibration day the way the other lab surfaces write dates', () => {
    expect(formatInstrumentDay('2027-04-09T00:00:00.000Z')).toBe('9 Apr 2027')
    // The day is the recorded UTC day: a late-evening instant must not slide to
    // the next date for a reader east of Greenwich, or to the day before for one
    // west of it.
    expect(formatInstrumentDay('2027-04-09T23:30:00.000Z')).toBe('9 Apr 2027')
    expect(formatInstrumentDay('2026-09-11')).toBe('11 Sep 2026')
  })

  it('reports a missing or unreadable day as an em dash', () => {
    expect(formatInstrumentDay(null)).toBe('—')
    expect(formatInstrumentDay('not-a-day')).toBe('—')
  })
})
