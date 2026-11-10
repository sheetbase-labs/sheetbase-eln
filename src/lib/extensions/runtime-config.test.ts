/**
 * Packages, hosts and limits a plugin declares or is given. The shared cases
 * for `plugin.json` run in package.test.ts; these are the building blocks.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLUGIN_LIMITS,
  hostAllowed,
  hostProblem,
  parsePythonDeclaration,
  requirementProblem,
  resolveLimits,
  runnerLimits,
  validateLimitOverrides,
} from './runtime-config'

describe('requirementProblem', () => {
  it.each([
    'rdkit',
    'rdkit>=2024.3',
    'biopython==1.84',
    'numpy>=1.26,<3',
    'pandas[performance]>=2',
    'scikit-learn~=1.5; python_version >= "3.10"',
    'mytool @ https://example.org/mytool-1.0.tar.gz',
  ])('accepts %s', (line) => {
    expect(requirementProblem(line)).toBeNull()
  })

  it.each([
    '--index-url https://evil.example',
    '-r other.txt',
    'rdkit --hash=sha256:00',
    'not a package',
    'x @ git+https://example.org/x.git',
    '',
    '   ',
  ])('refuses %j', (line) => {
    expect(requirementProblem(line)).not.toBeNull()
  })

  it('does not decide which packages are allowed', () => {
    for (const line of [
      'rdkit',
      'torch',
      'tensorflow',
      'scanpy',
      'pymol-open-source',
    ])
      expect(requirementProblem(line)).toBeNull()
  })
})

describe('hosts', () => {
  it('accepts names and sub-domain wildcards, not URLs, paths or ports', () => {
    expect(hostProblem('eutils.ncbi.nlm.nih.gov')).toBeNull()
    expect(hostProblem('*.ebi.ac.uk')).toBeNull()

    for (const bad of [
      'https://x.org',
      'x.org/a',
      'x.org:8080',
      'localhost',
      '',
    ])
      expect(hostProblem(bad), bad).not.toBeNull()
  })

  it('allows a wildcard’s sub-domains but not the bare name or a lookalike', () => {
    expect(hostAllowed(['*.ebi.ac.uk'], 'www.ebi.ac.uk')).toBe(true)
    expect(hostAllowed(['*.ebi.ac.uk'], 'ebi.ac.uk')).toBe(false)
    expect(hostAllowed(['*.ebi.ac.uk'], 'evilebi.ac.uk')).toBe(false)
    expect(hostAllowed(['ebi.ac.uk'], 'EBI.ac.uk')).toBe(true)
  })
})

describe('parsePythonDeclaration', () => {
  it('reports stripped JSON keys while retaining independently valid entries', () => {
    const input = JSON.parse(
      '{"requirements":["numpy"],"__proto__":{},"network":["api.example.org"]}',
    )

    expect(parsePythonDeclaration(input)).toEqual({
      value: { requirements: ['numpy'], network: ['api.example.org'] },
      errors: ['unknown key in python: __proto__'],
    })
  })

  it('refuses malformed metadata without treating it as package or host text', () => {
    for (const input of [true, 42, 'python', []])
      expect(parsePythonDeclaration(input).errors).toEqual([
        'python must be an object',
      ])

    expect(
      parsePythonDeclaration({
        requirements: {},
        network: ['api.example.org', 42],
      }),
    ).toEqual({
      value: { requirements: [], network: ['api.example.org'] },
      errors: [
        'python.requirements must be a list',
        'python.network: a host must be written as text',
      ],
    })
    expect(
      parsePythonDeclaration({
        requirements: [null, {}, 'numpy'],
        network: false,
      }),
    ).toEqual({
      value: { requirements: ['numpy'], network: [] },
      errors: [
        'python.requirements: a package must be written as text',
        'python.requirements: a package must be written as text',
        'python.network must be a list',
      ],
    })
  })

  it('is empty when the plugin declares nothing', () => {
    expect(parsePythonDeclaration(undefined)).toEqual({
      value: { requirements: [], network: [] },
      errors: [],
    })
  })

  it('cleans, de-duplicates and lower-cases hosts', () => {
    const { value, errors } = parsePythonDeclaration({
      requirements: [' rdkit>=2024.3 ', 'rdkit>=2024.3'],
      network: ['api.example.org', 'api.example.org'],
    })

    expect(errors).toEqual([])
    expect(value.requirements).toEqual(['rdkit>=2024.3'])
    expect(value.network).toEqual(['api.example.org'])
  })

  it('names every problem with where it is', () => {
    const { errors } = parsePythonDeclaration({
      requirements: ['-r x', 'fine'],
      network: ['https://x.org'],
      extra: 1,
    })

    expect(errors.join('\n')).toMatch(/python.requirements: -r x/)
    expect(errors.join('\n')).toMatch(/python.network: https:\/\/x.org/)
    expect(errors.join('\n')).toMatch(/unknown key in python: extra/)
  })

  it('does not count packages or hosts', () => {
    const many = Array.from({ length: 500 }, (_, index) => `package-${index}`)
    expect(parsePythonDeclaration({ requirements: many }).errors).toEqual([])
  })
})

describe('limits', () => {
  it('has generous defaults and no rate limit', () => {
    expect(DEFAULT_PLUGIN_LIMITS).toEqual({
      timeoutSeconds: 600,
      memoryMb: 4096,
      cpus: 2,
      processes: 512,
      scratchMb: 2048,
      dataMb: 256,
      rows: 5_000_000,
      callsPerMinute: null,
    })
  })

  it('puts an administrator’s settings over the defaults', () => {
    expect(
      resolveLimits({ memoryMb: 16384, callsPerMinute: 30 }),
    ).toMatchObject({
      memoryMb: 16384,
      callsPerMinute: 30,
      timeoutSeconds: 600,
    })
    expect(resolveLimits(undefined)).toEqual(DEFAULT_PLUGIN_LIMITS)
    // Junk in the database never turns a limit off.
    expect(
      resolveLimits({ memoryMb: -1, rows: 'lots', cpus: Infinity }),
    ).toEqual(DEFAULT_PLUGIN_LIMITS)
    expect(
      resolveLimits({
        cpus: 0.25,
        rows: -1,
        memoryMb: 8192,
        callsPerMinute: 1.5,
      }),
    ).toEqual({
      ...DEFAULT_PLUGIN_LIMITS,
      cpus: 0.25,
      memoryMb: 8192,
    })

    for (const input of [null, true, 'limits', []]) {
      expect(resolveLimits(input)).toEqual(DEFAULT_PLUGIN_LIMITS)
      expect(validateLimitOverrides(input)).toEqual({
        value: {},
        errors: ['limits must be an object'],
      })
    }

    expect(
      validateLimitOverrides({
        cpus: 0.25,
        rows: 1.5,
        memoryMb: 8192,
        surprise: 1,
      }),
    ).toEqual({
      value: { cpus: 0.25, memoryMb: 8192 },
      errors: [
        'unknown limit: surprise',
        'rows must be a whole number above zero',
      ],
    })
  })

  it('accepts any positive value: nothing caps what an administrator may give', () => {
    const { value, errors } = validateLimitOverrides({
      timeoutSeconds: 86_400,
      memoryMb: 1_000_000,
      cpus: 64.5,
      processes: 100_000,
      scratchMb: 1_000_000,
      dataMb: 100_000,
      rows: 1_000_000_000,
      callsPerMinute: 1_000_000,
    })

    expect(errors).toEqual([])
    expect(value.memoryMb).toBe(1_000_000)
    expect(
      validateLimitOverrides({ rows: 1e20, callsPerMinute: 1e20 }).errors,
    ).toEqual([])
  })

  it('refuses what makes no sense', () => {
    for (const bad of [
      { timeoutSeconds: 0 },
      { memoryMb: -5 },
      { rows: 1.5 },
      { cpus: 'two' },
      { surprise: 1 },
      [],
    ])
      expect(
        validateLimitOverrides(bad).errors,
        JSON.stringify(bad),
      ).not.toEqual([])
    expect(validateLimitOverrides({ callsPerMinute: null }).errors).toEqual([])
  })

  it('gives the runner bytes and seconds', () => {
    expect(runnerLimits(resolveLimits({ dataMb: 2 }))).toMatchObject({
      bytes: 2 * 1024 * 1024,
      timeoutSeconds: 600,
    })
  })
})
