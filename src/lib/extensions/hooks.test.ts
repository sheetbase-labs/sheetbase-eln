/**
 * The hook points end to end: every sample plugin is a valid package, resolves
 * to its points, and (where Python is here) runs through the real worker.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  CELL_DISPLAY_FIXTURES,
  cellDisplayModel,
  parseCellDisplay,
} from './cell-display'
import { checkFieldTypeValue } from './hooks'
import { validateExtensionManifest } from './manifest'
import { buildPluginPackage } from './package'
import { resolveRunnerPoints } from './runner-points'
import { runExtensionHook } from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
import { PLUGIN_UI_SDK_NAME } from './package'
import { buildPluginFrame, PLUGIN_FRAME_CSP } from './ui-frame'
import {
  localPython,
  pythonAvailable,
  readExample,
} from './testing/local-python'
import { parseActionResult, parseScreenResult, sanitizeSvg } from './screens'
import { validatePluginBlock } from '../blocks/validators'

const EXAMPLES = [
  'dilution-block',
  'ui-counter',
  'cell-looks',
  'plate-tools',
] as const

describe('sample plugins', () => {
  for (const name of EXAMPLES) {
    it(`${name} is a valid package that Sheetbase accepts`, () => {
      const { manifest } = buildPluginPackage(readExample(name))
      expect(validateExtensionManifest(manifest)).toEqual([])
      const points = resolveRunnerPoints([
        {
          id: 'e',
          key: name,
          name,
          status: 'enabled',
          manifest,
          disabled_points: [],
        } as never,
      ])
      const total =
        points.blocks.length +
        points.panels.length +
        points.tableCells.length +
        points.columns.length +
        points.rowActions.length +
        points.fieldTypes.length
      expect(total).toBeGreaterThan(0)
    })
  }

  it('a switched-off point resolves to nothing', () => {
    const { manifest } = buildPluginPackage(readExample('plate-tools'))
    const points = resolveRunnerPoints([
      {
        id: 'e',
        key: 'plate-tools',
        name: 'x',
        status: 'enabled',
        manifest,
        disabled_points: ['columns'],
      } as never,
    ])
    expect(points.columns).toHaveLength(0)
    expect(points.rowActions).toHaveLength(2)
  })
})

describe('cell displays', () => {
  it.each(CELL_DISPLAY_FIXTURES.map((f, i) => [i, f] as const))(
    'fixture %i shows what it says',
    (_i, fixture) => {
      expect(cellDisplayModel(fixture.spec, fixture.value)).toEqual(
        fixture.expect,
      )
    },
  )

  it('refuses a display that carries code or unknown keys', () => {
    const errors: string[] = []
    expect(
      parseCellDisplay({ kind: 'text', onClick: 'x()' }, 'cell', errors),
    ).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(parseCellDisplay({ kind: 'script' }, 'cell', [])).toBeNull()
  })
})

describe('screens', () => {
  it('accepts a small screen and refuses unknown parts', () => {
    expect(
      parseScreenResult({
        view: { type: 'stack', children: [{ type: 'heading', text: 'Hi' }] },
      }).ok,
    ).toBe(true)
    expect(
      parseScreenResult({ view: { type: 'iframe', src: 'https://x' } }).ok,
    ).toBe(false)
    expect(
      parseScreenResult({ view: { type: 'text', text: 'a' }, evil: 1 }).ok,
    ).toBe(false)
  })

  it('keeps only allowed svg', () => {
    expect(
      sanitizeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'),
    ).toContain('<path')
    expect(sanitizeSvg('<svg onload="x()"></svg>')).toBeNull()
    expect(sanitizeSvg('<svg><script>x()</script></svg>')).toBeNull()
    expect(
      sanitizeSvg('<svg><image href="https://example.com/a.png"/></svg>'),
    ).toBeNull()
  })

  it('limits what an action can download', () => {
    expect(
      parseActionResult({
        download: { filename: 'a.csv', mime: 'text/csv', text: 'a,b' },
      }).ok,
    ).toBe(true)
    expect(
      parseActionResult({
        download: {
          filename: 'a.exe',
          mime: 'application/x-msdownload',
          text: 'x',
        },
      }).ok,
    ).toBe(false)
  })
})

describe('field types', () => {
  const batch = {
    id: 'batch-code',
    title: 'Batch code',
    base: 'text' as const,
    pattern: '^[A-Z]{2}-[0-9]{4}$',
    patternMessage: 'Use AB-0042.',
  }
  it('checks text and numbers against the declared rules', () => {
    expect(checkFieldTypeValue(batch, 'AB-0042')).toBeNull()
    expect(checkFieldTypeValue(batch, 'ab-42')).toBe('Use AB-0042.')
    expect(checkFieldTypeValue(batch, '')).toBeNull()
    const whole = {
      id: 'n',
      title: 'N',
      base: 'integer' as const,
      min: 1,
      max: 5,
    }
    expect(checkFieldTypeValue(whole, '3')).toBeNull()
    expect(checkFieldTypeValue(whole, '3.5')).toMatch(/whole/)
    expect(checkFieldTypeValue(whole, '9')).toMatch(/5 or less/)
  })
})

describe('the plugin block', () => {
  it('needs an installed plugin key and a block id', () => {
    expect(
      validatePluginBlock({ plugin: 'dilution', block: 'dilution' }),
    ).toEqual([])
    expect(validatePluginBlock({ plugin: 'Bad Key', block: 'x' })).not.toEqual(
      [],
    )
    expect(validatePluginBlock({ plugin: 'a' })).not.toEqual([])
  })
})

describe('the sandboxed frame', () => {
  const sdk = readFileSync(
    path.resolve(__dirname, '../../../sdks/plugin-ui/sheetbase-ui.js'),
    'utf8',
  )
  const files = readExample('ui-counter')

  it('inlines the page and the SDK, and allows no network', () => {
    const html = buildPluginFrame(files, 'ui/counter.html', sdk) ?? ''
    expect(html).toContain('window.sheetbase')
    expect(html).not.toContain(`src="${PLUGIN_UI_SDK_NAME}"`)
    expect(PLUGIN_FRAME_CSP).toContain("default-src 'none'")
    expect(PLUGIN_FRAME_CSP).toContain("connect-src 'none'")
  })

  it('has nothing for an entry that is not in the package', () => {
    expect(buildPluginFrame(files, 'ui/missing.html', sdk)).toBeNull()
  })
})

describe.skipIf(!pythonAvailable)('running the hooks', () => {
  function setup(name: (typeof EXAMPLES)[number]) {
    const files = readExample(name)
    const { manifest } = buildPluginPackage(files)
    const audit = vi.fn(async () => undefined)
    const deps: ExtensionRuntimeDeps = {
      loadInstall: async () => ({
        id: 'e1',
        key: name,
        name,
        status: 'enabled',
        manifest: manifest as never,
        disabledPoints: [],
      }),
      loadPackage: async () => files,
      executePython: localPython,
      audit,
      now: () => 0,
    }
    return {
      deps,
      audit,
      base: { workspaceId: 'w', actorUserId: 'u', extensionKey: name },
    }
  }

  it('draws a block screen and keeps its state', async () => {
    const { deps, audit, base } = setup('dilution-block')
    const out = await runExtensionHook(
      {
        ...base,
        kind: 'screen',
        point: 'blocks',
        itemId: 'dilution',
        context: {},
        state: null,
        event: {
          action: 'work',
          values: { stock: 10, target: 1, volume: 50 },
        },
      },
      deps,
    )
    expect(out.kind).toBe('screen')
    if (out.kind === 'screen') {
      expect(out.state).toEqual({ stock: 10, target: 1, volume: 50 })
      expect(JSON.stringify(out.view)).toContain('Stock to add')
      expect(JSON.stringify(out.view)).toContain('5')
    }
    expect(audit).toHaveBeenCalled()
  })

  it('draws a panel screen', async () => {
    const { deps, base } = setup('dilution-block')
    const out = await runExtensionHook(
      {
        ...base,
        kind: 'screen',
        point: 'panels',
        itemId: 'summary',
        context: { kind: 'sample' },
        state: null,
        event: null,
      },
      deps,
    )
    expect(JSON.stringify(out)).toContain('sample')
  })

  it('works out a computed column, one value per row', async () => {
    const { deps, base } = setup('plate-tools')
    const out = await runExtensionHook(
      {
        ...base,
        kind: 'column',
        itemId: 'grade',
        rows: [
          { viability: 95 },
          { viability: 75 },
          { viability: 10 },
          { viability: null },
        ],
      },
      deps,
    )
    expect(out.kind === 'column' && out.values).toEqual([
      'Pass',
      'Retest',
      'Fail',
      null,
    ])
  })

  it('runs a column action and a row action, and refuses two rows for a one-row action', async () => {
    const { deps, base } = setup('plate-tools')
    const summary = await runExtensionHook(
      {
        ...base,
        kind: 'column-action',
        itemId: 'grade',
        actionId: 'summary',
        rows: [{ viability: 95 }, { viability: 96 }],
      },
      deps,
    )
    expect(JSON.stringify(summary)).toContain('Pass')
    const exported = await runExtensionHook(
      {
        ...base,
        kind: 'row-action',
        itemId: 'export',
        rows: [{ title: 'A', viability: 1 }],
      },
      deps,
    )
    expect(exported.kind === 'action' && exported.download?.filename).toBe(
      'chosen-rows.csv',
    )
    await expect(
      runExtensionHook(
        {
          ...base,
          kind: 'row-action',
          itemId: 'inspect',
          rows: [{ title: 'A' }, { title: 'B' }],
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'bad_input' })
  })

  it('refuses a column that answers the wrong number of values', async () => {
    const { deps, base } = setup('plate-tools')
    const wrong = {
      ...deps,
      loadPackage: async () => ({
        ...readExample('plate-tools'),
        'python/grading.py': 'def grade(rows):\n    return ["Pass"]\n',
      }),
    }
    await expect(
      runExtensionHook(
        {
          ...base,
          kind: 'column',
          itemId: 'grade',
          rows: [{ viability: 1 }, { viability: 2 }],
        },
        wrong,
      ),
    ).rejects.toMatchObject({ code: 'bad_answer' })
  })
})
