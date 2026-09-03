
import { SHEETBASE_LITERAL_PROFILE } from './hyperformula-literals'

export const SHEETBASE_HF_PROFILE = 'sheetbase-hf-en-us-v1' as const
export const SHEETBASE_FUNCTION_PROFILE = 'scientific-core-v2' as const
export const SHEETBASE_HF_VERSION = '3.3.0' as const

export const SCIENTIFIC_CORE_FUNCTIONS = Object.freeze([
  // --- v1: aggregation / statistics ---
  'SUM',
  'PRODUCT',
  'SUMSQ',
  'AVERAGE',
  'MEDIAN',
  'MIN',
  'MAX',
  'COUNT',
  'COUNTA',
  'STDEV.S',
  'STDEV.P',
  'VAR.S',
  'VAR.P',
  // --- v1: numeric / scientific ---
  'ABS',
  'SIGN',
  'MOD',
  'POWER',
  'SQRT',
  'EXP',
  'LN',
  'LOG',
  'LOG10',
  'ROUND',
  'ROUNDDOWN',
  'ROUNDUP',
  'INT',
  'PI',
  'SIN',
  'COS',
  'TAN',
  'ASIN',
  'ACOS',
  'ATAN',
  'ATAN2',
  'DEGREES',
  'RADIANS',
  // --- v1: logical / error ---
  'IF',
  'IFS',
  'AND',
  'OR',
  'NOT',
  'IFERROR',
  'IFNA',
  'NA',
  // --- v1: inspection / lookup ---
  'ISBLANK',
  'ISERROR',
  'ISNA',
  'ISNUMBER',
  'ISTEXT',
  'INDEX',
  'MATCH',
  'XLOOKUP',
  // --- v1: deterministic date parts ---
  'DATE',
  'TIME',
  'YEAR',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
  // --- v2: statistics (scientific) ---
  'STDEV',
  'STDEVA',
  'STDEVP',
  'STDEVPA',
  'VAR',
  'VARA',
  'VARP',
  'VARPA',
  'COVARIANCE.P',
  'COVARIANCE.S',
  'CORREL',
  'PEARSON',
  'NORM.DIST',
  'NORM.INV',
  'NORM.S.DIST',
  'NORM.S.INV',
  'T.DIST',
  'T.DIST.2T',
  'T.INV',
  'T.INV.2T',
  'T.TEST',
  'CHISQ.DIST',
  'CHISQ.INV',
  'CHISQ.TEST',
  'F.DIST',
  'F.INV',
  'F.TEST',
  'PERCENTILE',
  'PERCENTILE.INC',
  'PERCENTILE.EXC',
  'QUARTILE',
  'QUARTILE.INC',
  'QUARTILE.EXC',
  'LARGE',
  'SMALL',
  'SKEW',
  'SKEW.P',
  'CONFIDENCE',
  'CONFIDENCE.NORM',
  'CONFIDENCE.T',
  'AVERAGEIF',
  'SUMIF',
  'SUMIFS',
  'COUNTIF',
  'COUNTIFS',
  'GEOMEAN',
  'HARMEAN',
  'RSQ',
  // --- v2: math (scientific) ---
  'MROUND',
  'CEILING',
  'CEILING.MATH',
  'FLOOR',
  'FLOOR.MATH',
  'FACT',
  'FACTDOUBLE',
  'COMBIN',
  'GCD',
  'LCM',
  'SERIESSUM',
  'SUMPRODUCT',
  'SUBTOTAL',
  'BASE',
  'DECIMAL',
  'ROMAN',
  'ARABIC',
  // --- v2: lookup / reference ---
  'VLOOKUP',
  'HLOOKUP',
  'CHOOSE',
  'COLUMNS',
  'ROWS',
  'ADDRESS',
  'TRANSPOSE',
  'FILTER',
  'SEQUENCE',
  // --- v2: text ---
  'LEFT',
  'RIGHT',
  'MID',
  'LEN',
  'FIND',
  'SEARCH',
  'REPLACE',
  'SUBSTITUTE',
  'UPPER',
  'LOWER',
  'PROPER',
  'TRIM',
  'CLEAN',
  'CONCATENATE',
  'TEXTJOIN',
  'TEXT',
  'VALUE',
  'REPT',
  // --- v2: date / time ---
  'DATEDIF',
  'DATEVALUE',
  'TIMEVALUE',
  'NETWORKDAYS',
  'WORKDAY',
  'EOMONTH',
  'EDATE',
  'WEEKDAY',
  'WEEKNUM',
  'ISOWEEKNUM',
  // --- v2: logical ---
  'TRUE',
  'FALSE',
  'XOR',
  'SWITCH',
  // --- v2: information ---
  'ISLOGICAL',
  'ISNONTEXT',
  'ISODD',
  'ISEVEN',
  'ISREF',
  'N',
] as const)

export type SheetbaseDateTime = {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')
const validDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** Profile-owned parser: no Date string parsing, locale, or local timezone. */
export function sheetbaseParseDateTimeV1(
  value: string,
): SheetbaseDateTime | undefined {
  const match =
    /^(?:(\d{4})-(\d{2})-(\d{2})(?:[ T])?)?(?:(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(
      value,
    )
  if (!match || (!match[1] && !match[4])) return undefined
  const year = match[1] ? Number(match[1]) : 1899
  const month = match[2] ? Number(match[2]) : 12
  const day = match[3] ? Number(match[3]) : 30
  // RegExpExecArray does not model optional capture groups accurately.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hours = Number(match[4] ?? 0)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const minutes = Number(match[5] ?? 0)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const seconds = Number(match[6] ?? 0) + Number(`0.${match[7] || 0}`)
  if (
    !validDate(year, month, day) ||
    hours > 23 ||
    minutes > 59 ||
    seconds >= 60
  )
    return undefined
  return { year, month, day, hours, minutes, seconds }
}

export function sheetbaseStringifyDateTimeV1(
  value: SheetbaseDateTime,
  format: string,
): string | undefined {
  if (!validDate(value.year, value.month, value.day)) return undefined
  const milliseconds = Math.round((value.seconds % 1) * 1000)
  const replacements: Record<string, string> = {
    YYYY: pad(value.year, 4),
    MM: pad(value.month),
    DD: pad(value.day),
    hh: pad(value.hours),
    mm: pad(value.minutes),
    ss: pad(Math.trunc(value.seconds)),
    sss: pad(milliseconds, 3),
  }
  return format.replace(
    /YYYY|MM|DD|hh|mm|sss|ss/g,
    (token) => replacements[token],
  )
}

export function sheetbaseStringifyDurationV1(
  value: Pick<SheetbaseDateTime, 'hours' | 'minutes' | 'seconds'>,
): string {
  return `${pad(value.hours)}:${pad(value.minutes)}:${pad(Math.trunc(value.seconds))}.${pad(Math.round((value.seconds % 1) * 1000), 3)}`
}

function canonical(value: unknown): string {
  if (typeof value === 'function') return value.name
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
function hash(value: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++)
    h = Math.imul(h ^ value.charCodeAt(i), 0x01000193)
  return `fnv1a32-${(h >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * Semantic identity of the calculation model that produces results: the
 * profile labels, the sorted function list, the literal/datetime conventions
 * and the date epoch. Recorded per calculation result via
 * SHEETBASE_PROFILE_FINGERPRINT / sheetbaseRuntimeFingerprint().
 */
const semanticProfile = {
  syntax: SHEETBASE_HF_PROFILE,
  functions: SHEETBASE_FUNCTION_PROFILE,
  engine: 'sheetbase-table-1',
  functionList: [...SCIENTIFIC_CORE_FUNCTIONS].sort(),
  literalProfile: SHEETBASE_LITERAL_PROFILE,
  datetimeCodec: 'sheetbase-datetime-v1',
  nullDate: { year: 1899, month: 12, day: 30 },
}
export const SHEETBASE_PROFILE_FINGERPRINT = hash(canonical(semanticProfile))
export function sheetbaseRuntimeFingerprint() {
  const runtime =
    typeof process === 'undefined'
      ? { runtime: 'browser' }
      : {
          runtime: 'node',
          node: process.versions.node,
          icu: process.versions.icu,
          tz:
            process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
  return hash(canonical({ ...semanticProfile, runtime }))
}
