/**
 * Fail on a date or time formatted by hand.
 *
 * Every date the app shows is written one way, through `#/lib/format-date`
 * (`formatDate`, `formatDay`, `formatMonth`, `formatTime`, `formatRange`,
 * `formatAgo`), so it reads "25 Sep 2026" or "09:40" on the person's own zone
 * and clock wherever it appears. This check finds the ways round it:
 *
 * - `toLocaleDateString()` and `toLocaleTimeString()`;
 * - `toLocaleString()` with date options, or on a `new Date(…)`;
 * - `Intl.DateTimeFormat` with display options (a bare zone check is fine);
 * - an ISO string cut up for display (`.slice(0, 16).replace('T', ' ')`,
 *   `.slice(11, 16)`, `.slice(5, 10)`);
 * - a date built from its parts in a template (`${d.getUTCDate()} ${month}`);
 * - `formatInstant` called directly rather than through a named formatter.
 *
 * A machine format that is not for reading (a file name, a zone offset sum)
 * takes `// date-format-ignore-next-line -- <why>` on the line above.
 *
 * Run with `pnpm check:dates` (part of `pnpm check`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Modules that are the formatters, or do time zone arithmetic with Intl. */
const ALLOWLIST = new Set([
  // The formatters themselves.
  'src/lib/format-date.ts',
  'src/lib/list-date.ts',
  'src/lib/display-time-zone.ts',
  'src/lib/intl-cache.ts',
  // Wall-clock arithmetic: reads a zone's date parts to convert instants.
  'src/lib/assistant-booking.ts',
  'src/lib/scheduler/plan.ts',
  'src/lib/calendar.ts',
  'src/lib/planner.ts',
  'src/lib/pipeline-schedule.ts',
  'src/components/schedule/booking-time.ts',
])

const DISPLAY_KEYS = new Set([
  'year',
  'month',
  'day',
  'weekday',
  'hour',
  'minute',
  'second',
  'dateStyle',
  'timeStyle',
  'era',
  'dayPeriod',
])

const PART_GETTERS = new Set([
  'getDate',
  'getUTCDate',
  'getMonth',
  'getUTCMonth',
  'getFullYear',
  'getUTCFullYear',
  'getHours',
  'getUTCHours',
  'getMinutes',
  'getUTCMinutes',
])

const SLICES = new Set(['11,16', '5,10', '5,16', '11,19'])

function files(dir: string): Array<string> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) return files(path)

    return /\.(ts|tsx)$/.test(name) &&
      !/\.(test|spec|stories)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
      ? [relative(ROOT, path)]
      : []
  })
}

function hasDisplayKeys(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false

  return node.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      DISPLAY_KEYS.has(p.name.getText().replace(/['"]/g, '')),
  )
}

function isNewDate(node: ts.Expression): boolean {
  let inner: ts.Expression = node

  while (ts.isParenthesizedExpression(inner)) inner = inner.expression

  return ts.isNewExpression(inner) && inner.expression.getText() === 'Date'
}

function callsPartGetter(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    PART_GETTERS.has(node.expression.name.text)
  )
    return true

  return ts.forEachChild(node, callsPartGetter) ?? false
}

function numberArgs(call: ts.CallExpression): string {
  return call.arguments.map((a) => a.getText().replace(/\s/g, '')).join(',')
}

interface Finding {
  line: number
  rule: string
}

function scan(file: string): Array<Finding> {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const lines = source.split('\n')

  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const found: Array<Finding> = []

  const add = (node: ts.Node, rule: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
    const above = line > 0 ? lines[line - 1] : ''

    if (above.includes('date-format-ignore-next-line')) return
    found.push({ line: line + 1, rule })
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const name = node.expression.name.text
      const receiver = node.expression.expression

      if (name === 'toLocaleDateString' || name === 'toLocaleTimeString')
        add(node, name)
      else if (
        name === 'toLocaleString' &&
        (hasDisplayKeys(node.arguments[1]) || isNewDate(receiver))
      )
        add(node, 'toLocaleString on a date')
      else if (name === 'slice' && SLICES.has(numberArgs(node)))
        add(node, 'ISO string sliced for display')
      else if (
        name === 'replace' &&
        node.arguments[0]?.getText() === "'T'" &&
        ts.isCallExpression(receiver) &&
        ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === 'slice'
      )
        add(node, 'ISO string sliced for display')
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'formatInstant'
    )
      add(node, 'formatInstant called directly')

    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      node.expression.getText() === 'Intl.DateTimeFormat' &&
      hasDisplayKeys(node.arguments?.[1])
    )
      add(node, 'Intl.DateTimeFormat')

    if (ts.isTemplateExpression(node)) {
      const parts = node.templateSpans.filter((span) =>
        callsPartGetter(span.expression),
      )

      // A key like `${y}-${m}` joins numbers with dashes; a date for reading
      // spells words or a month name out.
      const forReading =
        node.templateSpans.some((span) => span.literal.text.startsWith(' ')) ||
        node.templateSpans.some((span) =>
          /\bMONTHS?\w*\[/.test(span.expression.getText()),
        )

      if (parts.length > 0 && forReading) add(node, 'date built from its parts')
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)

  return found
}

const findings: Array<Finding & { file: string }> = []

for (const file of files(SRC)) {
  if (ALLOWLIST.has(file)) continue

  if (file.startsWith('src/db/seed/')) continue

  for (const finding of scan(file)) findings.push({ file, ...finding })
}

if (findings.length > 0) {
  console.error(
    'Dates formatted by hand (use formatDate, formatDay, formatTime, formatRange or formatAgo from #/lib/format-date):\n',
  )

  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`)
  console.error(`\n${findings.length} found.`)
  process.exit(1)
}

console.log('check:dates: every date goes through the shared formatter.')
