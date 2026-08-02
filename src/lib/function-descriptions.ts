import { SCIENTIFIC_CORE_FUNCTIONS } from '#/lib/hyperformula-profile'

export const FUNCTION_DESCRIPTIONS: Readonly<Record<string, string>> =
  Object.freeze({
    // Aggregation and core statistics
    SUM: 'Sum all numeric arguments',
    PRODUCT: 'Multiply all numeric arguments',
    SUMSQ: 'Sum the squares of numeric arguments',
    AVERAGE: 'Arithmetic mean of numeric values',
    MEDIAN: 'Median of numeric values',
    MIN: 'Smallest numeric value',
    MAX: 'Largest numeric value',
    COUNT: 'Count cells containing numbers',
    COUNTA: 'Count non-empty cells',
    'STDEV.S': 'Sample standard deviation',
    'STDEV.P': 'Population standard deviation',
    'VAR.S': 'Sample variance',
    'VAR.P': 'Population variance',

    // Numeric and scientific
    ABS: 'Absolute value of a number',
    SIGN: 'Sign of a number',
    MOD: 'Remainder after division',
    POWER: 'Raise a number to a power',
    SQRT: 'Positive square root',
    EXP: 'Euler’s number raised to a power',
    LN: 'Natural logarithm',
    LOG: 'Logarithm with a specified base',
    LOG10: 'Base-10 logarithm',
    ROUND: 'Round to a specified number of digits',
    ROUNDDOWN: 'Round toward zero',
    ROUNDUP: 'Round away from zero',
    INT: 'Round down to the nearest integer',
    PI: 'Value of pi',
    SIN: 'Sine of an angle in radians',
    COS: 'Cosine of an angle in radians',
    TAN: 'Tangent of an angle in radians',
    ASIN: 'Inverse sine in radians',
    ACOS: 'Inverse cosine in radians',
    ATAN: 'Inverse tangent in radians',
    ATAN2: 'Angle from x and y coordinates',
    DEGREES: 'Convert radians to degrees',
    RADIANS: 'Convert degrees to radians',

    // Logical and error handling
    IF: 'Conditional branching',
    IFS: 'Return a result for the first true condition',
    AND: 'Test whether all conditions are true',
    OR: 'Test whether any condition is true',
    NOT: 'Reverse a logical value',
    IFERROR: 'Return a fallback when a formula errors',
    IFNA: 'Return a fallback for an N/A error',
    NA: 'Return the N/A error value',

    // Inspection and lookup
    ISBLANK: 'Test whether a value is blank',
    ISERROR: 'Test whether a value is an error',
    ISNA: 'Test whether a value is an N/A error',
    ISNUMBER: 'Test whether a value is numeric',
    ISTEXT: 'Test whether a value is text',
    INDEX: 'Return a value at a range position',
    MATCH: 'Find a value’s position in a range',
    XLOOKUP: 'Look up a value and return a corresponding match',

    // Date and time construction and parts
    DATE: 'Create a date from year, month, and day',
    TIME: 'Create a time from hour, minute, and second',
    YEAR: 'Extract the year from a date',
    MONTH: 'Extract the month from a date',
    DAY: 'Extract the day from a date',
    HOUR: 'Extract the hour from a time',
    MINUTE: 'Extract the minute from a time',
    SECOND: 'Extract the second from a time',

    // Statistical analysis and distributions
    STDEV: 'Sample standard deviation (legacy)',
    STDEVA: 'Sample standard deviation including text and logic',
    STDEVP: 'Population standard deviation (legacy)',
    STDEVPA: 'Population standard deviation including text and logic',
    VAR: 'Sample variance (legacy)',
    VARA: 'Sample variance including text and logic',
    VARP: 'Population variance (legacy)',
    VARPA: 'Population variance including text and logic',
    'COVARIANCE.P': 'Population covariance',
    'COVARIANCE.S': 'Sample covariance',
    CORREL: 'Pearson correlation coefficient',
    PEARSON: 'Pearson product-moment correlation',
    'NORM.DIST': 'Normal distribution probability density',
    'NORM.INV': 'Inverse normal cumulative distribution',
    'NORM.S.DIST': 'Standard normal distribution',
    'NORM.S.INV': 'Inverse standard normal distribution',
    'T.DIST': 'Student’s t distribution',
    'T.DIST.2T': 'Two-tailed Student’s t distribution',
    'T.INV': 'Inverse Student’s t distribution',
    'T.INV.2T': 'Inverse two-tailed Student’s t distribution',
    'T.TEST': 'Probability from a Student’s t-test',
    'CHISQ.DIST': 'Chi-square distribution',
    'CHISQ.INV': 'Inverse chi-square distribution',
    'CHISQ.TEST': 'Chi-square test of independence',
    'F.DIST': 'F probability distribution',
    'F.INV': 'Inverse F probability distribution',
    'F.TEST': 'Probability from an F-test',
    PERCENTILE: 'Percentile including endpoints (legacy)',
    'PERCENTILE.INC': 'Percentile including endpoints',
    'PERCENTILE.EXC': 'Percentile excluding endpoints',
    QUARTILE: 'Quartile including endpoints (legacy)',
    'QUARTILE.INC': 'Quartile including endpoints',
    'QUARTILE.EXC': 'Quartile excluding endpoints',
    LARGE: 'Nth largest value in a data set',
    SMALL: 'Nth smallest value in a data set',
    SKEW: 'Sample distribution skewness',
    'SKEW.P': 'Population distribution skewness',
    CONFIDENCE: 'Normal confidence interval half-width (legacy)',
    'CONFIDENCE.NORM': 'Normal confidence interval half-width',
    'CONFIDENCE.T': 'Student’s t confidence interval half-width',
    AVERAGEIF: 'Mean of values matching a condition',
    SUMIF: 'Sum values matching a condition',
    SUMIFS: 'Sum values matching multiple conditions',
    COUNTIF: 'Count cells matching a condition',
    COUNTIFS: 'Count cells matching multiple conditions',
    GEOMEAN: 'Geometric mean of positive values',
    HARMEAN: 'Harmonic mean of positive values',
    RSQ: 'Square of the Pearson correlation coefficient',

    // Mathematics and number systems
    MROUND: 'Round to the nearest multiple',
    CEILING: 'Round up to the nearest multiple',
    'CEILING.MATH': 'Round up to a multiple with sign control',
    FLOOR: 'Round down to the nearest multiple',
    'FLOOR.MATH': 'Round down to a multiple with sign control',
    FACT: 'Factorial of a non-negative integer',
    FACTDOUBLE: 'Double factorial of an integer',
    COMBIN: 'Number of combinations without repetition',
    GCD: 'Greatest common divisor',
    LCM: 'Least common multiple',
    SERIESSUM: 'Sum a power series from supplied coefficients',
    SUMPRODUCT: 'Sum products of corresponding array values',
    SUBTOTAL: 'Aggregate visible values in a range',
    BASE: 'Convert a number to text in a given base',
    DECIMAL: 'Convert base-specific text to a decimal number',
    ROMAN: 'Convert an Arabic number to Roman numerals',
    ARABIC: 'Convert Roman numerals to an Arabic number',

    // Lookup and reference
    VLOOKUP: 'Look up a value in a table by column',
    HLOOKUP: 'Look up a value in a table by row',
    CHOOSE: 'Select a value by index',
    COLUMNS: 'Count columns in a range',
    ROWS: 'Count rows in a range',
    ADDRESS: 'Create a cell address as text',
    TRANSPOSE: 'Swap rows and columns in an array',
    FILTER: 'Return rows or columns matching criteria',
    SEQUENCE: 'Generate a sequence of numbers',

    // Text
    LEFT: 'Return characters from the start of text',
    RIGHT: 'Return characters from the end of text',
    MID: 'Return characters from within text',
    LEN: 'Count characters in text',
    FIND: 'Find case-sensitive text position',
    SEARCH: 'Find case-insensitive text position',
    REPLACE: 'Replace text at a specified position',
    SUBSTITUTE: 'Replace matching text',
    UPPER: 'Convert text to uppercase',
    LOWER: 'Convert text to lowercase',
    PROPER: 'Capitalize each word in text',
    TRIM: 'Remove extra spaces from text',
    CLEAN: 'Remove non-printable characters',
    CONCATENATE: 'Join text values together',
    TEXTJOIN: 'Join text with a delimiter',
    TEXT: 'Format a value as text',
    VALUE: 'Convert numeric text to a number',
    REPT: 'Repeat text a specified number of times',

    // Date and time calculations
    DATEDIF: 'Difference between two dates in chosen units',
    DATEVALUE: 'Convert date text to a date serial number',
    TIMEVALUE: 'Convert time text to a time serial number',
    NETWORKDAYS: 'Count working days between dates',
    WORKDAY: 'Shift a date by a number of working days',
    EOMONTH: 'Last day of a month offset from a date',
    EDATE: 'Shift a date by a number of months',
    WEEKDAY: 'Day-of-week number for a date',
    WEEKNUM: 'Week number for a date',
    ISOWEEKNUM: 'ISO week number for a date',

    // Additional logical functions
    TRUE: 'Logical true value',
    FALSE: 'Logical false value',
    XOR: 'Test whether an odd number of conditions are true',
    SWITCH: 'Match a value and return its corresponding result',

    // Information and conversion
    ISLOGICAL: 'Test whether a value is logical',
    ISNONTEXT: 'Test whether a value is not text',
    ISODD: 'Test whether a number is odd',
    ISEVEN: 'Test whether a number is even',
    ISREF: 'Test whether a value is a reference',
    N: 'Convert a value to a number',
  } as const)

const allowedFunctions = new Set<string>(SCIENTIFIC_CORE_FUNCTIONS)

for (const id of SCIENTIFIC_CORE_FUNCTIONS) {
  if (!Object.hasOwn(FUNCTION_DESCRIPTIONS, id)) {
    throw new Error(`Missing function description for ${id}`)
  }
}

for (const id of Object.keys(FUNCTION_DESCRIPTIONS)) {
  if (!allowedFunctions.has(id)) {
    throw new Error(`Description provided for unsupported function ${id}`)
  }
}

export interface FunctionSuggestion {
  id: string
  description: string
}

export function getFunctionSuggestions(
  prefix: string,
  limit = 8,
): FunctionSuggestion[] {
  const normalizedPrefix = prefix.toUpperCase()
  const normalizedLimit = Math.max(0, Math.floor(limit))

  return SCIENTIFIC_CORE_FUNCTIONS.filter(
    (id) =>
      id.startsWith(normalizedPrefix) &&
      Object.hasOwn(FUNCTION_DESCRIPTIONS, id),
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, normalizedLimit)
    .map((id) => ({ id, description: FUNCTION_DESCRIPTIONS[id] }))
}

/**
 * Characters that may precede a function name in a formula expression.
 * After any of these (or at the start of the formula), typing alphabetic
 * characters begins a potential function name token.
 */
const FUNCTION_NAME_TRIGGERS = new Set([
  '=',
  '(',
  ',',
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '<',
  '>',
  '%',
])

/**
 * Extract the partial function-name prefix being typed at `cursor` in `text`.
 * Returns the uppercased prefix (≥ 1 character) if the cursor is immediately
 * after a run of identifier characters ([A-Za-z0-9_.]) that starts at a valid
 * trigger position, or `null` otherwise.
 *
 * This is shared by the formula bar and in-cell editor autocomplete. It
 * deliberately does NOT match when the identifier run is already followed by
 * `(` (a completed call) or when it could be a cell reference (starts with a
 * letter followed by digits without a dot).
 */
export function extractFunctionPrefix(text: string, cursor: number): string | null {
  if (cursor < 0 || cursor > text.length) return null
  // Walk backwards from the cursor collecting identifier characters.
  const end = cursor
  let start = end
  while (start > 0) {
    const ch = text[start - 1]
    if (/[A-Za-z0-9_.]/.test(ch)) {
      start--
    } else {
      break
    }
  }
  const token = text.slice(start, end)
  if (token.length < 1) return null
  // Must start with a letter or underscore (not a digit).
  if (!/[A-Za-z_]/.test(token[0])) return null
  // Must contain at least one letter — a pure-numeric or ".5" token is not a
  // function name.
  if (!/[A-Za-z]/.test(token)) return null
  // The character before the token must be a trigger or whitespace after one.
  // Skip whitespace backwards to find the real preceding character.
  let p = start
  while (p > 0 && /\s/.test(text[p - 1])) p--
  if (p === 0) return null // formula must start with '='
  const preceding = text[p - 1]
  if (!FUNCTION_NAME_TRIGGERS.has(preceding)) return null
  // If the token is immediately followed by '(' it is already a complete call.
  if (cursor < text.length && text[cursor] === '(') return null
  return token.toUpperCase()
}
