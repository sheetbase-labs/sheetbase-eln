import { beforeAll, describe, expect, it } from 'vitest'

import { loadOcl } from './chemistry-draw'
import type { Ocl } from './chemistry-draw'
import {
  containsSubstructure,
  describeStructure,
  fingerprintOf,
  propertiesOf,
  queryFragment,
  readStructure,
  similarityOf,
} from './compound-registry'

let ocl: Ocl
beforeAll(async () => {
  ocl = await loadOcl()
})

const ASPIRIN = 'CC(=O)Oc1ccccc1C(=O)O'

describe('describeStructure', () => {
  it('gives the same parent however a structure is written', () => {
    const a = describeStructure(ocl, ASPIRIN)
    const b = describeStructure(ocl, 'OC(=O)c1ccccc1OC(C)=O')
    expect(a?.parentCode).toBe(b?.parentCode)
    expect(a?.formula).toBe('C9H8O4')
    expect(a?.mass).toBeCloseTo(180.16, 1)
  })

  it('strips salts and solvents from the parent but keeps what was drawn', () => {
    const free = describeStructure(ocl, 'CN1CCC[C@H]1c1cccnc1')
    const salt = describeStructure(ocl, 'CN1CCC[C@H]1c1cccnc1.Cl.O')
    expect(salt?.parentCode).toBe(free?.parentCode)
    expect(salt?.drawnCode).not.toBe(free?.drawnCode)
    expect(salt?.salts.sort()).toEqual(['Cl', 'O'].sort())
    expect(salt?.fingerprint).toBe(free?.fingerprint)
  })

  it('keeps the largest piece as the parent whatever order it is drawn in', () => {
    const a = describeStructure(ocl, '[Na+].CC(=O)[O-]')
    const b = describeStructure(ocl, 'CC(=O)[O-].[Na+]')
    expect(a?.parentCode).toBe(b?.parentCode)
    expect(a?.salts).toEqual(['[Na+]'])
  })

  it('tells enantiomers apart', () => {
    const r = describeStructure(ocl, 'C[C@H](N)C(=O)O')
    const s = describeStructure(ocl, 'C[C@@H](N)C(=O)O')
    expect(r?.parentCode).not.toBe(s?.parentCode)
  })

  it('writes a 512-bit fingerprint as 128 hex digits', () => {
    expect(describeStructure(ocl, ASPIRIN)?.fingerprint).toMatch(
      /^[0-9a-f]{128}$/,
    )
  })

  it('returns a molfile for a SMILES line and keeps a molfile as given', () => {
    const fromSmiles = describeStructure(ocl, ASPIRIN)
    expect(fromSmiles?.molfile).toContain('M  END')
    const again = describeStructure(ocl, fromSmiles?.molfile ?? '')
    expect(again?.molfile).toBe(fromSmiles?.molfile)
    expect(again?.parentCode).toBe(fromSmiles?.parentCode)
  })

  it('is null for blank or unreadable text', () => {
    expect(describeStructure(ocl, '')).toBeNull()
    expect(readStructure(ocl, '   ')).toBeNull()
  })
})

describe('search', () => {
  let benzoicAcid: ReturnType<typeof describeStructure>
  let aspirin: ReturnType<typeof describeStructure>
  let caffeine: ReturnType<typeof describeStructure>
  beforeAll(() => {
    benzoicAcid = describeStructure(ocl, 'OC(=O)c1ccccc1')
    aspirin = describeStructure(ocl, ASPIRIN)
    caffeine = describeStructure(ocl, 'Cn1cnc2c1c(=O)n(C)c(=O)n2C')
  })

  it('a fragment fingerprint is contained in the fingerprint of what holds it', () => {
    const query = queryFragment(ocl, 'c1ccccc1C(=O)O')
    expect(query).not.toBeNull()
    const q = BigInt('0x' + fingerprintOf(ocl, query!))
    const target = BigInt('0x' + aspirin!.fingerprint)
    expect((target & q) === q).toBe(true)
  })

  it('confirms a substructure atom by atom', () => {
    const query = queryFragment(ocl, 'c1ccccc1C(=O)O')!
    expect(containsSubstructure(ocl, query, aspirin!.parentCode)).toBe(true)
    expect(containsSubstructure(ocl, query, benzoicAcid!.parentCode)).toBe(true)
    expect(containsSubstructure(ocl, query, caffeine!.parentCode)).toBe(false)
  })

  it('scores similar structures above unrelated ones', () => {
    const close = similarityOf(
      ocl,
      aspirin!.fingerprint,
      benzoicAcid!.fingerprint,
    )
    const far = similarityOf(ocl, aspirin!.fingerprint, caffeine!.fingerprint)
    expect(close).toBeGreaterThan(far)
    expect(similarityOf(ocl, aspirin!.fingerprint, aspirin!.fingerprint)).toBe(
      1,
    )
  })
})

describe('propertiesOf', () => {
  it('reads properties from a parent code', () => {
    const aspirin = describeStructure(ocl, ASPIRIN)!
    const p = propertiesOf(ocl, aspirin.parentCode)
    expect(p?.hbd).toBe(1)
    expect(p?.tpsa).toBeGreaterThan(50)
  })
})
