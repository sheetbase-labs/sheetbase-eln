import { describe, expect, it } from 'vitest'
import {
  buildPersistedFormulaArtifact,
  decodeFormulaBindings,
  decodeFormulaNode,
  FORMULA_LIMITS,
  FormulaSyntaxError,
  normalizeExponentiation,
  parseFormula,
  validatePersistedFormulaArtifact,
} from './formula-ir'
import type { FormulaNode } from './formula-ir'

describe('normalizeExponentiation', () => {
  it('converts ** to ^ outside string literals', () => {
    expect(normalizeExponentiation('=2**3')).toBe('=2^3')
    expect(normalizeExponentiation('=A1**B2')).toBe('=A1^B2')
    expect(normalizeExponentiation('=2**3**4')).toBe('=2^3^4')
  })

  it('preserves ** inside string literals', () => {
    expect(normalizeExponentiation('="pattern ** here"')).toBe(
      '="pattern ** here"',
    )
    expect(normalizeExponentiation('="a" & "b ** c"')).toBe('="a" & "b ** c"')
  })

  it('handles escaped quotes inside string literals', () => {
    expect(normalizeExponentiation('="say ""hi"" ** ok"')).toBe(
      '="say ""hi"" ** ok"',
    )
  })

  it('handles mixed formula and string content', () => {
    expect(normalizeExponentiation('=2**3 & "x**y"')).toBe('=2^3 & "x**y"')
  })

  it('leaves formulas without ** unchanged', () => {
    expect(normalizeExponentiation('=2^3+A1')).toBe('=2^3+A1')
    expect(normalizeExponentiation('=SUM(A1:A5)')).toBe('=SUM(A1:A5)')
  })

  it('handles ** at the start of a formula expression', () => {
    expect(normalizeExponentiation('=2**3')).toBe('=2^3')
  })

  it('handles empty and single-* strings', () => {
    expect(normalizeExponentiation('')).toBe('')
    expect(normalizeExponentiation('=2*3')).toBe('=2*3')
  })
})

describe('stored formula boundaries', () => {
  const tableId = '11111111-1111-4111-8111-111111111111'

  const rowIds = [
    '21111111-1111-4111-8111-111111111111',
    '21111111-1111-4111-8111-111111111112',
  ]

  const columnIds = [
    '31111111-1111-4111-8111-111111111111',
    '31111111-1111-4111-8111-111111111112',
  ]

  const persisted = (source = '=A1+SUM(A1:B2)') =>
    buildPersistedFormulaArtifact(
      parseFormula(source, { rowIds, columnIds }),
      tableId,
    )

  const cell = { rowId: rowIds[0], columnId: columnIds[0] }
  const anchor = { columnAbsolute: false, rowAbsolute: false }
  const cellBinding = { kind: 'cell', slot: 0, cell, anchor }

  const rangeBinding = {
    kind: 'range',
    slot: 0,
    members: [[cell]],
    start: anchor,
    end: anchor,
  }

  function expectInvalid(action: () => void, diagnostic: string) {
    expect(action).toThrow(FormulaSyntaxError)
    expect(action).toThrow(`Invalid persisted formula: ${diagnostic}`)

    try {
      action()
    } catch (error) {
      expect(error).toHaveProperty('code', 'syntax')
    }
  }

  it('decodes bindings and nodes before the complete artifact is assembled', () => {
    const artifact = persisted()
    const bindings = decodeFormulaBindings(artifact.bindings)
    const template = decodeFormulaNode(artifact.template, bindings.length)

    expect(bindings).toBe(artifact.bindings)
    expect(template).toBe(artifact.template)
    expect(validatePersistedFormulaArtifact(artifact)).toBe(artifact)
    expect(decodeFormulaBindings([])).toEqual([])
    expect(decodeFormulaNode({ kind: 'number', value: 1 }, 0)).toEqual({
      kind: 'number',
      value: 1,
    })
  })

  it.each([
    [null, 'bindings exceed the profile.'],
    [
      [{ ...cellBinding, slot: 1 }],
      'binding slots must be bijective and ordered.',
    ],
    [[{ ...cellBinding, cell: {} }], 'cell binding shape is invalid.'],
    [[{ ...cellBinding, tableId: '' }], 'cell binding shape is invalid.'],
    [[{ ...cellBinding, extra: true }], 'cell binding shape is invalid.'],
    [[{ ...rangeBinding, members: [] }], 'range binding shape is invalid.'],
    [
      [{ ...rangeBinding, members: [[cell], [cell, cell]] }],
      'ranges must be nonempty rectangles of stable identities.',
    ],
    [[{ kind: 'other', slot: 0 }], 'binding kind is invalid.'],
  ])(
    'rejects malformed bindings with the full-artifact diagnostic: %j',
    (input, diagnostic) => {
      expectInvalid(() => decodeFormulaBindings(input), diagnostic)
      expectInvalid(
        () =>
          validatePersistedFormulaArtifact({ ...persisted(), bindings: input }),
        diagnostic,
      )
    },
  )

  it('retains slot and cumulative captured-range limits', () => {
    expectInvalid(
      () =>
        decodeFormulaBindings(
          Array.from({ length: FORMULA_LIMITS.slots + 1 }, () => cellBinding),
        ),
      'bindings exceed the profile.',
    )

    const members = [
      Array.from({ length: FORMULA_LIMITS.rangeCells / 2 + 1 }, () => cell),
    ]

    const bindings = [
      { ...rangeBinding, members },
      { ...rangeBinding, slot: 1, members },
    ]

    expectInvalid(
      () => decodeFormulaBindings(bindings),
      'captured ranges exceed the profile.',
    )
    expectInvalid(
      () => validatePersistedFormulaArtifact({ ...persisted(), bindings }),
      'captured ranges exceed the profile.',
    )
  })

  it.each([
    [null, 'formula tree is invalid.'],
    [{ kind: 'number', value: Infinity }, 'number node is invalid.'],
    [{ kind: 'string', value: false }, 'string node is invalid.'],
    [{ kind: 'boolean', value: 'true' }, 'boolean node is invalid.'],
    [{ kind: 'reference', slot: 1 }, 'reference slots must form a bijection.'],
    [{ kind: 'reference', slot: -1 }, 'reference slots must form a bijection.'],
    [
      { kind: 'reference', slot: 0.5 },
      'reference slots must form a bijection.',
    ],
    [{ kind: 'number', value: 1 }, 'reference slots must form a bijection.'],
    [
      {
        kind: 'binary',
        operator: '+',
        left: { kind: 'reference', slot: 0 },
        right: { kind: 'reference', slot: 0 },
      },
      'reference slots must form a bijection.',
    ],
    [{ kind: 'unary', operator: '*', operand: {} }, 'unary node is invalid.'],
    [{ kind: 'percent', operand: {}, extra: true }, 'percent node is invalid.'],
    [
      { kind: 'binary', operator: '?', left: {}, right: {} },
      'binary node is invalid.',
    ],
    [
      { kind: 'call', functionId: 'sum', arguments: [] },
      'call node is invalid.',
    ],
    [{ kind: 'other' }, 'node kind is invalid.'],
  ])(
    'rejects malformed nodes with the full-artifact diagnostic: %j',
    (input, diagnostic) => {
      expectInvalid(() => decodeFormulaNode(input, 1), diagnostic)
      expectInvalid(
        () =>
          validatePersistedFormulaArtifact({
            ...persisted('=A1'),
            template: input,
          }),
        diagnostic,
      )
    },
  )

  it('retains the tree-size limit', () => {
    const template = {
      kind: 'call',
      functionId: 'SUM',
      arguments: Array.from({ length: FORMULA_LIMITS.source }, () => ({
        kind: 'number',
        value: 1,
      })),
    }

    expectInvalid(
      () => decodeFormulaNode(template, 0),
      'formula tree is too large.',
    )
    expectInvalid(
      () => validatePersistedFormulaArtifact({ ...persisted('=1'), template }),
      'formula tree is too large.',
    )
  })

  it.each([
    [{ version: 2 }, 'profile, version, or status is not allowed.'],
    [
      { literalProfile: 'other' },
      'profile, version, or status is not allowed.',
    ],
    [{ source: 'A1' }, 'source is invalid.'],
    [{ engineExpression: 'A1' }, 'engine expression is invalid.'],
    [{ dependencies: null }, 'dependencies must be an array.'],
    [{ dependencies: [{}] }, 'dependency shape is invalid.'],
    [{ dependencies: [] }, 'dependencies do not match bindings.'],
  ])('retains complete-artifact rejection: %j', (patch, diagnostic) => {
    expectInvalid(
      () => validatePersistedFormulaArtifact({ ...persisted(), ...patch }),
      diagnostic,
    )
  })

  it('still requires the complete artifact fields', () => {
    const { dependencies: _dependencies, ...incomplete } = persisted()
    expectInvalid(
      () => validatePersistedFormulaArtifact(incomplete),
      'artifact fields do not match v1.',
    )
  })

  it('retains dependency uniqueness and supported-function semantics', () => {
    const artifact = persisted('=A1')
    expectInvalid(
      () =>
        validatePersistedFormulaArtifact({
          ...artifact,
          dependencies: [...artifact.dependencies, ...artifact.dependencies],
        }),
      'dependencies must be unique.',
    )
    const unsupported = persisted('=RAND()')
    expect(decodeFormulaNode(unsupported.template, 0)).toBe(
      unsupported.template,
    )
    expectInvalid(
      () =>
        validatePersistedFormulaArtifact({
          ...unsupported,
          status: 'supported',
        }),
      'status does not match function semantics.',
    )
    expect(
      validatePersistedFormulaArtifact({ ...artifact, status: 'unsupported' })
        .status,
    ).toBe('unsupported')
  })

  it.each([null, undefined, [], true, 1, 'formula'])(
    'rejects non-object storage boundaries: %j',
    (input) => {
      expectInvalid(
        () => validatePersistedFormulaArtifact(input),
        'artifact must be an object.',
      )
      expectInvalid(
        () => decodeFormulaNode(input, 0),
        'formula tree is invalid.',
      )
    },
  )

  it('checks the original own keys at every scientific object boundary', () => {
    const extra = { extra: undefined }
    expectInvalid(
      () =>
        decodeFormulaBindings([
          { ...cellBinding, cell: { ...cell, ...extra } },
        ]),
      'cell binding shape is invalid.',
    )
    expectInvalid(
      () =>
        decodeFormulaBindings([
          { ...cellBinding, anchor: { ...anchor, ...extra } },
        ]),
      'cell binding shape is invalid.',
    )
    expectInvalid(
      () => decodeFormulaBindings([{ ...cellBinding, tableId: undefined }]),
      'cell binding shape is invalid.',
    )
    expectInvalid(
      () => decodeFormulaNode({ kind: 'number', value: 1, ...extra }, 0),
      'number node is invalid.',
    )
    const artifact = persisted('=A1')
    expectInvalid(
      () => validatePersistedFormulaArtifact({ ...artifact, ...extra }),
      'artifact fields do not match v1.',
    )
    expectInvalid(
      () =>
        validatePersistedFormulaArtifact({
          ...artifact,
          dependencies: artifact.dependencies.map((dependency) => ({
            ...dependency,
            ...extra,
          })),
        }),
      'dependency shape is invalid.',
    )
  })

  it('retains diagnostic precedence across simultaneous invalid fields', () => {
    expectInvalid(
      () =>
        validatePersistedFormulaArtifact({
          ...persisted(),
          version: 2,
          source: false,
          bindings: null,
        }),
      'profile, version, or status is not allowed.',
    )
    expectInvalid(
      () =>
        validatePersistedFormulaArtifact({
          ...persisted(),
          source: false,
          bindings: null,
        }),
      'source is invalid.',
    )
    expectInvalid(
      () => decodeFormulaBindings([{ ...cellBinding, slot: 1, cell: null }]),
      'binding slots must be bijective and ordered.',
    )
    expectInvalid(
      () =>
        decodeFormulaNode(
          { kind: 'binary', operator: '?', left: null, right: null },
          0,
        ),
      'binary node is invalid.',
    )
    expectInvalid(
      () =>
        decodeFormulaNode(
          {
            kind: 'binary',
            operator: '+',
            left: null,
            right: { kind: 'other' },
          },
          0,
        ),
      'formula tree is invalid.',
    )
  })

  it('retains original trees, nested members and omitted local table IDs', () => {
    const artifact = persisted()
    expect(JSON.stringify(validatePersistedFormulaArtifact(artifact))).toBe(
      JSON.stringify(artifact),
    )
    expect(
      artifact.bindings.every((binding) => !Object.hasOwn(binding, 'tableId')),
    ).toBe(true)
    expect(decodeFormulaBindings(artifact.bindings)[1]).toBe(
      artifact.bindings[1],
    )

    const cross = parseFormula('=Other!A1+SUM(Other!A1:B2)', {
      rowIds,
      columnIds,
      tables: [{ tableId, name: 'Other', rowIds, columnIds }],
    }).artifact

    expect(cross.bindings.every((binding) => binding.tableId === tableId)).toBe(
      true,
    )
    expect(cross.bindings.map((binding) => Object.keys(binding))).toEqual([
      ['kind', 'slot', 'tableId', 'cell', 'anchor'],
      ['kind', 'slot', 'tableId', 'members', 'start', 'end'],
    ])
    expect(decodeFormulaBindings(cross.bindings)).toBe(cross.bindings)

    const stored = buildPersistedFormulaArtifact(
      { status: 'supported', artifact: cross },
      tableId,
    )

    expect(validatePersistedFormulaArtifact(stored)).toBe(stored)
  })

  it.each(['=', '<>', '<', '<=', '>', '>=', '&', '+', '-', '*', '/', '^'])(
    'uses the same binary operator contract in parsing and decoding: %s',
    (operator) => {
      const artifact = persisted(`=2${operator}3`)
      expect(decodeFormulaNode(artifact.template, 0)).toBe(artifact.template)
      expect(validatePersistedFormulaArtifact(artifact)).toBe(artifact)
      expect(artifact.engineExpression).toBe(`=(2${operator}3)`)
    },
  )

  it('preserves associativity, unary precedence and percent serialization', () => {
    expect(persisted('=2^3^4').engineExpression).toBe('=((2^3)^4)')
    expect(persisted('=-2^3').engineExpression).toBe('=((-2)^3)')
    expect(persisted('=2+3*4%').engineExpression).toBe('=(2+(3*(4/100)))')
  })

  it('does not broaden source syntax or silently tighten legacy tree decoding', () => {
    const template = {
      kind: 'binary',
      operator: 'toString',
      left: { kind: 'number', value: 1 },
      right: { kind: 'number', value: 2 },
    }

    expect(decodeFormulaNode(template, 0)).toBe(template)
    expect(() => persisted('=1 toString 2')).toThrow(FormulaSyntaxError)
  })

  it('does not materialize absent array entries while decoding original input', () => {
    const bindings = [cellBinding]
    bindings.length = 2
    expect(decodeFormulaBindings(bindings)).toBe(bindings)
    expect(Object.hasOwn(bindings, 1)).toBe(false)

    const args: FormulaNode[] = []
    args.length = 1
    const template = { kind: 'call', functionId: 'SUM', arguments: args }

    expect(decodeFormulaNode(template, 0)).toBe(template)
    expect(Object.hasOwn(args, 0)).toBe(false)
  })
})
