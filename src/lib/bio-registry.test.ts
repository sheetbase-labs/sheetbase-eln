import { describe, expect, it } from 'vitest'

import { canonicalSequence, leastRotation, walkLineage } from './bio-registry'
import type { LineageLink, RegistryEntry } from './bio-registry'

function entry(id: string): RegistryEntry {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    kind: 'construct',
    custom_fields: null,
    created_at: '2026-11-05T00:00:00Z',
    archived_at: null,
    metadata_version: 1,
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

describe('walkLineage', () => {
  const entries = ['a', 'b', 'c', 'd'].map(entry)

  const links: LineageLink[] = [
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
    const looped: LineageLink[] = [
      ...links,
      { entry_id: 'a', parent_id: 'c', role: 'parent' },
    ]

    expect(walkLineage('a', 'down', entries, looped)).toHaveLength(2)
  })
})
