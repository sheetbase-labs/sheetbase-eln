/**
 * Plugin screens: the points that are whole pages, widgets and report sections,
 * the two ways existing points take a UI bundle (a cell renderer, a field
 * input), the frame that serves a bundle, and the SDK inside it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

import { parseFieldTypes, parseTableCells } from './hooks'
import { parseExtensionManifest, validateExtensionManifest } from './manifest'
import type { ExtensionContributions } from './manifest'
import { buildPluginPackage } from './package'
import { EXTENSION_SWITCH_POINTS } from './points'
import { describeRunnerAdds, resolveRunnerPoints } from './runner-points'
import { readExample } from './testing/local-python'
import { buildPluginFrame, PLUGIN_FRAME_CSP } from './ui-frame'
import {
  EXTENSION_UI_POINTS,
  frameEntryOf,
  isFramePoint,
  parseUiPoint,
} from './ui-points'

const sdk = readFileSync(
  path.resolve(__dirname, '../../../sdks/plugin-ui/sheetbase-ui.js'),
  'utf8',
)

const manifest = (contributions: ExtensionContributions) => ({
  id: 'acme.screens',
  name: 'Screens',
  version: '1.0.0',
  source: 'package:acme.screens',
  capabilities: [],
  scopes: ['projects:read'],
  contributions,
})

describe('screens a plugin draws itself', () => {
  it('every UI point has an administrator switch', () => {
    for (const point of EXTENSION_UI_POINTS)
      expect(EXTENSION_SWITCH_POINTS).toContain(point)
  })

  it('accepts a page, a settings page, a wide widget and a report section', () => {
    const errors = validateExtensionManifest(
      manifest({
        pages: [
          { id: 'lib', title: 'Library', icon: 'flask', ui: 'ui/a.html' },
        ],
        'settings-pages': [{ id: 's', title: 'Setup', ui: 'ui/b.html' }],
        'dashboard-widgets': [
          { id: 'w', title: 'Today', size: 'wide', ui: 'ui/c.html' },
        ],
        'report-sections': [{ id: 'r', title: 'Summary', ui: 'ui/d.html' }],
      }),
    )

    expect(errors).toEqual([])
  })

  it.each([
    ['no ui', { id: 'p', title: 'P' }, /ui must be an \.html file/],
    ['a script as ui', { id: 'p', title: 'P', ui: 'ui/a.js' }, /\.html file/],
    [
      'an unknown setting',
      { id: 'p', title: 'P', ui: 'ui/a.html', run: 'x:y' },
      /unknown setting: run/,
    ],
    [
      'a bad icon',
      { id: 'p', title: 'P', icon: 'No Way', ui: 'ui/a.html' },
      /icon/,
    ],
    [
      'a size on a page',
      { id: 'p', title: 'P', size: 'wide', ui: 'ui/a.html' },
      /unknown setting: size/,
    ],
  ])('refuses %s', (_name, entry, message) => {
    const errors: string[] = []
    expect(parseUiPoint('pages', [entry], errors)).toBeNull()
    expect(errors.join()).toMatch(message)
  })

  it('refuses a widget size other than normal or wide', () => {
    const errors: string[] = []
    expect(
      parseUiPoint(
        'dashboard-widgets',
        [{ id: 'w', title: 'W', size: 'huge', ui: 'ui/a.html' }],
        errors,
      ),
    ).toBeNull()
    expect(errors.join()).toMatch(/normal or wide/)
  })

  it('refuses a duplicate id', () => {
    const errors: string[] = []
    const entry = { id: 'p', title: 'P', ui: 'ui/a.html' }
    expect(parseUiPoint('pages', [entry, entry], errors)).toBeNull()
    expect(errors.join()).toMatch(/duplicate/)
  })

  it.each([null, 7, 'pages', {}, [null], [[]], [true]])(
    'rejects malformed contribution lists: %j',
    (value) => {
      const errors: string[] = []
      expect(parseUiPoint('pages', value, errors)).toBeNull()
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatch(/must be a list|entries must be objects/)
    },
  )

  it.each([
    { id: 7, title: 'Page', ui: 'ui/a.html' },
    { id: 'page', title: [], ui: 'ui/a.html' },
    { id: 'page', title: 'Page', ui: 'ui/a.html', description: null },
    { id: 'page', title: 'Page', ui: 'ui/a.html', icon: {} },
    { id: 'page', title: 'Page', ui: false },
  ])('rejects malformed declaration fields: %j', (entry) => {
    const errors: string[] = []
    expect(parseUiPoint('pages', [entry], errors)).toBeNull()
    expect(errors).toHaveLength(1)
  })

  it('rejects unknown JSON keys even when an object parser would omit them', () => {
    const errors: string[] = []

    const entry = JSON.parse(
      '{"id":"p","title":"Page","ui":"ui/a.html","__proto__":{}}',
    )

    expect(parseUiPoint('pages', [entry], errors)).toBeNull()
    expect(errors).toEqual([
      'contributions.pages.p has an unknown setting: __proto__',
    ])
  })

  it('resolves the points of an enabled plugin, and nothing for one switched off', () => {
    const m = manifest({
      pages: [{ id: 'lib', title: 'Library', ui: 'ui/a.html' }],
      'dashboard-widgets': [{ id: 'w', title: 'Today', ui: 'ui/c.html' }],
    })

    const install = {
      id: 'e',
      key: 'tools',
      name: 'Tools',
      status: 'enabled',
      manifest: m,
      disabled_points: [],
    }

    const on = resolveRunnerPoints([install])
    expect(on.pages.map((p) => p.id)).toEqual(['lib'])
    expect(on.dashboardWidgets.map((p) => p.id)).toEqual(['w'])

    const off = resolveRunnerPoints([
      { ...install, disabled_points: ['pages'] },
    ])

    expect(off.pages).toEqual([])
    expect(off.dashboardWidgets).toHaveLength(1)
    expect(
      describeRunnerAdds(m).map((a) => [a.point, a.items.map((i) => i.detail)]),
    ).toEqual([
      ['pages', ['page']],
      ['dashboard-widgets', ['widget']],
    ])
  })

  it('keeps the declarations through the manifest parser', () => {
    const parsed = parseExtensionManifest(
      manifest({
        'report-sections': [{ id: 'r', title: ' Summary ', ui: 'ui/d.html' }],
      }),
    )

    expect(parsed.contributions['report-sections']).toEqual([
      { id: 'r', title: 'Summary', ui: 'ui/d.html' },
    ])
  })
})

describe('cell renderers and field inputs', () => {
  it('a table cell takes a display or a render, never both or neither', () => {
    const base = { id: 'c', title: 'C', appliesTo: { fields: ['a'] } }
    const ok: string[] = []
    expect(
      parseTableCells([{ ...base, render: 'ui/cells.html' }], ok),
    ).not.toBeNull()

    for (const entry of [
      { ...base },
      { ...base, display: { kind: 'text' }, render: 'ui/cells.html' },
      { ...base, render: 'ui/cells.js' },
    ]) {
      const errors: string[] = []
      expect(parseTableCells([entry], errors)).toBeNull()
      expect(errors.length).toBeGreaterThan(0)
    }
  })

  it('a field type can bring its own input', () => {
    const base = { id: 'dna', title: 'DNA', base: 'text' }
    expect(
      parseFieldTypes([{ ...base, input: 'ui/input.html' }], [])?.[0].input,
    ).toBe('ui/input.html')
    const errors: string[] = []
    expect(parseFieldTypes([{ ...base, input: 'x.html' }], errors)).toBeNull()
    expect(errors.join()).toMatch(/input must be an \.html/)
  })

  it('finds the entry file of each framed point', () => {
    expect(isFramePoint('table-cells')).toBe(true)
    expect(isFramePoint('operations')).toBe(false)
    expect(frameEntryOf('table-cells', { render: 'ui/c.html' })).toBe(
      'ui/c.html',
    )
    expect(frameEntryOf('field-types', { input: 'ui/i.html' })).toBe(
      'ui/i.html',
    )
    expect(frameEntryOf('pages', { ui: 'ui/p.html' })).toBe('ui/p.html')
    expect(frameEntryOf('pages', { id: 'x' })).toBeUndefined()
  })
})

describe('the frame for a bundle', () => {
  const files = {
    'ui/a.html':
      '<html><head><link rel="stylesheet" href="a.css"></head><body><div id="app"></div><script type="module" src="a.js"></script></body></html>',
    'ui/a.js': 'document.title = "</script>"; export {}',
    'ui/a.css': 'body{color:red}',
  }

  it('keeps a module a module, and cannot be broken out of by its own text', () => {
    const html = buildPluginFrame(files, 'ui/a.html', sdk) ?? ''
    expect(html).toContain('<script type="module">')
    expect(html).toContain('<style>body{color:red}</style>')
    expect(html).not.toContain('src="a.js"')
    expect(html.match(/<\/script>/g)).toHaveLength(2) // the SDK's and the bundle's
  })

  it('leaves a string in the bundle that looks like an attribute alone', () => {
    const library = {
      ...files,
      'ui/a.js':
        'const link = \'<a href="x.png">\'; const img = \'src="y.png"\'; export {}',
    }

    const html = buildPluginFrame(library, 'ui/a.html', sdk) ?? ''
    expect(html).toContain('<a href="x.png">')
    expect(html).toContain('src="y.png"')
  })

  it('allows what libraries need, and still no network', () => {
    expect(PLUGIN_FRAME_CSP).toContain("default-src 'none'")
    expect(PLUGIN_FRAME_CSP).toMatch(/script-src[^;]*'wasm-unsafe-eval'/)
    expect(PLUGIN_FRAME_CSP).toMatch(/script-src[^;]*blob:/)
    expect(PLUGIN_FRAME_CSP).toMatch(/worker-src blob:/)
    expect(PLUGIN_FRAME_CSP).toMatch(/connect-src data: blob:(;|$)/)
    expect(PLUGIN_FRAME_CSP).not.toMatch(/https?:|\*/)
    // The frame is still an opaque origin: no cookies, storage or parent access.
    expect(PLUGIN_FRAME_CSP).toContain('sandbox allow-scripts')
    expect(PLUGIN_FRAME_CSP).not.toContain('allow-same-origin')
  })
})

describe('the SDK inside the frame', () => {
  /** A table cell the frame is asked to render, and one it answers with. */
  interface SdkCell {
    key: number
    value?: string
    text?: string
  }

  /** A message the SDK posts up to the app; it stamps `sb` on each one. */
  type FrameMessage =
    | {
        sb?: number
        type: 'call'
        id: string
        operation: string
        input: unknown
      }
    | { sb?: number; type: 'rendered'; id: string; cells: SdkCell[] }
    | { sb?: number; type: 'emit'; name: string; payload: unknown }
    | { sb?: number; type: 'navigate'; path: string }
    | { sb?: number; type: 'resize'; height: number }

  /** A message the app sends down to the frame. */
  type FrameInput =
    | { type: 'result'; id: string; ok: true; output: unknown }
    | { type: 'result'; id: string; ok: false; error: string }
    | { type: 'render'; id: string; cells: SdkCell[] }

  /** The SDK surface the frame's bundle uses (`sdks/plugin-ui/sheetbase-ui.js`). */
  interface SheetbaseSdk {
    fetch: (
      url: string,
      init?: { method?: string; body?: string },
    ) => Promise<Response>
    onRender: (fn: (cells: SdkCell[]) => SdkCell[]) => void
    setValue: (value: string) => void
    setSection: (section: { title: string; text: string }) => void
    navigate: (path: string) => void
  }

  interface ParentWindow {
    postMessage: (message: FrameMessage) => void
  }

  /** The frame's stand-in window: what the bundle attaches itself to. */
  interface FrameWindow {
    parent: ParentWindow
    addEventListener: (
      name: string,
      fn: (event: {
        source: ParentWindow
        data: FrameInput & { sb: number }
      }) => void,
    ) => void
    fetch: (
      url: string,
      init?: { method?: string; body?: string },
    ) => Promise<Response>
    ResizeObserver: undefined
    window?: FrameWindow
    sheetbase?: SheetbaseSdk
  }

  /** The SDK the bundle attached, which it does before the run returns. */
  function sdkOf(window: FrameWindow): SheetbaseSdk {
    if (!window.sheetbase) throw new Error('The bundle attached no SDK.')

    return window.sheetbase
  }

  /** Runs the SDK against a stand-in window and returns it with what it posted up. */
  function load() {
    const posted: FrameMessage[] = []

    const handlers: Array<
      (event: {
        source: ParentWindow
        data: FrameInput & { sb: number }
      }) => void
    > = []

    const parent: ParentWindow = {
      postMessage: (message) => posted.push(message),
    }

    const window: FrameWindow = {
      parent,
      addEventListener: (name, fn) => {
        if (name === 'message') handlers.push(fn)
      },
      fetch: () => Promise.reject(new TypeError('network')),
      ResizeObserver: undefined,
    }

    window.window = window

    const document = {
      documentElement: {
        setAttribute: () => undefined,
        style: { setProperty: () => undefined },
        getBoundingClientRect: () => ({ height: 10 }),
      },
    }

    vm.runInNewContext(sdk, {
      window,
      document,
      Response,
      URL,
      Promise,
      Object,
      Math,
      String,
      JSON,
      TypeError,
    })

    const fromParent = (data: FrameInput) =>
      handlers.forEach((fn) => fn({ source: parent, data: { sb: 1, ...data } }))

    return { window, posted, fromParent }
  }

  it('fetch reaches only the plugin’s own operations, as a call', async () => {
    const { window, posted, fromParent } = load()

    const sheetbase = sdkOf(window)

    const answer = sheetbase.fetch('/operations/analyse', {
      method: 'POST',
      body: JSON.stringify({ sequence: 'ATGC' }),
    })

    const call = posted.find((m) => m.type === 'call')!
    expect(call).toMatchObject({
      operation: 'analyse',
      input: { sequence: 'ATGC' },
    })
    fromParent({ type: 'result', id: call.id, ok: true, output: { gc: 50 } })
    const response = await answer
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ gc: 50 })
  })

  it('answers a failed call with an error status, and any other address with 404', async () => {
    const { window, posted, fromParent } = load()

    const sheetbase = sdkOf(window)

    const failed = sheetbase.fetch('/operations/analyse', { body: '{}' })
    const call = posted.find((m) => m.type === 'call')!
    fromParent({ type: 'result', id: call.id, ok: false, error: 'Nope.' })
    const bad = await failed
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Nope.' })

    const other = await sheetbase.fetch('https://example.com/data')
    expect(other.status).toBe(404)
    expect(posted.filter((m) => m.type === 'call')).toHaveLength(1)
  })

  it('the global fetch uses the same door, and the network stays shut', async () => {
    const { window, posted, fromParent } = load()
    const fetch = window.fetch

    const answer = fetch('/operations/analyse', {
      method: 'POST',
      body: '{"sequence":"AC"}',
    })

    const call = posted.find((m) => m.type === 'call')!
    fromParent({ type: 'result', id: call.id, ok: true, output: { gc: 50 } })
    expect((await answer).status).toBe(200)
    await expect(fetch('https://example.com/x')).rejects.toThrow()
  })

  it('a renderer is asked for cells and answers by key', async () => {
    const { window, posted, fromParent } = load()

    const sheetbase = sdkOf(window)

    sheetbase.onRender((cells) =>
      cells.map((c) => ({ key: c.key, text: String(c.value) })),
    )
    fromParent({ type: 'render', id: 'r1', cells: [{ key: 0, value: 'ATG' }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posted.find((m) => m.type === 'rendered')).toEqual({
      sb: 1,
      type: 'rendered',
      id: 'r1',
      cells: [{ key: 0, text: 'ATG' }],
    })
  })

  it('setValue, setSection and navigate go up as messages', () => {
    const { window, posted } = load()
    const sheetbase = sdkOf(window)
    sheetbase.setValue('ATGC')
    sheetbase.setSection({ title: 'T', text: 'x' })
    sheetbase.navigate('/experiments')
    expect(posted).toEqual([
      { sb: 1, type: 'emit', name: 'value', payload: 'ATGC' },
      {
        sb: 1,
        type: 'emit',
        name: 'section',
        payload: { title: 'T', text: 'x' },
      },
      { sb: 1, type: 'navigate', path: '/experiments' },
    ])
  })
})

describe('the sequence-tools sample', () => {
  it('is a valid package that uses every kind of screen', () => {
    const { manifest: built } = buildPluginPackage(
      readExample('sequence-tools'),
    )

    expect(validateExtensionManifest(built)).toEqual([])
    const c = built.contributions
    expect(c.blocks).toHaveLength(1)
    expect(c.pages).toHaveLength(1)
    expect(c['settings-pages']).toHaveLength(1)
    expect(c['dashboard-widgets']).toHaveLength(1)
    expect(c['report-sections']).toHaveLength(1)
    expect(c['table-cells']?.[0].render).toBe('ui/cells.html')
    expect(c['field-types']?.[0].input).toBe('ui/input.html')
  })
})
