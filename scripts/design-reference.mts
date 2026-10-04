/**
 * Renders every UI system v3 design screen to a reference PNG (Roadmap 4,
 * DSYS-01). The images are the baselines that route parity tests compare the
 * application against, so they must be reproducible:
 *
 *   - screens come from the vendored snapshot in
 *     docs/knowledge/design/ui-system-v3/canvas;
 *   - the canvas runtime is the vendored runtime/dc-runtime.js, served as the
 *     `support.js` each screen loads;
 *   - Google Fonts requests are answered from the same @fontsource packages
 *     the application ships, so no network is used.
 *
 * Usage:
 *   pnpm design:render                 # all screens, light and dark
 *   pnpm design:render Main Notebook   # named screens only
 *
 * Writes tests/visual/design-reference/<Screen>-<theme>.png (gitignored).
 * Uses the lockfile-pinned Playwright Chromium, exactly as the parity project.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const DESIGN = resolve('docs/knowledge/design/ui-system-v3')
const CANVAS = join(DESIGN, 'canvas')
const OUT = resolve('tests/visual/design-reference')
const THEMES = ['light', 'dark'] as const

const FONTS = [
  { family: 'Inter', pkg: 'inter' },
  { family: 'Instrument Sans', pkg: 'instrument-sans' },
  { family: 'JetBrains Mono', pkg: 'jetbrains-mono' },
]

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

interface Board {
  w: number
  h: number
}

/** Maps a request path onto the vendored snapshot, or null if outside it. */
function resolveAsset(pathname: string): string | null {
  const path = decodeURIComponent(pathname)
  if (path === '/support.js') return join(DESIGN, 'runtime', 'dc-runtime.js')
  if (path.startsWith('/ds/sheetbase/components/')) {
    return join(DESIGN, 'design-system', 'components', path.slice(25))
  }
  if (path.startsWith('/fonts/')) {
    const [, , pkg, ...rest] = path.split('/')
    if (!FONTS.some((font) => font.pkg === pkg)) return null
    return join(
      resolve('node_modules/@fontsource-variable'),
      pkg,
      'files',
      rest.join('/'),
    )
  }
  const file = normalize(join(CANVAS, path))
  return file.startsWith(CANVAS + sep) ? file : null
}

/**
 * Rewrites @fontsource CSS to the family names and URLs the screens use.
 *
 * The CSS is fulfilled for `https://fonts.googleapis.com/**`, so the font URLs
 * must be absolute: a root-relative `/fonts/...` would resolve against the
 * stylesheet's own origin (`fonts.googleapis.com`) and be answered by the
 * wildcard route with this same CSS instead of a `font/woff2` body, which makes
 * every face fail to decode and the screens silently fall back to a system
 * font.
 */
async function fontCss(base: string): Promise<string> {
  const parts = await Promise.all(
    FONTS.map(async ({ family, pkg }) => {
      const css = await readFile(
        resolve('node_modules/@fontsource-variable', pkg, 'index.css'),
        'utf8',
      )
      return css
        .replace(/font-family: '[^']+';/g, `font-family: '${family}';`)
        .replace(/url\(\.\/files\//g, `url(${base}/fonts/${pkg}/`)
    }),
  )
  return parts.join('\n')
}

async function main() {
  const canvas = JSON.parse(
    await readFile(join(CANVAS, 'canvas.json'), 'utf8'),
  ) as { boards: Record<string, Board> }
  const wanted = new Set(process.argv.slice(2))
  const boards = Object.entries(canvas.boards)
    .map(([file, board]) => ({ name: file.replace(/\.dc\.html$/, ''), board }))
    .filter(({ name }) => wanted.size === 0 || wanted.has(name))
  if (boards.length === 0) throw new Error('No matching design screens')

  const server = createServer((req, res) => {
    const file = resolveAsset(new URL(req.url ?? '/', 'http://x').pathname)
    if (!file) {
      res.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        })
        res.end(body)
      },
      () => res.writeHead(404).end(),
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const fonts = await fontCss(base)

  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  let failures = 0
  try {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        colorScheme: theme,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        locale: 'en-GB',
        timezoneId: 'Europe/London',
      })
      await context.addInitScript((value) => {
        // The application reads `sheetbase-theme` (src/components/v3/lib/theme.ts,
        // `THEME_STORAGE_KEY`); the vendored design snapshot's component runtime
        // reads `sheetbase.theme` and resolves the canvas `data-theme` from it.
        // Seed both so the reference states the same appearance the app does.
        localStorage.setItem('sheetbase-theme', value)
        localStorage.setItem('sheetbase.theme', value)
      }, theme)
      await context.route('https://fonts.googleapis.com/**', (route) =>
        route.fulfill({ contentType: 'text/css', body: fonts }),
      )
      await context.route('https://fonts.gstatic.com/**', (route) =>
        route.abort(),
      )
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))

      for (const { name, board } of boards) {
        errors.length = 0
        await page.setViewportSize({ width: board.w, height: board.h })
        await page.goto(`${base}/${name}.dc.html`, { waitUntil: 'networkidle' })
        await page.evaluate(() => document.fonts.ready)
        const fontFaults = await page.evaluate(() => {
          const faults: string[] = []
          for (const face of document.fonts) {
            if (face.status === 'error') {
              faults.push(`${face.family} ${face.weight} failed`)
            }
          }
          // Every screen renders Latin text, so the synthesised `Inter` face
          // must be usable; a `false` here means the screens fell back.
          if (!document.fonts.check("16px 'Inter'")) {
            faults.push('Inter is not loaded')
          }
          return faults
        })
        errors.push(...fontFaults)
        await page.waitForTimeout(250)
        await page.screenshot({
          path: join(OUT, `${name}-${theme}.png`),
          clip: { x: 0, y: 0, width: board.w, height: board.h },
          animations: 'disabled',
        })
        if (name === 'States') {
          // COMP-05 compares the installed filter package with this design
          // border box, using the same 360 × 126 crop as COMP-04's fixture.
          // Derive it from the reference, never from the app output.
          await page.screenshot({
            path: join(OUT, `States-filter-builder-${theme}.png`),
            clip: { x: 557, y: 1089, width: 360, height: 126 },
            animations: 'disabled',
          })
        }
        if (errors.length > 0) {
          failures += 1
          console.error(`${name} (${theme}): ${errors.join('; ')}`)
        }
      }
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
  console.log(
    `Rendered ${boards.length} screens × ${THEMES.length} themes to ${OUT}`,
  )
  if (failures > 0) process.exitCode = 1
}

await main()
