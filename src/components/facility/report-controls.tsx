/**
 * The pieces the spend and usage reports share: the period they cover and the
 * row of headline figures above the table.
 */
import { useMemo, useState } from 'react'
import { z } from 'zod'

import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { now as appNow } from '#/lib/clock'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { dayEnd, dayStart, isoDay, resolvePeriod } from '#/lib/report-period'
import type { DateRange, ReportPeriod } from '#/lib/report-period'

const UI_PERIODS = [
  'this_month',
  'last_month',
  'previous_week',
  'last_7_days',
  'last_30_days',
  'custom',
] as const satisfies readonly ReportPeriod[]

/** The period a native select can hand back, decoded at the change boundary. */
const uiPeriodSchema = z.enum(UI_PERIODS)

export interface ReportRangeState {
  period: ReportPeriod
  setPeriod: (period: ReportPeriod) => void
  from: string
  setFrom: (value: string) => void
  to: string
  setTo: (value: string) => void
  /** The days covered, or null while custom dates are missing or backwards. */
  range: DateRange | null
  /** The time zone the calendar is read in. */
  zone: string
  invalid: boolean
}

/** The period a report covers, kept as state: a preset, or chosen dates. */
export function useReportRange(
  initial: ReportPeriod = 'last_month',
): ReportRangeState {
  const zone = useDisplayTimeZone()
  const [period, setPeriod] = useState<ReportPeriod>(initial)
  const [from, setFrom] = useState(() => isoDay(appNow(), zone))
  const [to, setTo] = useState(() => isoDay(appNow(), zone))

  const range = useMemo<DateRange | null>(() => {
    if (period !== 'custom') return resolvePeriod(period, appNow(), zone)
    const start = dayStart(from, zone)
    const end = dayEnd(to, zone)

    if (!start || !end || end <= start) return null

    return { from: start, to: end }
  }, [period, from, to, zone])

  return {
    period,
    setPeriod,
    from,
    setFrom,
    to,
    setTo,
    range,
    zone,
    invalid: range === null,
  }
}

export function PeriodPicker({ state }: { state: ReportRangeState }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-label text-fg-muted">
        {t('spend.controls.period')}
        <Select
          size="sm"
          aria-label={t('spend.controls.period')}
          className="w-40"
          value={state.period}
          onChange={(e) =>
            state.setPeriod(uiPeriodSchema.parse(e.target.value))
          }
        >
          {UI_PERIODS.map((key) => (
            <option key={key} value={key}>
              {t(`spend.periods.${key}`)}
            </option>
          ))}
        </Select>
      </label>
      {state.period === 'custom' ? (
        <>
          <label className="flex items-center gap-1 text-label text-fg-muted">
            {t('spend.controls.from')}
            <Input
              type="date"
              className="h-[26px] w-36 text-label"
              value={state.from}
              max={state.to || undefined}
              onChange={(e) => state.setFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-label text-fg-muted">
            {t('spend.controls.to')}
            <Input
              type="date"
              className="h-[26px] w-36 text-label"
              value={state.to}
              min={state.from || undefined}
              onChange={(e) => state.setTo(e.target.value)}
            />
          </label>
          {state.invalid ? (
            <span role="alert" className="text-label text-danger-text">
              {t('spend.controls.invalidRange')}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export interface Figure {
  label: string
  value: string
  /** A sentence that explains the figure; shown on hover and focus. */
  tip?: string
}

/** The headline figures for the period, side by side above the table. */
export function ReportFigures({ figures }: { figures: Figure[] }) {
  return (
    <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 border-b border-border px-6 py-3 max-md:px-4">
      {figures.map((figure) => (
        <div key={figure.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-label text-fg-muted">
            {figure.tip ? (
              <Tooltip content={figure.tip}>
                <span
                  tabIndex={0}
                  className="cursor-help underline decoration-dotted underline-offset-2"
                >
                  {figure.label}
                </span>
              </Tooltip>
            ) : (
              figure.label
            )}
          </dt>
          <dd className="num m-0 text-section">{figure.value}</dd>
        </div>
      ))}
    </dl>
  )
}
