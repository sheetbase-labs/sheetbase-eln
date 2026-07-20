import { AlwaysSparse, HyperFormula } from 'hyperformula'
import enUS from 'hyperformula/i18n/languages/enUS'
import type { ConfigParams } from 'hyperformula'

export const SHEETBASE_HF_PROFILE = 'sheetbase-hf-en-us-v1' as const
export const SHEETBASE_FUNCTION_PROFILE = 'scientific-core-v1' as const
export const SHEETBASE_HF_VERSION = '3.3.0' as const

export const SCIENTIFIC_CORE_FUNCTIONS = Object.freeze([
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
  'IF',
  'IFS',
  'AND',
  'OR',
  'NOT',
  'IFERROR',
  'IFNA',
  'NA',
  'ISBLANK',
  'ISERROR',
  'ISNA',
  'ISNUMBER',
  'ISTEXT',
  'INDEX',
  'MATCH',
  'XLOOKUP',
  'DATE',
  'TIME',
  'YEAR',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
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
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
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

let registered = false
function registerAndAssert() {
  if (!registered) {
    try {
      HyperFormula.registerLanguage('enUS', enUS)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.name.includes('LanguageAlreadyRegistered')
      )
        throw error
    }
    registered = true
  }
  for (const id of SCIENTIFIC_CORE_FUNCTIONS) {
    if (!HyperFormula.getFunctionPlugin(id))
      throw new Error(`HyperFormula 3.3.0 is missing required function ${id}`)
  }
}
registerAndAssert()

// `context` is intentionally impossible to provide in this profile.
export const SHEETBASE_HF_CONFIG: Readonly<Omit<ConfigParams, 'context'>> =
  deepFreeze({
    licenseKey: 'gpl-v3',
    language: 'enUS',
    localeLang: 'en-US',
    decimalSeparator: '.',
    thousandSeparator: '',
    functionArgSeparator: ',',
    arrayColumnSeparator: ',',
    arrayRowSeparator: ';',
    currencySymbol: [],
    ignoreWhiteSpace: 'standard',
    dateFormats: ['YYYY-MM-DD'],
    timeFormats: ['hh:mm', 'hh:mm:ss.sss'],
    nullDate: { year: 1899, month: 12, day: 30 },
    nullYear: 30,
    leapYear1900: false,
    evaluateNullToZero: false,
    useArrayArithmetic: false,
    precisionEpsilon: 1e-13,
    precisionRounding: 10,
    smartRounding: true,
    caseSensitive: false,
    accentSensitive: false,
    caseFirst: 'lower',
    ignorePunctuation: false,
    matchWholeCell: true,
    useRegularExpressions: false,
    useWildcards: false,
    maxRows: 10_000,
    maxColumns: 256,
    functionPlugins: [],
    undoLimit: 0,
    useColumnIndex: false,
    useStats: false,
    maxPendingLazyTransformations: 50,
    chooseAddressMappingPolicy: new AlwaysSparse(),
    parseDateTime: sheetbaseParseDateTimeV1,
    stringifyDateTime: sheetbaseStringifyDateTimeV1,
    stringifyDuration: sheetbaseStringifyDurationV1,
  })

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
export const SHEETBASE_FUNCTION_MAP = Object.freeze(
  Object.fromEntries(
    [...SCIENTIFIC_CORE_FUNCTIONS]
      .sort()
      .map((id) => [id, HyperFormula.getFunctionPlugin(id)?.name]),
  ),
)
const semanticProfile = {
  syntax: SHEETBASE_HF_PROFILE,
  functions: SHEETBASE_FUNCTION_PROFILE,
  hyperFormula: SHEETBASE_HF_VERSION,
  config: SHEETBASE_HF_CONFIG,
  functionMap: SHEETBASE_FUNCTION_MAP,
  language: enUS,
  codecSource: 'sheetbase-datetime-v1',
  addressMapping: 'AlwaysSparse',
  context: 'absent',
}
export const SHEETBASE_PROFILE_FINGERPRINT = hash(canonical(semanticProfile))
export function sheetbaseRuntimeFingerprint() {
  const runtime =
    typeof process === 'undefined'
      ? { runtime: 'browser', userAgent: navigator.userAgent }
      : {
          runtime: 'node',
          node: process.versions.node,
          v8: process.versions.v8,
          icu: process.versions.icu,
          tz:
            process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
  return hash(canonical({ ...semanticProfile, runtime }))
}

export function createSheetbaseHyperFormula() {
  registerAndAssert()
  return HyperFormula.buildEmpty(SHEETBASE_HF_CONFIG)
}
