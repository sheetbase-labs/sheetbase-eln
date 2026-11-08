/**
 * Declarative cell displays: how a plugin says "show this value as a pass/fail
 * pill" or "as a bar out of 100" without running any code in a table cell.
 *
 * A table can hold thousands of cells, so a display is data, never a function:
 * the table draws it with its own parts. The same spec shape is drawn by the
 * app's tables and by the `@sheetbase-labs/sheetbase-table` grid
 * (`packages/table/src/cell-display.tsx` in sheetbase-components); the two stay
 * in step through `CELL_DISPLAY_FIXTURES`, which both repositories test.
 *
 * Browser safe, no server imports.
 */

export const CELL_DISPLAY_TONES = [
  'neutral',
  'success',
  'warning',
  'danger',
  'info',
] as const
export type CellDisplayTone = (typeof CELL_DISPLAY_TONES)[number]

export type CellDisplaySpec =
  | { kind: 'text'; prefix?: string; suffix?: string; mono?: boolean }
  | {
      kind: 'number'
      decimals?: number
      unit?: string
      /** Show 1,234.5 rather than 1234.5. */
      grouping?: boolean
    }
  | {
      kind: 'badge'
      /** Value to tone. A value not listed uses `fallback`. */
      tones: Record<string, CellDisplayTone>
      /** Value to the words shown. A value not listed shows as it is. */
      labels?: Record<string, string>
      fallback?: CellDisplayTone
    }
  | {
      kind: 'bar'
      min?: number
      max: number
      tone?: CellDisplayTone
      /** The first threshold a value is below wins; above all of them uses `tone`. */
      thresholds?: Array<{ below: number; tone: CellDisplayTone }>
      showValue?: boolean
    }
  | { kind: 'sparkline'; tone?: CellDisplayTone }
  | { kind: 'svg' }

export const CELL_DISPLAY_KINDS = [
  'text',
  'number',
  'badge',
  'bar',
  'sparkline',
  'svg',
] as const

const MAX_MAP = 24
const MAX_TEXT = 40
const MAX_THRESHOLDS = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tone(value: unknown): value is CellDisplayTone {
  return (
    typeof value === 'string' &&
    (CELL_DISPLAY_TONES as readonly string[]).includes(value)
  )
}

function short(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max
}

function onlyKeys(
  spec: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  errors: string[],
): boolean {
  const extra = Object.keys(spec).find((key) => !allowed.includes(key))
  if (extra) {
    errors.push(`${where} has an unknown setting: ${extra}`)
    return false
  }
  return true
}

/** Checks a display spec and returns the normalised copy, or null with the problems in `errors`. */
export function parseCellDisplay(
  value: unknown,
  where: string,
  errors: string[],
): CellDisplaySpec | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    errors.push(`${where} display needs a kind`)
    return null
  }
  switch (value.kind) {
    case 'text': {
      if (!onlyKeys(value, ['kind', 'prefix', 'suffix', 'mono'], where, errors))
        return null
      if (
        (value.prefix !== undefined && !short(value.prefix)) ||
        (value.suffix !== undefined && !short(value.suffix)) ||
        (value.mono !== undefined && typeof value.mono !== 'boolean')
      ) {
        errors.push(
          `${where} text display: prefix and suffix are 1-${MAX_TEXT} characters, mono is true or false`,
        )
        return null
      }
      return {
        kind: 'text',
        ...(value.prefix !== undefined
          ? { prefix: value.prefix as string }
          : {}),
        ...(value.suffix !== undefined
          ? { suffix: value.suffix as string }
          : {}),
        ...(value.mono !== undefined ? { mono: value.mono as boolean } : {}),
      }
    }
    case 'number': {
      if (
        !onlyKeys(
          value,
          ['kind', 'decimals', 'unit', 'grouping'],
          where,
          errors,
        )
      )
        return null
      if (
        (value.decimals !== undefined &&
          !(
            Number.isInteger(value.decimals) &&
            (value.decimals as number) >= 0 &&
            (value.decimals as number) <= 8
          )) ||
        (value.unit !== undefined && !short(value.unit, 12)) ||
        (value.grouping !== undefined && typeof value.grouping !== 'boolean')
      ) {
        errors.push(
          `${where} number display: decimals is 0-8, unit is 1-12 characters, grouping is true or false`,
        )
        return null
      }
      return {
        kind: 'number',
        ...(value.decimals !== undefined
          ? { decimals: value.decimals as number }
          : {}),
        ...(value.unit !== undefined ? { unit: value.unit as string } : {}),
        ...(value.grouping !== undefined
          ? { grouping: value.grouping as boolean }
          : {}),
      }
    }
    case 'badge': {
      if (
        !onlyKeys(value, ['kind', 'tones', 'labels', 'fallback'], where, errors)
      )
        return null
      const tones = value.tones
      if (
        !isRecord(tones) ||
        Object.keys(tones).length < 1 ||
        Object.keys(tones).length > MAX_MAP ||
        !Object.entries(tones).every(([key, t]) => short(key, 60) && tone(t))
      ) {
        errors.push(
          `${where} badge display needs tones: 1-${MAX_MAP} values, each one of ${CELL_DISPLAY_TONES.join(', ')}`,
        )
        return null
      }
      if (
        value.labels !== undefined &&
        (!isRecord(value.labels) ||
          Object.keys(value.labels).length > MAX_MAP ||
          !Object.entries(value.labels).every(
            ([key, label]) => short(key, 60) && short(label, 40),
          ))
      ) {
        errors.push(`${where} badge labels are up to ${MAX_MAP} short words`)
        return null
      }
      if (value.fallback !== undefined && !tone(value.fallback)) {
        errors.push(`${where} badge fallback must be a tone`)
        return null
      }
      return {
        kind: 'badge',
        tones: tones as Record<string, CellDisplayTone>,
        ...(value.labels !== undefined
          ? { labels: value.labels as Record<string, string> }
          : {}),
        ...(value.fallback !== undefined
          ? { fallback: value.fallback as CellDisplayTone }
          : {}),
      }
    }
    case 'bar': {
      if (
        !onlyKeys(
          value,
          ['kind', 'min', 'max', 'tone', 'thresholds', 'showValue'],
          where,
          errors,
        )
      )
        return null
      const min = value.min === undefined ? 0 : value.min
      if (
        typeof min !== 'number' ||
        typeof value.max !== 'number' ||
        !Number.isFinite(min) ||
        !Number.isFinite(value.max) ||
        value.max <= min ||
        (value.tone !== undefined && !tone(value.tone)) ||
        (value.showValue !== undefined && typeof value.showValue !== 'boolean')
      ) {
        errors.push(
          `${where} bar display needs a max above its min (default 0), an optional tone and showValue`,
        )
        return null
      }
      let thresholds:
        Array<{ below: number; tone: CellDisplayTone }> | undefined
      if (value.thresholds !== undefined) {
        if (
          !Array.isArray(value.thresholds) ||
          value.thresholds.length > MAX_THRESHOLDS ||
          !value.thresholds.every(
            (entry) =>
              isRecord(entry) &&
              typeof entry.below === 'number' &&
              Number.isFinite(entry.below) &&
              tone(entry.tone),
          )
        ) {
          errors.push(
            `${where} bar thresholds are up to ${MAX_THRESHOLDS} of { below, tone }`,
          )
          return null
        }
        thresholds = (
          value.thresholds as Array<{ below: number; tone: CellDisplayTone }>
        )
          .map((entry) => ({ below: entry.below, tone: entry.tone }))
          .sort((a, b) => a.below - b.below)
      }
      return {
        kind: 'bar',
        ...(value.min !== undefined ? { min } : {}),
        max: value.max,
        ...(value.tone !== undefined
          ? { tone: value.tone as CellDisplayTone }
          : {}),
        ...(thresholds ? { thresholds } : {}),
        ...(value.showValue !== undefined
          ? { showValue: value.showValue as boolean }
          : {}),
      }
    }
    case 'sparkline': {
      if (!onlyKeys(value, ['kind', 'tone'], where, errors)) return null
      if (value.tone !== undefined && !tone(value.tone)) {
        errors.push(`${where} sparkline tone must be a tone`)
        return null
      }
      return {
        kind: 'sparkline',
        ...(value.tone !== undefined
          ? { tone: value.tone as CellDisplayTone }
          : {}),
      }
    }
    case 'svg': {
      if (!onlyKeys(value, ['kind'], where, errors)) return null
      return { kind: 'svg' }
    }
    default:
      errors.push(
        `${where} display kind ${value.kind} is unknown (use ${CELL_DISPLAY_KINDS.join(', ')})`,
      )
      return null
  }
}

// ---------------------------------------------------------------------------
// What a display shows for a value: pure, so tests and both renderers agree.
// ---------------------------------------------------------------------------

export type CellDisplayModel =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; mono: boolean }
  | { kind: 'badge'; text: string; tone: CellDisplayTone }
  | {
      kind: 'bar'
      /** 0 to 1. */
      fraction: number
      tone: CellDisplayTone
      label: string | null
    }
  | { kind: 'sparkline'; values: number[]; tone: CellDisplayTone }
  | { kind: 'svg'; svg: string }

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function formatDisplayNumber(
  n: number,
  decimals: number | undefined,
  grouping: boolean | undefined,
): string {
  const fixed = decimals === undefined ? String(n) : n.toFixed(decimals)
  if (!grouping) return fixed
  const [whole, fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** The numbers in a sparkline cell: a JSON list, or numbers split by commas, spaces or semicolons. */
export function sparklineValues(value: unknown): number[] {
  if (Array.isArray(value))
    return value.map(asNumber).filter((n): n is number => n !== null)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed) ? sparklineValues(parsed) : []
    } catch {
      return []
    }
  }
  return trimmed
    .split(/[\s,;]+/)
    .map(asNumber)
    .filter((n): n is number => n !== null)
}

export function cellDisplayModel(
  spec: CellDisplaySpec,
  value: unknown,
): CellDisplayModel {
  const blank = value === null || value === undefined || value === ''
  if (blank) return { kind: 'empty' }
  const raw = String(value)
  switch (spec.kind) {
    case 'text':
      return {
        kind: 'text',
        text: `${spec.prefix ?? ''}${raw}${spec.suffix ?? ''}`,
        mono: spec.mono === true,
      }
    case 'number': {
      const n = asNumber(value)
      if (n === null) return { kind: 'text', text: raw, mono: false }
      const text = formatDisplayNumber(n, spec.decimals, spec.grouping)
      return {
        kind: 'text',
        text: spec.unit ? `${text} ${spec.unit}` : text,
        mono: false,
      }
    }
    case 'badge':
      return {
        kind: 'badge',
        text: spec.labels?.[raw] ?? raw,
        tone: spec.tones[raw] ?? spec.fallback ?? 'neutral',
      }
    case 'bar': {
      const n = asNumber(value)
      if (n === null) return { kind: 'text', text: raw, mono: false }
      const min = spec.min ?? 0
      const fraction = Math.min(1, Math.max(0, (n - min) / (spec.max - min)))
      const matched = spec.thresholds?.find((entry) => n < entry.below)
      const above = spec.thresholds?.at(-1)
      return {
        kind: 'bar',
        fraction,
        tone: matched?.tone ?? spec.tone ?? (above ? 'success' : 'info'),
        label:
          spec.showValue === false
            ? null
            : formatDisplayNumber(n, undefined, false),
      }
    }
    case 'sparkline': {
      const values = sparklineValues(value)
      return values.length < 2
        ? { kind: 'text', text: raw, mono: false }
        : { kind: 'sparkline', values, tone: spec.tone ?? 'info' }
    }
    case 'svg':
      return { kind: 'svg', svg: raw }
  }
}

/**
 * Cases both repositories run against their renderer model, so the app and the
 * table package cannot disagree about what a spec shows.
 */
export const CELL_DISPLAY_FIXTURES: Array<{
  spec: CellDisplaySpec
  value: unknown
  expect: CellDisplayModel
}> = [
  {
    spec: { kind: 'badge', tones: { pass: 'success', fail: 'danger' } },
    value: 'pass',
    expect: { kind: 'badge', text: 'pass', tone: 'success' },
  },
  {
    spec: {
      kind: 'badge',
      tones: { pass: 'success' },
      labels: { fail: 'Failed' },
      fallback: 'danger',
    },
    value: 'fail',
    expect: { kind: 'badge', text: 'Failed', tone: 'danger' },
  },
  {
    spec: { kind: 'number', decimals: 1, unit: 'µM', grouping: true },
    value: 12345.678,
    expect: { kind: 'text', text: '12,345.7 µM', mono: false },
  },
  {
    spec: {
      kind: 'bar',
      max: 100,
      thresholds: [
        { below: 50, tone: 'danger' },
        { below: 80, tone: 'warning' },
      ],
      tone: 'success',
    },
    value: 64,
    expect: { kind: 'bar', fraction: 0.64, tone: 'warning', label: '64' },
  },
  {
    spec: { kind: 'sparkline' },
    value: '1, 3, 2',
    expect: { kind: 'sparkline', values: [1, 3, 2], tone: 'info' },
  },
  {
    spec: { kind: 'text', suffix: ' bp' },
    value: '1200',
    expect: { kind: 'text', text: '1200 bp', mono: false },
  },
  { spec: { kind: 'text' }, value: '', expect: { kind: 'empty' } },
]
