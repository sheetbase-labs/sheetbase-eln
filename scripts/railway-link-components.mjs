/**
 * Point the four private @sheetbase-labs packages at a local checkout of
 * sheetbase-components, so an image can build without a GitHub Packages token.
 *
 * Usage: node scripts/railway-link-components.mjs <components-packages-dir>
 *
 * Rewrites package.json and pnpm-lock.yaml in place: each dependency becomes a
 * `link:` to the checkout and the registry package and snapshot blocks are
 * dropped. The release-age exclusions for these packages are removed from
 * pnpm-workspace.yaml, because pnpm would otherwise query the registry for them. Only used by Dockerfile.railway; never run it in a working tree
 * you intend to commit.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const packagesDir = process.argv[2]
if (!packagesDir) {
  process.stderr.write('usage: railway-link-components.mjs <packages-dir>\n')
  process.exit(1)
}

const names = ['advanced-search', 'explorer', 'shared', 'table']
const link = (name) => `link:${packagesDir}/${name}`

let manifest = readFileSync('package.json', 'utf8')
let lockfile = readFileSync('pnpm-lock.yaml', 'utf8')

for (const name of names) {
  const pattern = new RegExp(`("@sheetbase-labs/sheetbase-${name}": )"[^"]+"`)
  if (!pattern.test(manifest)) throw new Error(`package.json lacks ${name}`)
  manifest = manifest.replace(pattern, `$1"${link(name)}"`)

  const importer = new RegExp(
    `(      '@sheetbase-labs/sheetbase-${name}':\\n        specifier: )[^\\n]+\\n        version: [^\\n]+\\n`,
  )
  if (!importer.test(lockfile)) throw new Error(`pnpm-lock.yaml lacks ${name}`)
  lockfile = lockfile.replace(
    importer,
    `$1${link(name)}\n        version: ${link(name)}\n`,
  )
}

lockfile = lockfile.replace(
  /\n  '@sheetbase-labs\/[^\n]*:\n(?:    [^\n]*\n|      [^\n]*\n)*/g,
  '\n',
)

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
  .split('\n')
  .filter((line) => !line.includes('@sheetbase-labs/'))
  .join('\n')

writeFileSync('pnpm-workspace.yaml', workspace)
writeFileSync('package.json', manifest)
writeFileSync('pnpm-lock.yaml', lockfile)
