/**
 * The server's formula profile.
 *
 * The server evaluates formulas with the `@sheetbase-labs/sheetbase-table`
 * engine (ADR-0048 option (b)). This module owns the *declared* profile: the
 * function allow-list the formula IR accepts and the persisted profile
 * identifiers the trusted SQL writer validates.
 *
 * The persisted identifiers are frozen. `api.formula_definitions`,
 * `internal.formula_result_cache` and `internal.sheet_instance_calculation_results`
 * carry CHECK constraints on these exact strings, and
 * `internal.apply_trusted_calculation` rejects any other profile fingerprint, so
 * changing them is a migration rather than a code change.
 */

/** Persisted syntax profile id. Frozen by the `chk_formula_profiles` constraint. */
export const SHEETBASE_SYNTAX_PROFILE = 'sheetbase-hf-en-us-v1' as const
/** Persisted function profile id. Frozen by the `chk_formula_profiles` constraint. */
export const SHEETBASE_FUNCTION_PROFILE = 'scientific-core-v2' as const
/**
 * Persisted engine identity. Frozen by the result-cache and sheet-calculation
 * profile constraints; it still records the engine that first produced the
 * stored values, not the engine now evaluating them.
 */
export const SHEETBASE_ENGINE_VERSION = '3.3.0' as const
/**
 * Persisted semantic profile fingerprint. Frozen because
 * `internal.apply_trusted_calculation` compares it literally; a new engine must
 * ship with a migration that moves the constraint and invalidates the cache.
 */
export const SHEETBASE_PROFILE_FINGERPRINT = 'fnv1a32-dcfa915f' as const

/** Engine that now evaluates formulas on the server. */
export const SHEETBASE_TABLE_ENGINE = '@sheetbase-labs/sheetbase-table' as const
export const SHEETBASE_TABLE_ENGINE_VERSION = '0.7.0' as const

/**
 * The closed function allow-list. A formula call outside this list persists as
 * `unsupported` and is never evaluated; the list also drives function
 * autocomplete. Every id is implemented by the `sheetbase-table` engine (or is
 * an engine special form: IF, IFERROR, ISERROR, TRUE, FALSE).
 */
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
 * Describes what produces a stored value: the declared profile, the package
 * engine, and the process runtime. It is recorded alongside every calculation.
 */
const semanticProfile = {
  syntax: SHEETBASE_SYNTAX_PROFILE,
  functions: SHEETBASE_FUNCTION_PROFILE,
  engine: `${SHEETBASE_TABLE_ENGINE}@${SHEETBASE_TABLE_ENGINE_VERSION}`,
  codec: 'sheetbase-scalar-v1',
  context: 'absent',
}

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
