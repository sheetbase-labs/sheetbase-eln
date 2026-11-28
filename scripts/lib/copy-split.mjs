/**
 * Ships each part of the copy catalogue with the code that shows it.
 *
 * The catalogue (src/copy/en) holds every piece of text in the app, about
 * 900 kB of source. Left alone it is one module that every screen imports,
 * so a first visit downloads the wording of every screen. In the browser
 * build this plugin splits it by section, the first two parts of a key
 * (`notebook.sign`, `features.plateRuns`): a module that names a key, or a
 * prefix of one, in a string imports that section, and the bundler places
 * each section beside the screens that use it. `common` stays whole.
 *
 * The server keeps the whole catalogue, so a page renders the same text on
 * both sides. A key is only found when its first two parts are written out
 * in the module that names it; `src/copy/copy-split.test.ts` checks that
 * every key in the source is written that way.
 */
import { resolve } from 'node:path'

import { runnerImport } from 'vite'

const VIRTUAL = 'virtual:sheetbase-copy/'
const RESOLVED = `\0${VIRTUAL}`
const KEY_START = /['"`]([a-zA-Z]+)\.([a-zA-Z0-9_]+)(?![a-zA-Z0-9_])/g
const SCRIPT = /\.[cm]?[jt]sx?$/

/**
 * The catalogue sections a module names: every string that starts with a
 * section's two parts, whole or as the prefix of a longer key.
 *
 * @param {string} code
 * @param {{ has: (name: string) => boolean }} known
 * @returns {Set<string>}
 */
export function sectionsIn(code, known) {
  const used = new Set()

  for (const match of code.matchAll(KEY_START)) {
    const name = `${match[1]}.${match[2]}`

    if (known.has(name)) used.add(name)
  }

  return used
}

/** Splits the catalogue in the browser build only. */
export function copySplit() {
  const root = resolve('src')
  const catalogueIndex = resolve('src/copy/en/index.ts')
  const copyDir = resolve('src/copy')
  /** @type {Map<string, unknown>} */
  const sections = new Map()
  /** @type {unknown} */
  let common = {}

  return {
    name: 'sheetbase:copy-split',
    apply: 'build',
    /** @param {{ name: string }} environment */
    applyToEnvironment(environment) {
      return environment.name === 'client'
    },
    async buildStart() {
      const { module } = await runnerImport(catalogueIndex)

      sections.clear()

      for (const [namespace, tree] of Object.entries(module.en)) {
        if (namespace === 'common') {
          common = tree
          continue
        }

        for (const [section, value] of Object.entries(tree))
          sections.set(`${namespace}.${section}`, value)
      }
    },
    /** @param {string} id */
    resolveId(id) {
      return id.startsWith(VIRTUAL) ? `\0${id}` : null
    },
    /** @param {string} id */
    load(id) {
      // The browser's catalogue starts with `common`; sections join it as
      // the modules that use them load.
      if (id === catalogueIndex)
        return `export const en = { common: ${JSON.stringify(common)} }`

      if (!id.startsWith(RESOLVED)) return null
      const name = id.slice(RESOLVED.length)
      const [namespace, section] = name.split('.')

      return [
        `import { en } from ${JSON.stringify(catalogueIndex)}`,
        `const area = en[${JSON.stringify(namespace)}] || (en[${JSON.stringify(namespace)}] = {})`,
        `area[${JSON.stringify(section)}] = ${JSON.stringify(sections.get(name))}`,
      ].join('\n')
    },
    /**
     * @param {string} code
     * @param {string} id
     */
    transform(code, id) {
      const file = id.split('?')[0]

      if (!file.startsWith(root) || file.startsWith(copyDir)) return null

      if (!SCRIPT.test(file) || file.endsWith('copy.gen.ts')) return null
      const used = sectionsIn(code, sections)

      if (used.size === 0) return null

      // Imports are hoisted, so adding them at the end still runs them
      // first, and leaves every position in the file where it was.
      const imports = [...used]
        .map((name) => `import ${JSON.stringify(VIRTUAL + name)}`)
        .join(';')

      return { code: `${code}\n;${imports}`, map: null }
    },
  }
}
