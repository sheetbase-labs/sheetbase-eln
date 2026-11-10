/**
 * The hook points end to end: every sample plugin is a valid package, resolves
 * to its points, and (where Python is here) runs through the real worker.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  CELL_DISPLAY_FIXTURES,
  cellDisplayModel,
  parseCellDisplay,
  sparklineValues,
} from './cell-display'
import type { CellDisplaySpec } from './cell-display'
import {
  DATA_POINT_PARSERS,
  parseBarcodeFormats,
  parseEventHooks,
  parseExporters,
  parseSearchProviders,
} from './data-points'
import {
  checkFieldTypeValue,
  parseFieldTypes,
  parseColumns,
  parseBlocks,
  parsePanelDetails,
} from './hooks'
import { fieldsJsonSchema, parseOperations, parseAnalysisKinds } from './points'
import { validateExtensionManifest } from './manifest'
import { buildPluginPackage, PLUGIN_UI_SDK_NAME } from './package'
import { resolveRunnerPoints } from './runner-points'
import { runExtensionHook } from './runtime.server'
import type { ExtensionRuntimeDeps } from './runtime.server'
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
  'sequence-tools',
] as const

describe('data declaration boundaries', () => {
  it.each(Object.entries(DATA_POINT_PARSERS))(
    '%s rejects raw malformed lists and identities without a typed-input assumption',
    (point, parse) => {
      const errors: string[] = []
      expect(parse(null, errors)).toBeNull()
      expect(
        parse(
          Array.from({ length: 1001 }, () => ({})),
          errors,
        ),
      ).toBeNull()
      expect(parse([false], errors)).toBeNull()
      expect(parse([{ id: 1 }], errors)).toBeNull()
      expect(errors).toEqual([
        `contributions.${point} must be a list of at most 1000`,
        `contributions.${point} must be a list of at most 1000`,
        `contributions.${point} entries must be objects`,
        `contributions.${point} entry ids must match ^[a-z][a-z0-9-]{0,48}$`,
      ])
    },
  )

  it('keeps exporter error precedence and checked MIME/extension values', () => {
    const entry = {
      id: 'csv',
      title: 'CSV',
      description: 'Export readings',
      extension: '.csv',
      mime: 'text/csv',
      encoding: 'text',
      parameters: [],
      runner: { kind: 'python', entry: 'main:csv' },
    }

    const errors: string[] = []
    expect(
      parseExporters([{ ...entry, extension: 1, mime: false }], errors),
    ).toBeNull()
    expect(parseExporters([{ ...entry, mime: false }], errors)).toBeNull()
    expect(errors).toEqual([
      'contributions.exporters.csv extension must look like .fasta',
      'contributions.exporters.csv mime must look like text/plain',
    ])
    expect(parseExporters([entry], [])).toEqual([entry])
  })

  it('omits explicit false indexed and rejects nonboolean flags', () => {
    const entry = {
      id: 'find',
      title: 'Find',
      description: 'Find readings',
      types: ['sample'],
      runner: { kind: 'python', entry: 'main:find' },
    }

    expect(parseSearchProviders([{ ...entry, indexed: false }], [])).toEqual([
      entry,
    ])
    const errors: string[] = []
    expect(
      parseSearchProviders([{ ...entry, indexed: 'false' }], errors),
    ).toBeNull()
    expect(errors).toEqual([
      'contributions.search-providers.find indexed must be true or false',
    ])
  })

  it('keeps malformed event diagnostics and rejects repeated wire names', () => {
    const entry = {
      id: 'react',
      title: 'React',
      description: 'React to releases',
      runner: { kind: 'python', entry: 'main:react' },
    }

    const errors: string[] = []
    expect(parseEventHooks([{ ...entry, events: [] }], errors)).toBeNull()
    expect(parseEventHooks([{ ...entry, events: [{}] }], errors)).toBeNull()
    expect(
      parseEventHooks(
        [{ ...entry, events: ['sample.released', 'sample.released'] }],
        errors,
      ),
    ).toBeNull()
    expect(errors).toEqual([
      'contributions.event-hooks.react events needs 1-10 event names',
      'contributions.event-hooks.react names an unknown event: [object Object]',
      'contributions.event-hooks.react repeats the event sample.released',
    ])
    expect(
      parseEventHooks([{ ...entry, events: ['sample.released'] }], []),
    ).toEqual([{ ...entry, events: ['sample.released'] }])
  })
})

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
        },
      ])

      const total =
        points.blocks.length +
        points.panels.length +
        points.tableCells.length +
        points.columns.length +
        points.rowActions.length +
        points.fieldTypes.length +
        points.pages.length

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
      },
    ])

    expect(points.columns).toHaveLength(0)
    expect(points.rowActions).toHaveLength(2)
  })
})

describe('barcode declarations', () => {
  it('preserves the shape wire field and accepts only the supported dimensions', () => {
    const declaration = {
      id: 'code',
      title: 'Code',
      description: 'Draw a code',
      runner: { kind: 'python', entry: 'codes:draw' },
    }

    for (const dimension of ['1d', '2d']) {
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- The fixture must use the public barcode wire field `shape` to verify the parser preserves it.
      const entry = { ...declaration, shape: dimension }
      const errors: string[] = []
      expect(parseBarcodeFormats([entry], errors)).toEqual([entry])
      expect(errors).toEqual([])
    }

    const errors: string[] = []
    expect(
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- An invalid value of the same wire field must be rejected, not silently renamed or omitted.
      parseBarcodeFormats([{ ...declaration, shape: '3d' }], errors),
    ).toBeNull()
    expect(errors).toEqual([
      'contributions.barcode-formats.code shape must be 1d or 2d',
    ])
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

describe('native cell-display contracts', () => {
  it('keeps blank values empty and native Symbols, objects and Unicode visible', () => {
    for (const value of [null, undefined, ''])
      expect(cellDisplayModel({ kind: 'text', prefix: 'β' }, value)).toEqual({
        kind: 'empty',
      })
    expect(
      cellDisplayModel(
        { kind: 'text', prefix: 'ΔG ', suffix: ' µM', mono: true },
        Symbol('β'),
      ),
    ).toEqual({ kind: 'text', text: 'ΔG Symbol(β) µM', mono: true })
    expect(cellDisplayModel({ kind: 'text' }, {})).toEqual({
      kind: 'text',
      text: '[object Object]',
      mono: false,
    })
    expect(
      cellDisplayModel(
        { kind: 'svg' },
        { toString: () => '<svg><text>β</text></svg>' },
      ),
    ).toEqual({ kind: 'svg', svg: '<svg><text>β</text></svg>' })
  })

  it('coerces once before numeric parsing without coercing an object into a number', () => {
    let calls = 0

    const value = {
      toString: () => {
        calls += 1

        return '12.5 µM'
      },
      valueOf: () => {
        throw new Error('must not use numeric object coercion')
      },
    }

    expect(cellDisplayModel({ kind: 'number', decimals: 1 }, value)).toEqual({
      kind: 'text',
      text: '12.5 µM',
      mono: false,
    })
    expect(calls).toBe(1)
    expect(
      cellDisplayModel(
        { kind: 'number', decimals: 2, unit: 'µM', grouping: true },
        ' 1.2345e3 ',
      ),
    ).toEqual({ kind: 'text', text: '1,234.50 µM', mono: false })
    expect(
      sparklineValues([
        true,
        null,
        {},
        ' ',
        '-2e-3',
        0,
        '3.5',
        Infinity,
        NaN,
        Symbol('β'),
      ]),
    ).toEqual([-0.002, 0, 3.5])
    expect(sparklineValues('[-0.002, "3.5", false, null]')).toEqual([
      -0.002, 3.5,
    ])
    expect(sparklineValues(' -2e-3; 0, 3.5 ')).toEqual([-0.002, 0, 3.5])
  })

  it('propagates arbitrary coercion throws before every display-kind branch', () => {
    const thrown = { code: 'native-coercion', detail: 'β' }

    for (const spec of [
      { kind: 'text' },
      { kind: 'number' },
      { kind: 'badge', tones: {} },
      { kind: 'bar', max: 100 },
      { kind: 'sparkline' },
      { kind: 'svg' },
    ] satisfies CellDisplaySpec[]) {
      let caught = false
      let calls = 0

      try {
        cellDisplayModel(spec, {
          [Symbol.toPrimitive]: () => {
            calls += 1
            throw thrown
          },
        })
      } catch (error) {
        caught = true
        expect(error).toBe(thrown)
      }

      expect(caught).toBe(true)
      expect(calls).toBe(1)
    }
  })

  it('validates original badge-map keys and keeps stable ordered thresholds and optional omission', () => {
    const tones = Object.fromEntries([
      ['__proto__', 'warning'],
      ['β', 'success'],
    ])

    const labels = Object.fromEntries([
      ['__proto__', 'Proto'],
      ['β', 'Beta'],
    ])

    const badge = parseCellDisplay(
      { kind: 'badge', tones, labels, fallback: 'info' },
      'cell',
      [],
    )

    expect(badge).toEqual({ kind: 'badge', tones, labels, fallback: 'info' })

    if (!badge || badge.kind !== 'badge')
      throw new Error('Expected checked badge')
    expect(Object.hasOwn(badge.tones, '__proto__')).toBe(true)
    expect(cellDisplayModel(badge, '__proto__')).toEqual({
      kind: 'badge',
      text: 'Proto',
      tone: 'warning',
    })
    const errors: string[] = []
    expect(
      parseCellDisplay(
        { kind: 'badge', tones: Object.fromEntries([['__proto__', 'script']]) },
        'cell',
        errors,
      ),
    ).toBeNull()
    expect(errors).toEqual([
      'cell badge display needs tones: 1-24 values, each one of neutral, success, warning, danger, info',
    ])
    expect(
      parseCellDisplay(
        {
          kind: 'bar',
          min: -1,
          max: 2,
          showValue: false,
          thresholds: [
            { below: 1, tone: 'warning', extra: true },
            { below: 0, tone: 'danger' },
            { below: 1, tone: 'info' },
          ],
        },
        'cell',
        [],
      ),
    ).toEqual({
      kind: 'bar',
      min: -1,
      max: 2,
      showValue: false,
      thresholds: [
        { below: 0, tone: 'danger' },
        { below: 1, tone: 'warning' },
        { below: 1, tone: 'info' },
      ],
    })
    expect(
      parseCellDisplay(
        { kind: 'number', decimals: 0, grouping: false, unit: 'µM' },
        'cell',
        [],
      ),
    ).toEqual({ kind: 'number', decimals: 0, grouping: false, unit: 'µM' })
    expect(parseCellDisplay({ kind: 'text' }, 'cell', [])).toEqual({
      kind: 'text',
    })
  })
})

describe('screens', () => {
  it('retains explicit false/zero and scientific Unicode values across node kinds', () => {
    expect(
      parseScreenResult({
        view: {
          type: 'stack',
          direction: 'row',
          gap: 'lg',
          children: [
            { type: 'heading', text: 'ΔG, µM', level: 3 },
            { type: 'text', text: '', tone: 'muted' },
            {
              type: 'stat',
              label: 'ΔG',
              value: -2.5e-6,
              unit: 'kJ/mol',
              tone: 'warning',
            },
            { type: 'badge', text: 'β', tone: 'info' },
            { type: 'bar', value: 0, max: 0.5, label: 'µM', tone: 'danger' },
            { type: 'sparkline', values: [-0, 1.25, -2e-4], tone: 'success' },
            {
              type: 'input',
              name: 'confirmed',
              label: 'Confirm',
              kind: 'checkbox',
              value: false,
              required: false,
              help: 'Read β',
            },
            {
              type: 'button',
              label: 'Run',
              action: 'run-check',
              variant: 'secondary',
            },
            {
              type: 'form',
              children: [],
              submit: { label: 'Save', action: 'save' },
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      result: {
        view: {
          type: 'stack',
          direction: 'row',
          gap: 'lg',
          children: [
            { type: 'heading', text: 'ΔG, µM', level: 3 },
            { type: 'text', text: '', tone: 'muted' },
            {
              type: 'stat',
              label: 'ΔG',
              value: -2.5e-6,
              unit: 'kJ/mol',
              tone: 'warning',
            },
            { type: 'badge', text: 'β', tone: 'info' },
            { type: 'bar', value: 0, max: 0.5, label: 'µM', tone: 'danger' },
            { type: 'sparkline', values: [-0, 1.25, -2e-4], tone: 'success' },
            {
              type: 'input',
              name: 'confirmed',
              label: 'Confirm',
              kind: 'checkbox',
              value: false,
              required: false,
              help: 'Read β',
            },
            {
              type: 'button',
              label: 'Run',
              action: 'run-check',
              variant: 'secondary',
            },
            {
              type: 'form',
              children: [],
              submit: { label: 'Save', action: 'save' },
            },
          ],
        },
      },
    })
  })

  it('normalizes table cells and select options without losing declared optional settings', () => {
    expect(
      parseScreenResult({
        view: {
          type: 'table',
          columns: [
            { key: 'amount', label: 'µM', align: 'end' },
            { key: 'passed', label: 'Pass' },
          ],
          rows: [
            { amount: -0, passed: false, ignored: { arbitrary: true } },
            { amount: 2.5e-8 },
            { amount: 'β' },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      result: {
        view: {
          type: 'table',
          columns: [
            { key: 'amount', label: 'µM', align: 'end' },
            { key: 'passed', label: 'Pass' },
          ],
          rows: [
            { amount: -0, passed: false },
            { amount: 2.5e-8, passed: null },
            { amount: 'β', passed: null },
          ],
        },
      },
    })
    expect(
      parseScreenResult({
        view: {
          type: 'input',
          name: 'choice',
          label: 'β',
          kind: 'select',
          value: '',
          required: false,
          options: [{ value: '', label: 'None', future: true }],
        },
      }),
    ).toEqual({
      ok: true,
      result: {
        view: {
          type: 'input',
          name: 'choice',
          label: 'β',
          kind: 'select',
          value: '',
          required: false,
          options: [{ value: '', label: 'None' }],
        },
      },
    })
    expect(
      parseScreenResult({
        view: { type: 'input', name: 'choice', label: 'β', kind: null },
      }),
    ).toEqual({
      ok: true,
      result: { view: { type: 'input', name: 'choice', label: 'β' } },
    })
    expect(
      parseScreenResult({
        view: {
          type: 'input',
          name: 'amount',
          label: 'µM',
          kind: 'number',
          value: 0,
        },
      }),
    ).toEqual({
      ok: true,
      result: {
        view: {
          type: 'input',
          name: 'amount',
          label: 'µM',
          kind: 'number',
          value: 0,
        },
      },
    })
  })

  it.each([
    [
      { type: 'heading', text: 'Hi', level: 0 },
      'view(heading): level is 1, 2 or 3',
    ],
    [
      { type: 'stat', label: 'µM', value: Infinity },
      'view(stat): value is a number or up to 60 characters',
    ],
    [{ type: 'bar', value: 1, max: 0 }, 'view(bar): max is a number above 0'],
    [
      { type: 'sparkline', values: [1, NaN] },
      'view(sparkline): values are 2-100000 numbers',
    ],
    [
      { type: 'input', name: 'x', label: 'X', required: 0 },
      'view(input): required is true or false',
    ],
    [
      { type: 'input', name: 'x', label: 'X', kind: 'number', value: Infinity },
      'view(input): value is text, a number or true/false',
    ],
    [
      { type: 'button', label: 'Run', action: 'run', variant: 'link' },
      'view(button): variant is primary or secondary',
    ],
    [
      {
        type: 'form',
        children: [],
        submit: Object.fromEntries([
          ['label', 'Run'],
          ['action', 'run'],
          ['__proto__', null],
        ]),
      },
      'view(form): submit needs a label and an action',
    ],
    [
      {
        type: 'table',
        columns: [
          Object.fromEntries([
            ['key', 'x'],
            ['label', 'X'],
            ['__proto__', null],
          ]),
        ],
        rows: [],
      },
      'view(table): columns need a unique key (a-z, 0-9, _), a label and an optional align',
    ],
    [
      {
        type: 'table',
        columns: [{ key: 'x', label: 'X' }],
        rows: [{ x: Infinity }],
      },
      'view(table): cells are text (up to 10000 characters), numbers, true/false or empty',
    ],
  ])(
    'rejects malformed node settings %j in their existing envelope',
    (view, error) => {
      expect(parseScreenResult({ view })).toEqual({
        ok: false,
        errors: [error],
      })
    },
  )

  it.each([null, false, [], 42])(
    'rejects malformed screen/action answers %j',
    (input) => {
      expect(parseScreenResult(input)).toEqual({
        ok: false,
        errors: ['a screen returns an object'],
      })
      expect(parseActionResult(input)).toEqual({
        ok: false,
        errors: ['an action returns an object'],
      })
    },
  )

  it.each([
    { tone: 'warning', text: '' },
    { tone: 'warning', text: false },
    { tone: 'script', text: 'Hi' },
    { tone: 'info', text: 'x'.repeat(301) },
    { tone: 'info', text: 'Hi', extra: true },
    Object.fromEntries([
      ['tone', 'info'],
      ['text', 'Hi'],
      ['__proto__', null],
    ]),
  ])(
    'rejects malformed notices without dropping original settings %j',
    (notice) => {
      const expected = {
        ok: false,
        errors: ['notice needs a tone and text of up to 300 characters'],
      }

      expect(parseScreenResult({ view: { type: 'divider' }, notice })).toEqual(
        expected,
      )
      expect(parseActionResult({ notice })).toEqual(expected)
    },
  )

  it('preserves state identity and omission while normalizing valid screen/action answers', () => {
    const state = {
      date: new Date('2026-01-02T03:04:05Z'),
      value: Infinity,
      absent: undefined,
    }

    const notice = { tone: 'info', text: ' Ready ' }

    const parsed = parseScreenResult({
      view: { type: 'text', text: '' },
      state,
      notice,
    })

    expect(parsed).toEqual({
      ok: true,
      result: { view: { type: 'text', text: '' }, state, notice },
    })

    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    expect(parsed.result.state).toBe(state)
    expect(
      parseScreenResult({
        view: { type: 'divider' },
        state: null,
        notice: null,
      }),
    ).toEqual({ ok: true, result: { view: { type: 'divider' } } })
    expect(
      parseActionResult({
        notice,
        download: { filename: 'a.csv', mime: 'text/csv', text: 'a,b' },
      }),
    ).toEqual({
      ok: true,
      result: {
        notice,
        download: { filename: 'a.csv', mime: 'text/csv', text: 'a,b' },
      },
    })
  })

  it('enforces the child-list bound without reordering the accepted nodes', () => {
    const children = Array.from({ length: 60 }, (_, index) => ({
      type: 'text',
      text: `Part ${index}`,
    }))

    expect(parseScreenResult({ view: { type: 'stack', children } })).toEqual({
      ok: true,
      result: { view: { type: 'stack', children } },
    })
    expect(
      parseScreenResult({
        view: { type: 'stack', children: [...children, { type: 'divider' }] },
      }),
    ).toEqual({
      ok: false,
      errors: ['view(stack): children is a list of up to 60 parts'],
    })
    expect(parseScreenResult({ view: { type: 'heading', text: 42 } })).toEqual({
      ok: false,
      errors: ['view(heading): text must be 1-120 characters'],
    })
  })

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

    for (const download of [
      { filename: '../a.csv', mime: 'text/csv', text: 'x' },
      { filename: 'a.csv', mime: 'text/csv', text: false },
      Object.fromEntries([
        ['filename', 'a.csv'],
        ['mime', 'text/csv'],
        ['text', 'x'],
        ['__proto__', null],
      ]),
      {
        filename: 'a.csv',
        mime: 'text/csv',
        text: 'é'.repeat(1024 * 1024) + 'x',
      },
    ])
      expect(parseActionResult({ download }).ok).toBe(false)
    expect(
      parseActionResult({
        download: {
          filename: 'a.csv',
          mime: 'text/csv',
          text: 'é'.repeat(1024 * 1024),
        },
      }).ok,
    ).toBe(true)
  })
})

describe('the screens the Python checker also runs', () => {
  const cases = z
    .array(z.object({ name: z.string(), result: z.unknown(), ok: z.boolean() }))
    .parse(
      JSON.parse(
        readFileSync(
          path.resolve(
            __dirname,
            '../../../sdks/plugin-python/tests/screen_cases.json',
          ),
          'utf8',
        ),
      ),
    )

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const parsed = parseScreenResult(c.result)
    expect(parsed.ok, JSON.stringify(parsed)).toBe(c.ok)
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

  it('parses bounded options without inventing absent keys', () => {
    const errors: string[] = []
    expect(
      parseFieldTypes(
        [{ ...batch, title: ' Batch code ', minLength: 0, maxLength: 10000 }],
        errors,
      ),
    ).toEqual([{ ...batch, minLength: 0, maxLength: 10000 }])
    expect(
      parseFieldTypes(
        [{ id: 'n', title: 'N', base: 'decimal', min: -2.5, max: 0 }],
        errors,
      ),
    ).toEqual([{ id: 'n', title: 'N', base: 'decimal', min: -2.5, max: 0 }])
    expect(errors).toEqual([])
  })

  it.each([
    [
      { pattern: 'a' },
      'pattern must be an anchored expression (^…$) up to 200 characters',
    ],
    [
      { pattern: '^[$' },
      'pattern must be an anchored expression (^…$) up to 200 characters',
    ],
    [{ patternMessage: 1 }, 'patternMessage is 1-160 characters'],
    [{ minLength: -1 }, 'minLength is a whole number up to 10000'],
    [{ maxLength: 10001 }, 'maxLength is a whole number up to 10000'],
    [{ minLength: 1.5 }, 'minLength is a whole number up to 10000'],
    [{ min: 0 }, 'min does not apply to a text type'],
    [{ placeholder: false }, 'placeholder is 1-80 characters'],
    [
      { input: '../input.html' },
      'input must be an .html file in ui/, such as ui/input.html',
    ],
  ])('rejects malformed text options %j', (options, message) => {
    const errors: string[] = []
    expect(parseFieldTypes([{ ...batch, ...options }], errors)).toBeNull()
    expect(errors).toEqual([`contributions.field-types.batch-code ${message}`])
  })

  it('rejects non-finite numeric limits and preserves validation precedence', () => {
    const errors: string[] = []
    expect(
      parseFieldTypes(
        [{ id: 'n', title: 'N', base: 'decimal', min: Infinity }],
        errors,
      ),
    ).toBeNull()
    expect(errors).toEqual(['contributions.field-types.n min is a number'])
    const first: string[] = []
    expect(
      parseFieldTypes(
        [{ ...batch, pattern: 'bad', placeholder: false }],
        first,
      ),
    ).toBeNull()
    expect(first).toEqual([
      'contributions.field-types.batch-code pattern must be an anchored expression (^…$) up to 200 characters',
    ])
  })

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

describe('declaration boundaries', () => {
  it.each([
    [null, 'must be an object'],
    [
      { screen: { kind: 'python', entry: 'main:run' }, ui: 'ui/panel.html' },
      'has a screen or a ui, not both',
    ],
    [
      { screen: { kind: 'javascript', entry: 'main:run' } },
      'screen needs a python runner whose entry looks like module:function',
    ],
    [
      { ui: '../panel.html' },
      'ui must be an .html file in ui/, such as ui/index.html',
    ],
    [{ models: [] }, 'models is a list of 1-25 model keys'],
  ])('rejects malformed panel settings %j', (value, message) => {
    const errors: string[] = []
    expect(parsePanelDetails(value, 'panel', errors)).toBeNull()
    expect(errors).toEqual([`panel ${message}`])
  })

  it('keeps optional panel settings absent and deduplicates valid model selectors', () => {
    const errors: string[] = []
    expect(parsePanelDetails({}, 'panel', errors)).toEqual({})
    expect(
      parsePanelDetails(
        { ui: 'ui/panel.html', models: ['sample', 'lot', 'sample'] },
        'panel',
        errors,
      ),
    ).toEqual({ ui: 'ui/panel.html', models: ['sample', 'lot'] })
    expect(errors).toEqual([])
  })

  it('rejects malformed lists, identity, fields, chart references and selectors', () => {
    const errors: string[] = []
    expect(parseOperations(null, errors)).toBeNull()
    expect(parseOperations([false], errors)).toBeNull()
    expect(parseOperations([{ id: 1 }], errors)).toBeNull()
    expect(
      parseOperations(
        [
          {
            id: 'x',
            title: 'X',
            description: 'X',
            access: 'read',
            inputs: [{ name: 'n', type: 'number', required: 'yes' }],
            outputs: [],
            runner: { kind: 'python', entry: 'main:run' },
          },
        ],
        errors,
      ),
    ).toBeNull()
    expect(errors).toEqual([
      'contributions.operations must be a list of at most 1000',
      'contributions.operations entries must be objects',
      'contributions.operations entry ids must match ^[a-z][a-z0-9-]{0,48}$',
      'contributions.operations.x inputs n must say whether it is required',
    ])
    const chart: string[] = []
    expect(
      parseAnalysisKinds(
        [
          {
            id: 'x',
            title: 'X',
            inputs: [{ name: 'x', label: 'X', type: 'number', required: true }],
            runner: { kind: 'python', entry: 'main:run' },
            result: {
              columns: [{ name: 'x', type: 'text' }],
              chart: { type: 'line', x: 'x', y: 'x' },
            },
          },
        ],
        chart,
      ),
    ).toBeNull()
    expect(chart).toEqual([
      'contributions.analysis-kinds.x chart needs a type (line, scatter or bar), an x column, a numeric y column and an optional group column, all from the result columns',
    ])
    const selectors: string[] = []
    expect(
      parseColumns(
        [
          {
            id: 'x',
            title: 'X',
            description: 'X',
            value: 'number',
            runner: { kind: 'python', entry: 'main:run' },
            models: ['Bad'],
            inputs: [false],
          },
        ],
        selectors,
      ),
    ).toBeNull()
    expect(selectors).toEqual([
      'contributions.columns.x models is a list of 1-25 model keys',
      'contributions.columns.x inputs is a list of 1-24 field names',
    ])
    const rawKeys: string[] = []
    expect(
      parseBlocks(
        [
          JSON.parse(
            '{"id":"x","title":"X","description":"X","ui":"ui/a.html","__proto__":{}}',
          ),
        ],
        rawKeys,
      ),
    ).toBeNull()
    expect(rawKeys).toEqual([
      'contributions.blocks.x has an unknown setting: __proto__',
    ])
  })

  it('keeps JSON property names as own properties, including __proto__', () => {
    const schema = fieldsJsonSchema([
      { name: '__proto__', type: 'text', required: true },
    ])

    expect(Object.hasOwn(schema.properties, '__proto__')).toBe(true)
    expect(schema.properties.__proto__).toEqual({ type: 'string' })
    expect(schema.required).toEqual(['__proto__'])
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

  it('keeps state as large as a long sequence with its reads', () => {
    const state = { residues: 'ACGT'.repeat(100_000), reads: [] }
    expect(
      validatePluginBlock({
        plugin: 'sequence-tools',
        block: 'sequence',
        state,
      }),
    ).toEqual([])
  })
})

describe('the sandboxed frame', () => {
  const sdk = readFileSync(
    path.resolve(__dirname, '../../../sdks/plugin-ui/sheetbase-ui.js'),
    'utf8',
  )

  const files = readExample('ui-counter')

  it.each([
    '<head></head><script src="bundle.js"></script>',
    '<head></head><script src="sheetbase-ui.js"></script><script src="bundle.js"></script>',
  ])('injects one SDK without rewriting script source: %s', (html) => {
    const frame =
      buildPluginFrame(
        {
          'ui/index.html': html,
          'ui/bundle.js': 'const asset = \'href="keep.svg"\'',
        },
        'ui/index.html',
        'window.sdkMarker = "Δμ"',
      ) ?? ''

    expect(frame.match(/window\.sdkMarker/g)).toHaveLength(1)
    expect(frame).toContain('const asset = \'href="keep.svg"\'')
    expect(frame).toContain('window.sdkMarker = "Δμ"')
  })

  it('inlines the page and the SDK, and allows no network', () => {
    const html = buildPluginFrame(files, 'ui/counter.html', sdk) ?? ''
    expect(html).toContain('window.sheetbase')
    // The SDK's own comment mentions the tag; what matters is that no script
    // tag still points at a file.
    expect(
      html.replace(/\/\*![\s\S]*?\*\//, '').match(/<script\b[^>]*\bsrc\s*=/i),
    ).toBeNull()
    expect(PLUGIN_UI_SDK_NAME).toBe('sheetbase-ui.js')
    expect(PLUGIN_FRAME_CSP).toContain("default-src 'none'")
    expect(PLUGIN_FRAME_CSP).toMatch(/connect-src data: blob:(;|$)/)
  })

  it('has nothing for an entry that is not in the package', () => {
    expect(buildPluginFrame(files, 'ui/missing.html', sdk)).toBeNull()
  })
})

describe('column answer boundary', () => {
  it.each([
    ['number', -1.25, true],
    ['number', Infinity, false],
    ['number', '1', false],
    ['boolean', false, true],
    ['boolean', 0, false],
    ['text', 'Δμ', true],
    ['text', 'x'.repeat(100_000), true],
    ['text', 'x'.repeat(100_001), false],
    ['svg', '<svg/>', true],
    ['text', null, true],
  ] as const)('checks %s answer case %#', async (type, value, valid) => {
    const files = readExample('plate-tools')
    const { manifest } = buildPluginPackage(files)
    const declaration = manifest.contributions.columns?.[0]

    if (!declaration) throw new Error('plate-tools must provide a column')

    declaration.value = type

    const deps: ExtensionRuntimeDeps = {
      loadInstall: async () => ({
        id: 'e1',
        key: 'plate-tools',
        name: 'Plate tools',
        status: 'enabled',
        disabledPoints: [],
        manifest,
      }),
      loadPackage: async () => files,
      executePython: async () => ({
        rows: [{ values: [value] }],
        logs: [],
        runtime: 'unit',
      }),
      audit: async () => undefined,
      now: () => 0,
    }

    const result = runExtensionHook(
      {
        workspaceId: 'w1',
        actorUserId: 'u1',
        extensionKey: 'plate-tools',
        kind: 'column',
        itemId: declaration.id,
        rows: [{ viability: 2 }],
      },
      deps,
    )

    if (valid)
      await expect(result).resolves.toMatchObject({
        kind: 'column',
        values: [value],
      })
    else await expect(result).rejects.toMatchObject({ code: 'bad_answer' })
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
        manifest: manifest,
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
