/**
 * Print a hash of everything the design seed's output depends on, for the CI
 * cache of a seeded database (.github/workflows/ci.yml, browser journeys).
 *
 * Usage: node scripts/seed-inputs.mjs [--list]
 *
 * The inputs are:
 * - every source file the seed reaches through static imports, followed from
 *   src/db/seed/run.ts through `#/` and relative specifiers (packages are
 *   covered by the lockfile);
 * - the migrations and the runner that applies them;
 * - the database image and its role setup;
 * - the lockfile and the environment template CI runs with;
 * - the UTC date, because the seed moves the design timeline to today.
 *
 * A dynamic import with a computed specifier cannot be followed, so it fails
 * the script rather than leave an input out of the hash.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const ENTRY = 'src/db/seed/run.ts'

const FIXED = [
  'drizzle',
  'scripts/lib/migrations.mjs',
  'scripts/migrate-once.mjs',
  'docker/db',
  'compose.yaml',
  'pnpm-lock.yaml',
  '.env.example',
]

const EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.js',
  '/index.ts',
  '/index.tsx',
]

const SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

const COMPUTED_IMPORT = /import\s*\(\s*[^'"\s)]/

function resolveSpecifier(from, raw) {
  // Vite suffixes (`?raw`, `?url`) name the file itself as an input.
  const specifier = raw.replace(/\?.*$/, '')
  let base

  if (specifier.startsWith('#/')) base = join(root, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier)
  else return null

  for (const ext of EXTENSIONS) {
    const candidate = base + ext

    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }

  throw new Error(`cannot resolve ${specifier} from ${relative(root, from)}`)
}

function sourceGraph(entry) {
  const seen = new Set()
  const queue = [resolve(root, entry)]

  while (queue.length > 0) {
    const file = queue.pop()

    if (seen.has(file)) continue
    seen.add(file)

    // Non-code inputs (a `?raw` script) are hashed but have no imports.
    if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) continue

    const text = readFileSync(file, 'utf8')

    if (COMPUTED_IMPORT.test(text))
      throw new Error(`computed dynamic import in ${relative(root, file)}`)

    for (const match of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[1] ?? match[2] ?? match[3])

      if (target) queue.push(target)
    }
  }

  return [...seen]
}

function filesUnder(path) {
  const full = join(root, path)

  if (!statSync(full).isDirectory()) return [full]

  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

const files = [
  ...new Set([...sourceGraph(ENTRY), ...FIXED.flatMap(filesUnder)]),
]
  .map((file) => relative(root, file))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

if (process.argv.includes('--list')) {
  console.log(files.join('\n'))
  process.exit(0)
}

const hash = createHash('sha256')

hash.update(new Date().toISOString().slice(0, 10))

for (const file of files) {
  hash.update(`\0${file}\0`)
  hash.update(readFileSync(file))
}

console.log(hash.digest('hex'))
