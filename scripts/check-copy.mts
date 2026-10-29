/**
 * Fail on text typed straight into components instead of read from the copy
 * catalogue (`src/copy`, see docs/development/copy.md).
 *
 * Checks `.tsx` files under src/components and src/routes for JSX text,
 * text in the attributes people read (`title`, `aria-label`, `placeholder`,
 * `label`, `alt`, ...), text in object properties such as `label:` and
 * `description:`, and text passed to `toast`. Files still waiting to
 * move into the catalogue are listed in scripts/copy-pending.txt and skipped;
 * that list only shrinks. A line that must stay literal (a unit symbol in a
 * sentence, a code sample) goes after a `copy-ignore-next-line` comment.
 *
 *   pnpm check:copy            check
 *   pnpm check:copy --update   drop files that are now clean from the list
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const PENDING_FILE = join(ROOT, 'scripts/copy-pending.txt')
const SCANNED = ['src/components', 'src/routes']

/** Not product UI: third-party sources and developer-only pages. */
const IGNORED = [
  /^src\/components\/reui\//,
  /^src\/components\/component-compare\//,
  /^src\/components\/dev-toolbar\//,
  /^src\/routes\/foundations\.tsx$/,
  /^src\/routes\/-sheetbase-components-page\.tsx$/,
  /^src\/routes\/component-compare/,
]

const ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'aria-description',
  'placeholder',
  'label',
  'alt',
  'description',
  'tooltip',
  'hint',
  'heading',
  'emptyText',
  'emptyTitle',
  'emptyDescription',
  'confirmLabel',
  'cancelLabel',
  'actionLabel',
  'submitLabel',
])

/** Object properties that hold text, as in a list of menu items or columns. */
const PROPERTIES = new Set([
  'label',
  'title',
  'description',
  'placeholder',
  'hint',
  'tooltip',
  'heading',
  'emptyText',
  'emptyTitle',
  'emptyDescription',
  'message',
])

const TOAST = new Set(['toast', 'success', 'error', 'warning', 'info'])

/** Text a person reads: two letters in a row, and not a class list or id. */
function isProse(text: string): boolean {
  const value = text.trim()
  if (!/[A-Za-z]{2}/.test(value)) return false
  if (/^[a-z][a-zA-Z0-9]*$/.test(value)) return false
  if (/^[a-z0-9_.\-/:#@[\]]+$/.test(value)) return false
  if (/^(https?:|\/|#|var\(|calc\()/.test(value)) return false
  return true
}

function files(dir: string): Array<string> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx$/.test(name) && !/\.(test|spec|stories)\.tsx$/.test(name)
      ? [relative(ROOT, path)]
      : []
  })
}

interface Finding {
  line: number
  text: string
}

function scan(file: string): Array<Finding> {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const lines = source.split('\n')
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const found: Array<Finding> = []
  const add = (node: ts.Node, text: string) => {
    if (!isProse(text)) return
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
    if (line > 0 && lines[line - 1].includes('copy-ignore-next-line')) return
    found.push({ line: line + 1, text: text.replace(/\s+/g, ' ').trim() })
  }
  const literal = (node: ts.Node | undefined): string | null => {
    if (!node) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return node.text
    if (ts.isTemplateExpression(node)) {
      return (
        node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ')
      )
    }
    return null
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text)
    else if (
      ts.isJsxAttribute(node) &&
      ATTRIBUTES.has(node.name.getText(sf)) &&
      node.initializer
    ) {
      const init = node.initializer
      const text = ts.isStringLiteral(init)
        ? init.text
        : ts.isJsxExpression(init)
          ? literal(init.expression)
          : null
      if (text !== null) add(node, text)
    } else if (
      ts.isPropertyAssignment(node) &&
      PROPERTIES.has(node.name.getText(sf).replace(/['"]/g, ''))
    ) {
      const text = literal(node.initializer)
      if (text !== null) add(node, text)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === 'toast'
          ? callee.name.text
          : ''
      const text = TOAST.has(name) ? literal(node.arguments[0]) : null
      if (text !== null) add(node, text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const pending = new Set(
  readFileSync(PENDING_FILE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
)
const update = process.argv.includes('--update')

const all = SCANNED.flatMap((dir) => files(join(ROOT, dir))).filter(
  (file) => !IGNORED.some((pattern) => pattern.test(file)),
)
const failures: Array<string> = []
const nowClean: Array<string> = []
for (const file of all) {
  const found = scan(file)
  if (pending.has(file)) {
    if (found.length === 0) nowClean.push(file)
    continue
  }
  for (const f of found)
    failures.push(`${file}:${f.line}  ${f.text.slice(0, 80)}`)
}
const missing = [...pending].filter((file) => !all.includes(file))

if (update) {
  const keep = [...pending]
    .filter((f) => !nowClean.includes(f) && !missing.includes(f))
    .sort()
  const header = readFileSync(PENDING_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('#'))
  writeFileSync(PENDING_FILE, [...header, ...keep, ''].join('\n'))
  console.log(
    `copy-pending.txt: ${keep.length} files left (${nowClean.length + missing.length} removed)`,
  )
} else if (nowClean.length || missing.length) {
  failures.push(
    ...[...nowClean, ...missing].map(
      (file) =>
        `${file}  is clean or gone; run pnpm check:copy --update to drop it from the pending list`,
    ),
  )
}

if (failures.length) {
  console.error(
    `Text outside the copy catalogue (docs/development/copy.md):\n${failures.join('\n')}`,
  )
  process.exit(1)
}
console.log(
  `check:copy ok: ${all.length - pending.size} files clean, ${pending.size} pending`,
)
