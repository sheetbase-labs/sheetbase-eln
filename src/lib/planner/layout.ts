/**
 * Lays conditions out on a plate: each condition gets its wells (more than one
 * when replicates are asked for), spread over the plate in a seeded random order
 * so a trend across the plate cannot line up with a condition, with blank and
 * control wells at fixed positions in the first column. When there is a liquid
 * handler, a worklist stamps the prepared conditions into the sample wells.
 */
import { shuffleWithSeed } from '#/lib/plate-designer'
import {
  FORMAT_DIMENSIONS,
  parseWellCode,
  plateWellCount,
  wellCode,
} from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'

export interface Trial {
  trial: number
  factors: Record<string, string | number>
  wells?: string[]
}

export interface PlateLayout {
  plateFormat?: string | null
  replicates?: number
  blanks?: number
  positives?: number
  negatives?: number
  volumeUl?: number
  worklistFormat?: string | null
}

export interface LaidOutWell {
  wellCode: string
  role: 'sample' | 'positive_control' | 'negative_control' | 'blank'
  sampleLabel?: string
  volumeUl?: number
}

export interface LaidOutTransfer {
  sourceWell: string
  destWell: string
  volumeUl: number
  label?: string
}

export interface RoundPlate {
  format: PlateFormat
  wells: LaidOutWell[]
  transfers: LaidOutTransfer[]
}

/** A round's plate (null when no format was asked for) and its conditions with their wells. */
export interface RoundLayout {
  plate: RoundPlate | null
  trials: Trial[]
}

export const DEFAULT_PLATE_FORMAT: PlateFormat = '96_well'

export function isPlateFormat(value: string): value is PlateFormat {
  return value in FORMAT_DIMENSIONS
}

/** How many wells the conditions need. */
export function wellsNeeded(layout: PlateLayout, trialCount: number) {
  const replicates = Math.max(1, layout.replicates ?? 1)

  return (
    trialCount * replicates +
    (layout.blanks ?? 0) +
    (layout.positives ?? 0) +
    (layout.negatives ?? 0)
  )
}

/**
 * The plate for the conditions, or null when no plate format is given. Throws
 * with a plain sentence when the batch does not fit.
 */
export function layoutRound(
  trials: readonly Trial[],
  layout: PlateLayout,
  seed: number,
): RoundLayout {
  const format = layout.plateFormat

  if (!format) return { plate: null, trials: [...trials] }

  if (!isPlateFormat(format))
    throw new Error('That plate format is not supported.')
  const { rows, cols } = FORMAT_DIMENSIONS[format]
  const needed = wellsNeeded(layout, trials.length)

  if (needed > plateWellCount(format))
    throw new Error(
      `The batch needs ${needed} wells (replicates and controls included) but a ${plateWellCount(format)}-well plate has fewer. Make the batch smaller or use a bigger plate.`,
    )

  // Controls fill the first column from the top: blanks, then negatives, then positives.
  const wells: LaidOutWell[] = []
  const reserved = new Set<string>()
  let nextControl = 0

  const control = (role: LaidOutWell['role'], count: number) => {
    for (let i = 0; i < count; i++) {
      const row = nextControl % rows
      const col = Math.floor(nextControl / rows)
      nextControl += 1
      const code = wellCode(row, col)
      reserved.add(code)
      wells.push({ wellCode: code, role })
    }
  }

  control('blank', layout.blanks ?? 0)
  control('negative_control', layout.negatives ?? 0)
  control('positive_control', layout.positives ?? 0)

  const free: string[] = []

  for (let col = 0; col < cols; col++)
    for (let row = 0; row < rows; row++) {
      const code = wellCode(row, col)

      if (!reserved.has(code)) free.push(code)
    }

  const order = shuffleWithSeed(free, seed)
  const replicates = Math.max(1, layout.replicates ?? 1)

  const volume =
    layout.volumeUl && layout.volumeUl > 0 ? layout.volumeUl : undefined

  const transfers: LaidOutTransfer[] = []

  const placed = trials.map((trial) => {
    const own = order.splice(0, replicates)

    for (const code of own) {
      const well: LaidOutWell = {
        wellCode: code,
        role: 'sample',
        sampleLabel: `T${trial.trial}`,
      }

      if (volume) well.volumeUl = volume

      wells.push(well)

      if (layout.worklistFormat && volume)
        transfers.push({
          sourceWell: code,
          destWell: code,
          volumeUl: volume,
          label: `T${trial.trial}`,
        })
    }

    return { ...trial, wells: own }
  })

  wells.sort((a, b) => {
    const pa = parseWellCode(a.wellCode)
    const pb = parseWellCode(b.wellCode)

    return (pa?.col ?? 0) - (pb?.col ?? 0) || (pa?.row ?? 0) - (pb?.row ?? 0)
  })

  return { plate: { format, wells, transfers }, trials: placed }
}
