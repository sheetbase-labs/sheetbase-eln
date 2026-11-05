import { describe, expect, it } from 'vitest'

import {
  canonicalSequence,
  cleanDetails,
  entryFingerprint,
  leastRotation,
  walkLineage,
} from './bio-registry'
import type { RegistryEntry, RegistryParentWire } from './bio-registry'

function entry(id: string): RegistryEntry {
  return {
    id,
    kind: 'construct',
    registryId: id.toUpperCase(),
    name: id,
    description: null,
    status: 'active',
    details: {},
    fingerprint: null,
    retiredReason: null,
    createdBy: null,
    createdAt: '2026-11-05T00:00:00Z',
    updatedAt: '2026-11-05T00:00:00Z',
  }
}

describe('canonicalSequence', () => {
  it('gives a circle the same text from any start and either strand', () => {
    const plasmid = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG'
    const rotated = plasmid.slice(11) + plasmid.slice(0, 11)
    const reverse = plasmid
      .split('')
      .reverse()
      .map((c) => ({ A: 'T', T: 'A', G: 'C', C: 'G' })[c] ?? c)
      .join('')
    const base = canonicalSequence(plasmid, 'dna', 'circular')
    expect(canonicalSequence(rotated, 'dna', 'circular')).toBe(base)
    expect(canonicalSequence(reverse, 'dna', 'circular')).toBe(base)
  })

  it('keeps a linear sequence tied to its ends', () => {
    const a = canonicalSequence('AAACCCGGG', 'dna', 'linear')
    const b = canonicalSequence('CCCGGGAAA', 'dna', 'linear')
    expect(a).not.toBe(b)
  })

  it('ignores case, spaces and numbers', () => {
    expect(canonicalSequence('atg cca 12 ttg', 'dna', 'linear')).toBe(
      canonicalSequence('ATGCCATTG', 'dna', 'linear'),
    )
  })

  it('reads RNA as DNA and leaves protein alone', () => {
    expect(canonicalSequence('AUGC', 'rna', 'linear')).toBe(
      canonicalSequence('ATGC', 'dna', 'linear'),
    )
    expect(canonicalSequence('mkv', 'protein', 'linear')).toBe('MKV')
  })
})

describe('leastRotation', () => {
  it('finds the smallest rotation', () => {
    expect(leastRotation('BCA')).toBe('ABC')
    expect(leastRotation('CABCAB')).toBe('ABCABC')
    expect(leastRotation('A')).toBe('A')
  })
})

describe('entryFingerprint', () => {
  it('matches an antibody by vendor and catalogue number however it is typed', () => {
    expect(
      entryFingerprint('antibody', {
        vendor: 'Cell Signaling',
        catalogueNumber: '9101 S',
      }),
    ).toBe(
      entryFingerprint('antibody', {
        vendor: 'cell-signaling',
        catalogueNumber: '9101s',
      }),
    )
    expect(entryFingerprint('antibody', { vendor: 'Abcam' })).toBeNull()
  })

  it('uses the cell bank number for a cell line', () => {
    expect(entryFingerprint('cell_line', { externalId: 'CRL-3216' })).toBe(
      'ext:crl3216',
    )
    expect(entryFingerprint('cell_line', {})).toBeNull()
  })
})

describe('cleanDetails', () => {
  it('drops blanks and trims', () => {
    expect(cleanDetails({ a: ' x ', b: '  ', c: '' })).toEqual({ a: 'x' })
  })
})

describe('walkLineage', () => {
  const entries = ['a', 'b', 'c', 'd'].map(entry)
  const links: RegistryParentWire[] = [
    { entry_id: 'b', parent_id: 'a', role: 'vector' },
    { entry_id: 'c', parent_id: 'b', role: 'transfected_with' },
    { entry_id: 'c', parent_id: 'd', role: 'parent' },
  ]

  it('lists ancestors nearest first, once each', () => {
    const up = walkLineage('c', 'up', entries, links)
    expect(up.map((n) => [n.entry.id, n.depth])).toEqual([
      ['b', 1],
      ['d', 1],
      ['a', 2],
    ])
    expect(up[0].role).toBe('transfected_with')
  })

  it('lists descendants', () => {
    const down = walkLineage('a', 'down', entries, links)
    expect(down.map((n) => n.entry.id)).toEqual(['b', 'c'])
  })

  it('stops on a loop', () => {
    const looped = [...links, { entry_id: 'a', parent_id: 'c', role: 'parent' }]
    expect(walkLineage('a', 'down', entries, looped)).toHaveLength(2)
  })
})
