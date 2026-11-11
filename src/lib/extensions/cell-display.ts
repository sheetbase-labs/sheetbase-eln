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
import { z } from 'zod'

import { isRecord } from './points'

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
      tones: Partial<Record<string, CellDisplayTone>>
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

/** The displays a grid draws its cells with, by column id. */
export type CellDisplays = Readonly<Record<string, CellDisplaySpec>>

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

function onlyKeys(
  actual: readonly string[],
  allowed: readonly string[],
  where: string,
  errors: string[],
): boolean {
  const known = new Set(allowed)
  const extra = actual.find((key) => !known.has(key))

  if (extra) {
    errors.push(`${where} has an unknown setting: ${extra}`)

    return false
  }

  return true
}

/** Checks a display spec and returns the normalised copy, or null with the problems in `errors`. */
export function parseCellDisplay(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Plugin display declarations cross here; inspect original keys and parse each kind's bounded settings before constructing the renderer's spec, including original badge-map keys.
  value: unknown,
  where: string,
  errors: string[],
): CellDisplaySpec | null {
  const kind = z.string().safeParse(isRecord(value) ? value.kind : undefined)

  if (!isRecord(value) || !kind.success) {
    errors.push(`${where} display needs a kind`)

    return null
  }

  switch (kind.data) {
    case 'text': {
      if (
        !onlyKeys(
          Object.keys(value),
          ['kind', 'prefix', 'suffix', 'mono'],
          where,
          errors,
        )
      )
        return null

      const settings = z
        .object({
          prefix: z.string().min(1).max(MAX_TEXT).optional(),
          suffix: z.string().min(1).max(MAX_TEXT).optional(),
          mono: z.boolean().optional(),
        })
        .safeParse(value)

      if (!settings.success) {
        errors.push(
          `${where} text display: prefix and suffix are 1-${MAX_TEXT} characters, mono is true or false`,
        )

        return null
      }

      const result: Extract<CellDisplaySpec, { kind: 'text' }> = {
        kind: 'text',
      }

      if (settings.data.prefix !== undefined)
        result.prefix = settings.data.prefix

      if (settings.data.suffix !== undefined)
        result.suffix = settings.data.suffix

      if (settings.data.mono !== undefined) result.mono = settings.data.mono

      return result
    }

    case 'number': {
      if (
        !onlyKeys(
          Object.keys(value),
          ['kind', 'decimals', 'unit', 'grouping'],
          where,
          errors,
        )
      )
        return null

      const settings = z
        .object({
          decimals: z.number().int().min(0).max(8).optional(),
          unit: z.string().min(1).max(12).optional(),
          grouping: z.boolean().optional(),
        })
        .safeParse(value)

      if (!settings.success) {
        errors.push(
          `${where} number display: decimals is 0-8, unit is 1-12 characters, grouping is true or false`,
        )

        return null
      }

      const result: Extract<CellDisplaySpec, { kind: 'number' }> = {
        kind: 'number',
      }

      if (settings.data.decimals !== undefined)
        result.decimals = settings.data.decimals

      if (settings.data.unit !== undefined) result.unit = settings.data.unit

      if (settings.data.grouping !== undefined)
        result.grouping = settings.data.grouping

      return result
    }

    case 'badge': {
      if (
        !onlyKeys(
          Object.keys(value),
          ['kind', 'tones', 'labels', 'fallback'],
          where,
          errors,
        )
      )
        return null

      const tones = z
        .array(z.tuple([z.string().min(1).max(60), z.enum(CELL_DISPLAY_TONES)]))
        .min(1)
        .max(MAX_MAP)
        .safeParse(
          isRecord(value.tones) ? Object.entries(value.tones) : undefined,
        )

      if (!tones.success) {
        errors.push(
          `${where} badge display needs tones: 1-${MAX_MAP} values, each one of ${CELL_DISPLAY_TONES.join(', ')}`,
        )

        return null
      }

      const labels = z
        .array(z.tuple([z.string().min(1).max(60), z.string().min(1).max(40)]))
        .max(MAX_MAP)
        .optional()
        .safeParse(
          value.labels === undefined
            ? undefined
            : isRecord(value.labels)
              ? Object.entries(value.labels)
              : null,
        )

      if (!labels.success) {
        errors.push(`${where} badge labels are up to ${MAX_MAP} short words`)

        return null
      }

      const fallback = z
        .enum(CELL_DISPLAY_TONES)
        .optional()
        .safeParse(value.fallback)

      if (!fallback.success) {
        errors.push(`${where} badge fallback must be a tone`)

        return null
      }

      const result: Extract<CellDisplaySpec, { kind: 'badge' }> = {
        kind: 'badge',
        tones: Object.fromEntries(tones.data),
      }

      if (labels.data !== undefined)
        result.labels = Object.fromEntries(labels.data)

      if (fallback.data !== undefined) result.fallback = fallback.data

      return result
    }

    case 'bar': {
      if (
        !onlyKeys(
          Object.keys(value),
          ['kind', 'min', 'max', 'tone', 'thresholds', 'showValue'],
          where,
          errors,
        )
      )
        return null

      const settings = z
        .object({
          min: z.number().optional(),
          max: z.number(),
          tone: z.enum(CELL_DISPLAY_TONES).optional(),
          showValue: z.boolean().optional(),
        })
        .refine((range) => range.max > (range.min ?? 0))
        .safeParse(value)

      if (!settings.success) {
        errors.push(
          `${where} bar display needs a max above its min (default 0), an optional tone and showValue`,
        )

        return null
      }

      let thresholds:
        Array<{ below: number; tone: CellDisplayTone }> | undefined

      if (value.thresholds !== undefined) {
        const parsed = z
          .array(
            z.object({ below: z.number(), tone: z.enum(CELL_DISPLAY_TONES) }),
          )
          .max(MAX_THRESHOLDS)
          .safeParse(value.thresholds)

        if (!parsed.success) {
          errors.push(
            `${where} bar thresholds are up to ${MAX_THRESHOLDS} of { below, tone }`,
          )

          return null
        }

        thresholds = parsed.data.sort((a, b) => a.below - b.below)
      }

      const result: Extract<CellDisplaySpec, { kind: 'bar' }> = {
        kind: 'bar',
        max: settings.data.max,
      }

      if (settings.data.min !== undefined) result.min = settings.data.min

      if (settings.data.tone !== undefined) result.tone = settings.data.tone

      if (thresholds !== undefined) result.thresholds = thresholds

      if (settings.data.showValue !== undefined)
        result.showValue = settings.data.showValue

      return result
    }

    case 'sparkline': {
      if (!onlyKeys(Object.keys(value), ['kind', 'tone'], where, errors))
        return null

      const tone = z.enum(CELL_DISPLAY_TONES).optional().safeParse(value.tone)

      if (!tone.success) {
        errors.push(`${where} sparkline tone must be a tone`)

        return null
      }

      const result: Extract<CellDisplaySpec, { kind: 'sparkline' }> = {
        kind: 'sparkline',
      }

      if (tone.data !== undefined) result.tone = tone.data

      return result
    }

    case 'svg': {
      if (!onlyKeys(Object.keys(value), ['kind'], where, errors)) return null

      return { kind: 'svg' }
    }

    default:
      errors.push(
        `${where} display kind ${kind.data} is unknown (use ${CELL_DISPLAY_KINDS.join(', ')})`,
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

const displayNumberSchema = z.union([
  z.number(),
  z.string().trim().min(1).transform(Number).refine(Number.isFinite),
])

function asNumber(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A display's cell or sparkline element is parsed here as a finite number or nonblank numeric text; all other values keep the existing null/fallback behavior.
  value: unknown,
): number | null {
  const parsed = displayNumberSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

export function formatDisplayNumber(
  n: number,
  decimals: number | undefined,
  grouping: boolean | undefined,
): string {
  const fixed = decimals === undefined ? String(n) : n.toFixed(decimals)

  if (!grouping) return fixed
  const dot = fixed.indexOf('.')
  const whole = dot < 0 ? fixed : fixed.slice(0, dot)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return dot < 0 ? grouped : `${grouped}${fixed.slice(dot)}`
}

/** The numbers in a sparkline cell: a JSON list, or numbers split by commas, spaces or semicolons. */
export function sparklineValues(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Sparkline cells may contain a list, JSON list text or delimited numeric text; list/text schemas select the representation and asNumber rejects unsupported elements without coercing booleans/objects.
  value: unknown,
): number[] {
  const list = z.array(z.unknown()).safeParse(value)

  if (list.success)
    return list.data.map(asNumber).filter((n): n is number => n !== null)

  const text = z.string().safeParse(value)

  if (!text.success) return []
  const trimmed = text.data.trim()

  if (trimmed.startsWith('[')) {
    try {
      const parsed = z.array(z.unknown()).safeParse(JSON.parse(trimmed))

      return parsed.success ? sparklineValues(parsed.data) : []
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Display values intentionally accept arbitrary native values, not just JSON. Blank handling and one native String conversion precede every spec branch; hooks.test.ts covers Symbols, custom coercion, Unicode and arbitrary throws.
  value: unknown,
): CellDisplayModel {
  const blank = value === null || value === undefined || value === ''

  if (blank) return { kind: 'empty' }
  // oxlint-disable-next-line typescript/no-base-to-string -- Native object/Symbol/custom coercion and thrown values are the public display fallback contract. Coerce exactly once before kind-specific parsing; do not JSON-normalize or catch it (hooks.test.ts).
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
