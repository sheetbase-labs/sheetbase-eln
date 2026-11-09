import { beforeAll, describe, expect, it } from 'vitest'

import {
  drawnComponents,
  encodeReaction,
  loadOcl,
  moleculeFacts,
  reactionSmiles,
  schemeSvg,
  structureSvg,
} from './chemistry-draw'
import type { Ocl } from './chemistry-draw'

let ocl: Ocl

beforeAll(async () => {
  ocl = await loadOcl()
})

const aspirinMolfile = () => {
  const molecule = ocl.Molecule.fromSmiles('CC(=O)Oc1ccccc1C(=O)O')
  molecule.inventCoordinates()

  return molecule.toMolfile()
}

const drawn = (smiles: string) => {
  const molecule = ocl.Molecule.fromSmiles(smiles)
  molecule.inventCoordinates()

  return molecule
}

/** Acetic acid and ethanol, with acid over the arrow, making ethyl acetate and water. */
const esterification = () => {
  const reaction = ocl.Reaction.fromMolecules(
    [drawn('CC(=O)O'), drawn('OCC')],
    2,
  )

  reaction.addCatalyst(drawn('[H+]'))
  reaction.addProduct(drawn('CC(=O)OCC'))
  reaction.addProduct(drawn('O'))

  return encodeReaction(ocl, reaction)
}

describe('moleculeFacts', () => {
  it('reads the formula, weight and SMILES from a drawing', () => {
    const facts = moleculeFacts(ocl, aspirinMolfile())!
    expect(facts.formula).toBe('C9H8O4')
    expect(facts.mw).toBeCloseTo(180.159, 2)
    expect(facts.smiles).toContain('=O')
    expect(facts.code.length).toBeGreaterThan(5)
  })

  it('gives the same code however the molecule was drawn', () => {
    const a = ocl.Molecule.fromSmiles('OCC')
    const b = ocl.Molecule.fromSmiles('CCO')
    a.inventCoordinates()
    b.inventCoordinates()
    expect(moleculeFacts(ocl, a.toMolfile())!.code).toBe(
      moleculeFacts(ocl, b.toMolfile())!.code,
    )
  })

  it('says nothing for an empty or broken drawing', () => {
    expect(moleculeFacts(ocl, '')).toBeNull()
    expect(moleculeFacts(ocl, 'not a molfile')).toBeNull()
  })
})

describe('drawnComponents', () => {
  it('lists reactants, reagents over the arrow and products in order', () => {
    const parts = drawnComponents(ocl, esterification())
    expect(parts.map((p) => [p.role, p.formula])).toEqual([
      ['reactant', 'C2H4O2'],
      ['reactant', 'C2H6O'],
      ['reagent', 'H'],
      ['product', 'C4H8O2'],
      ['product', 'H2O'],
    ])
    expect(parts[0].mw).toBeCloseTo(60.05, 1)
  })

  it('is empty before anything is drawn', () => {
    expect(drawnComponents(ocl, '')).toEqual([])
  })
})

describe('pictures', () => {
  it('draws a structure in the text colour so it reads in the dark theme', () => {
    const svg = structureSvg(ocl, aspirinMolfile())!
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('currentColor')
    expect(svg).not.toContain('rgb(0,0,0)')
    expect(structureSvg(ocl, '')).toBeNull()
  })

  it('draws a scheme with every molecule, plus signs and an arrow', () => {
    const svg = schemeSvg(ocl, esterification())!
    expect(svg.startsWith('<svg')).toBe(true)
    expect((svg.match(/<svg /g) ?? []).length).toBe(1 + 5)
    expect(svg).toContain('>+<')
    expect(svg).toContain('<polygon')
    expect(schemeSvg(ocl, '')).toBeNull()
  })

  it('gives reaction SMILES', () => {
    expect(reactionSmiles(ocl, esterification())).toBe(
      'CC(O)=O.CCO>[H+]>CCOC(C)=O.O',
    )
  })
})
