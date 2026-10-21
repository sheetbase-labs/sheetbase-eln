import { describe, expect, it } from 'vitest'

import {
  analysePython,
  contractErrors,
  importedModules,
  isStarterStatement,
  parseRequirement,
  parseRequirementsText,
  pythonSkeleton,
  requirementErrors,
  unmetRequirements,
} from './python'

describe('requirements', () => {
  it('accepts only pinned name==version lines', () => {
    expect(
      requirementErrors(['scipy==1.15.3', 'python-dateutil==2.9.0.post0']),
    ).toEqual([])
    for (const line of [
      'scipy',
      'scipy>=1.0',
      'scipy[extra]==1.0',
      'scipy @ https://example.com/x.whl',
      '--index-url=https://example.com',
      'git+https://example.com/x.git',
    ])
      expect(requirementErrors([line]), line).not.toEqual([])
  })

  it('rejects duplicates under PEP 503 normalisation and too many packages', () => {
    expect(
      requirementErrors(['Scikit_Learn==1.5.0', 'scikit-learn==1.5.0']),
    ).toEqual(['scikit-learn is declared more than once.'])
    const many = Array.from({ length: 51 }, (_, i) => `pkg${i}==1.0`)
    expect(requirementErrors(many)[0]).toContain('At most 50')
    expect(requirementErrors('scipy==1')).toHaveLength(1)
  })

  it('names what the runtime does not provide', () => {
    expect(parseRequirement('Pandas==2.2.3')).toEqual({
      name: 'pandas',
      version: '2.2.3',
    })
    expect(
      unmetRequirements(['pandas==2.2.3', 'numpy==9.9.9', 'scipy==1.15.3'], {
        pandas: '2.2.3',
        numpy: '2.2.6',
      }),
    ).toEqual([
      'numpy==9.9.9 was requested but this runtime has 2.2.6.',
      'scipy==1.15.3 is not in this runtime.',
    ])
  })

  it('reads a textarea, ignoring comments and blanks', () => {
    expect(
      parseRequirementsText('numpy==2.2.6  # fast\n\n# nothing\nscipy==1.15.3'),
    ).toEqual(['numpy==2.2.6', 'scipy==1.15.3'])
  })
})

describe('contractErrors', () => {
  it('accepts a contract with input and output columns', () => {
    expect(
      contractErrors({
        inputs: { readings: [{ name: 'value', type: 'decimal' }] },
        output: {
          columns: [
            { name: 'mean', type: 'decimal', nullable: false },
            { name: 'n', type: 'integer' },
          ],
          additionalColumns: false,
        },
      }),
    ).toEqual([])
  })

  it('names each way a contract can be wrong', () => {
    const errors = contractErrors({
      inputs: { Bad: [{ name: 'a', type: 'text' }] },
      output: {
        columns: [
          { name: 'a', type: 'float' },
          { name: 'a', type: 'text' },
          { name: '', type: 'text' },
          { name: 'b', type: 'text', nullable: 'yes' },
        ],
        additionalColumns: 'no',
      },
      extra: true,
    })
    expect(errors.join('\n')).toContain('“Bad” is not a valid input name.')
    expect(errors.join('\n')).toContain('needs a type')
    expect(errors.join('\n')).toContain('lists column “a” twice')
    expect(errors.join('\n')).toContain('without a valid name')
    expect(errors.join('\n')).toContain('nullable must be true or false')
    expect(errors.join('\n')).toContain(
      'additionalColumns must be true or false',
    )
    expect(errors.join('\n')).toContain('Unknown contract key “extra”')
  })
})

describe('pythonSkeleton', () => {
  it('is written from the declared inputs, parameters and output columns', () => {
    const code = pythonSkeleton({
      inputs: [{ name: 'readings' }],
      parameters: [{ name: 'dose', type: 'integer' }],
      hasPrevious: true,
      contract: {
        inputs: { readings: [{ name: 'value', type: 'decimal' }] },
        output: {
          columns: [
            { name: 'mean', type: 'decimal' },
            { name: 'day', type: 'date' },
          ],
        },
      },
    })
    expect(code).toContain('def transform(inputs, parameters):')
    expect(code).toContain('readings = pd.DataFrame(inputs["readings"])')
    expect(code).toContain('# readings columns: value (decimal)')
    expect(code).toContain('previous = pd.DataFrame(inputs["previous"])')
    expect(code).toContain('dose = parameters["dose"]  # integer')
    expect(code).toContain('"mean": [0.0],')
    expect(code).toContain('"day": ["1970-01-01"],')
    expect(isStarterStatement(code)).toBe(true)
  })

  it('still returns something runnable with nothing declared', () => {
    expect(pythonSkeleton({ inputs: [], parameters: [] })).toContain(
      'return pd.DataFrame({"value": [1]})',
    )
  })

  it('does not call written code a starter', () => {
    expect(isStarterStatement('select 42')).toBe(false)
    expect(isStarterStatement('  ')).toBe(true)
    expect(isStarterStatement('select * from previous')).toBe(true)
  })
})

describe('analysePython', () => {
  it('asks for transform(inputs, parameters)', () => {
    expect(analysePython('x = 1')[0]).toMatchObject({ level: 'error' })
    expect(
      analysePython('def transform(inputs):\n  return []')[0],
    ).toMatchObject({
      level: 'error',
      line: 1,
    })
    expect(
      analysePython('def transform(inputs, parameters):\n  return []'),
    ).toEqual([])
  })

  it('finds imports, including from-imports and lists', () => {
    expect(
      importedModules(
        'import os, numpy as np\nfrom scipy import stats\n  import pandas\nx = "import fake"',
      ),
    ).toEqual([
      { module: 'os', line: 1 },
      { module: 'numpy', line: 1 },
      { module: 'scipy', line: 2 },
      { module: 'pandas', line: 3 },
    ])
  })

  it('warns about a package the runtime does not have, once, but not the standard library', () => {
    const code = [
      'import json',
      'import sklearn',
      'from sklearn.linear_model import Ridge',
      'import numpy',
      'def transform(inputs, parameters):',
      '    return []',
    ].join('\n')
    const diagnostics = analysePython(code, { installed: { numpy: '2.2.6' } })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ level: 'warning', line: 2 })
    expect(diagnostics[0].message).toContain('sklearn')
    expect(
      analysePython(code, { installed: { numpy: '2', 'scikit-learn': '1.5' } }),
    ).toEqual([])
  })
})
