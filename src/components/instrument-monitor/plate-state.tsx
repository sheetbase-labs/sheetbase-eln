/**
 * OPS-006 — 96-well plate state rendered through the shared PlateMap
 * component (semantic grid, keyboard-operable, role-based colouring) instead
 * of a custom HTML/CSS grid. Maps qPCR well statuses into PlateWell[] with
 * roleClass colouring and a role legend.
 */
import * as React from 'react'

import { PlateMap } from '#/components/viz/plate-map'
import type { PlateWell, PlateMapRoleLegendEntry } from '#/components/viz/plate-map'
import {
  WELL_COLS,
  WELL_ROWS,
} from '#/lib/instrument-monitor'
import type {
  InstrumentPlateSnapshot,
  RunStatus,
} from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

export interface PlateStateProps {
  snapshots: InstrumentPlateSnapshot[]
  runStatus: RunStatus
}

type WellStatus = 'amplified' | 'no_amplification' | 'blank' | 'pending'

const WELL_ROLE_CLASS: Record<WellStatus, string> = {
  amplified: 'bg-success/80',
  no_amplification: 'bg-info/80',
  blank: 'bg-zinc-400 dark:bg-zinc-500',
  pending: 'bg-muted/30',
}

const WELL_ROLE_LABEL: Record<WellStatus, string> = {
  amplified: 'Amplified',
  no_amplification: 'No amplification',
  blank: 'Blank',
  pending: 'Pending',
}

const ROLE_LEGEND: PlateMapRoleLegendEntry[] = (
  Object.keys(WELL_ROLE_CLASS) as WellStatus[]
).map((status) => ({
  label: WELL_ROLE_LABEL[status],
  className: WELL_ROLE_CLASS[status],
}))

function wellStatus(value: unknown): WellStatus {
  if (typeof value === 'string') {
    return value in WELL_ROLE_CLASS ? (value as WellStatus) : 'pending'
  }
  if (value && typeof value === 'object') {
    const status = String(
      (value as Record<string, unknown>).status ?? 'pending',
    )
    return status in WELL_ROLE_CLASS ? (status as WellStatus) : 'pending'
  }
  return 'pending'
}

export function PlateState({ snapshots, runStatus }: PlateStateProps) {
  const latest: InstrumentPlateSnapshot | null =
    snapshots.length > 0
      ? [...snapshots].sort(
          (a, b) =>
            new Date(b.capturedAt).getTime() -
            new Date(a.capturedAt).getTime(),
        )[0]
      : null

  const wells: PlateWell[] = React.useMemo(() => {
    if (!latest) return []
    const result: PlateWell[] = []
    for (const row of WELL_ROWS) {
      for (const col of WELL_COLS) {
        const code = `${row}${col}`
        const value = latest.wells[code]
        const status = wellStatus(value)
        const sample =
          value && typeof value === 'object'
            ? String(
                (value as Record<string, unknown>).sample ?? '',
              )
            : ''
        result.push({
          row: row.charCodeAt(0) - 65,
          col: col - 1,
          wellCode: code,
          roleClass: WELL_ROLE_CLASS[status],
          label: sample
            ? `${code} · ${WELL_ROLE_LABEL[status]} · ${sample}`
            : `${code} · ${WELL_ROLE_LABEL[status]}`,
        })
      }
    }
    return result
  }, [latest])

  return (
    <PlateMap
      wells={wells}
      rows={WELL_ROWS.length}
      cols={WELL_COLS.length}
      roleLegend={ROLE_LEGEND}
      readOnly
      ariaLabel="96-well plate state"
      className={cn(runStatus === 'cancelled' && 'opacity-60')}
    />
  )
}
