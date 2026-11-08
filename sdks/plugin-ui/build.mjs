/**
 * Builds a plugin's screens.
 *
 * You write each screen as a small HTML file in `ui-src/` that points at a
 * TypeScript (or JavaScript) module, and import whatever npm libraries you
 * like. This bundles each module, and everything it imports, into one plain
 * script, and writes the files a `.sbplugin` package holds into `ui/`:
 *
 *   ui-src/map.html            <script type="module" src="./map.ts"></script>
 *   ui-src/map.ts              import { arc } from 'd3-shape' ...
 *     ->  ui/map.html, ui/map.js (and ui/map.css when the module imports CSS)
 *
 * Images, fonts and WebAssembly that a module imports are embedded in the
 * script (data URLs and bytes), because a screen cannot load files at run
 * time. Sheetbase adds its own SDK to the page when it serves it, so the page
 * does not include it.
 *
 * The result is the same on every run for the same input (no timestamps), so
 * the built files can be committed and compared.
 */
import { build } from 'esbuild'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SCRIPT_RE =
  /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>|<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\btype\s*=\s*["']module["'][^>]*>\s*<\/script>/gi

/**
 * @param {object} options
 * @param {string} options.dir the plugin folder (holds plugin.json and ui-src/)
 * @param {string} [options.src] the source folder, default `ui-src`
 * @param {string} [options.out] the output folder, default `ui`
 * @param {string[]} [options.nodePaths] extra places to look for npm packages
 * @param {boolean} [options.minify] default true
 * @returns {Promise<string[]>} the files written, relative to `dir`
 */
export async function buildPluginUi({
  dir,
  src = 'ui-src',
  out = 'ui',
  nodePaths = [],
  minify = true,
}) {
  const srcDir = path.resolve(dir, src)
  const outDir = path.resolve(dir, out)
  const entries = (await readdir(srcDir)).filter((f) => f.endsWith('.html'))
  if (entries.length === 0) throw new Error(`No .html screens in ${srcDir}`)
  // `ui/` belongs to this tool: it is emptied and written again, so a screen
  // removed from `ui-src/` is gone from the package too.
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const written = []
  for (const entry of entries.sort()) {
    const name = entry.replace(/\.html$/, '')
    const html = await readFile(path.join(srcDir, entry), 'utf8')
    const modules = [...html.matchAll(SCRIPT_RE)].map((m) => m[1] ?? m[2])
    if (modules.length === 0) {
      throw new Error(
        `${entry} needs a <script type="module" src="./something.ts"></script>`,
      )
    }
    let output = html.replace(SCRIPT_RE, '')
    const scripts = []
    const styles = []
    for (const [index, mod] of modules.entries()) {
      const suffix = modules.length > 1 ? `-${index + 1}` : ''
      const result = await build({
        entryPoints: [path.resolve(srcDir, mod)],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        platform: 'browser',
        minify,
        legalComments: 'none',
        nodePaths: nodePaths.map((p) => path.resolve(p)),
        outdir: path.join(outDir, name + suffix),
        loader: {
          '.png': 'dataurl',
          '.jpg': 'dataurl',
          '.jpeg': 'dataurl',
          '.gif': 'dataurl',
          '.webp': 'dataurl',
          '.svg': 'dataurl',
          '.woff': 'dataurl',
          '.woff2': 'dataurl',
          '.ttf': 'dataurl',
          '.wasm': 'binary',
        },
        logLevel: 'silent',
      })
      for (const file of result.outputFiles) {
        const text = file.text.replace(/\n$/, '\n')
        if (file.path.endsWith('.js')) {
          const js = `${name}${suffix}.js`
          await writeFile(path.join(outDir, js), text)
          written.push(js)
          scripts.push(js)
        } else if (file.path.endsWith('.css')) {
          const css = `${name}${suffix}.css`
          await writeFile(path.join(outDir, css), text)
          written.push(css)
          styles.push(css)
        }
      }
    }
    output = output.replace(
      /<\/head>/i,
      `${styles.map((c) => `  <link rel="stylesheet" href="${c}">\n`).join('')}</head>`,
    )
    const tags = scripts.map((s) => `<script src="${s}"></script>\n`).join('')
    output = /<\/body>/i.test(output)
      ? output.replace(/<\/body>/i, `${tags}</body>`)
      : output + tags
    await writeFile(path.join(outDir, entry), output)
    written.push(entry)
  }
  return written.sort()
}
