import { describe, expect, it } from 'vitest'

import { callSequenceTool, sequenceTool } from './sequence'

const PLASMID =
  'GAATTCGCTAGCAAGCTTGGATCCGTCGACCTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG'

describe('sequence tool', () => {
  it('is read only and described', () => {
    const tool = sequenceTool()
    expect(tool.annotations.readOnlyHint).toBe(true)
    expect(tool.name).toBe('sheetbase.sequence.analyse')
    expect(JSON.stringify(tool.inputSchema)).toContain('check_read')
  })

  it('maps sites and digests', () => {
    const sites = callSequenceTool({
      action: 'sites',
      sequence: PLASMID,
      topology: 'circular',
      enzymes: ['EcoRI', 'HindIII'],
    })
    expect(sites.ok).toBe(true)
    expect(JSON.stringify(sites.result)).toContain('EcoRI')
    const cut = callSequenceTool({
      action: 'digest',
      sequence: PLASMID,
      topology: 'circular',
      enzymes: ['EcoRI', 'BamHI'],
    })
    expect(cut.ok).toBe(true)
    const result = cut.result as { fragments: { size: number }[] }
    expect(result.fragments.reduce((n, f) => n + f.size, 0)).toBe(
      PLASMID.length,
    )
  })

  it('ignores a FASTA header and spaces', () => {
    const r = callSequenceTool({
      action: 'sites',
      sequence: `>pTest\n${PLASMID.slice(0, 40)} ${PLASMID.slice(40)}`,
      topology: 'circular',
      enzymes: ['EcoRI'],
    })
    expect(r.ok).toBe(true)
    expect((r.result as { length: number }).length).toBe(PLASMID.length)
  })

  it('refuses bad arguments with a message', () => {
    const r = callSequenceTool({ action: 'digest', sequence: 'ACGT' })
    expect(r.ok).toBe(false)
    expect(String(r.result)).toContain('Invalid arguments')
    expect(callSequenceTool({ action: 'nope' }).ok).toBe(false)
  })

  it('checks a read and reports a difference', () => {
    const expected = PLASMID
    const read = expected.slice(10, 70).replace(/A/, 'T')
    const r = callSequenceTool({
      action: 'check_read',
      expected,
      topology: 'circular',
      read,
    })
    expect(r.ok).toBe(true)
    expect((r.result as { differences: unknown[] }).differences.length).toBe(1)
  })

  it('rejects a quality string of the wrong length', () => {
    const r = callSequenceTool({
      action: 'check_read',
      expected: PLASMID,
      read: PLASMID.slice(0, 30),
      quality: 'IIII',
    })
    expect(r.ok).toBe(false)
  })

  it('assembles with Gibson', () => {
    const a = 'ATGCGTACGTTAGCTAGCTAGGATCCGATCGATTACGGCATCGATCGGA'
    const b = a.slice(-20) + 'TTGACCGGTAACGTTAGCCATGCAATCGGCTAGCTAGGCTA'
    const r = callSequenceTool({
      action: 'assemble',
      method: 'gibson',
      parts: [
        { name: 'A', sequence: a },
        { name: 'B', sequence: b },
      ],
    })
    expect(r.ok).toBe(true)
    const out = r.result as { products: { length: number }[] }
    expect(out.products.length).toBeGreaterThan(0)
  })
})

describe('crispr and codon actions', () => {
  it('finds guides and re-codes a protein', () => {
    const g = callSequenceTool({
      action: 'crispr',
      sequence: 'AAAAGACGTCAGCTAGCTAGGATCTGGCCCCATATATGCGCGTA',
      topology: 'linear',
    })
    expect(g.ok).toBe(true)
    expect(JSON.stringify(g.result)).toContain('GACGTCAGCTAGCTAGGATC')
    const c = callSequenceTool({
      action: 'codon_optimise',
      sequence: 'MKTAYIAKQR',
      input: 'protein',
      host: 'ecoli',
    })
    expect(c.ok).toBe(true)
    expect((c.result as { dna: string }).dna.length).toBe(33)
    expect(
      callSequenceTool({
        action: 'codon_optimise',
        sequence: 'ATGAA',
        input: 'dna',
        host: 'human',
      }).ok,
    ).toBe(false)
  })
})
