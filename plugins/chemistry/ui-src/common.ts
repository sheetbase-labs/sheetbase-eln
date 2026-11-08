import * as OclModule from 'openchemlib'
import type { Molecule } from 'openchemlib'
import './style.css'

export const OCL = ((OclModule as { default?: typeof OclModule }).default ??
  OclModule) as typeof OclModule

const INK = /rgb\(0,\s*0,\s*0\)/g

export function isMolfile(text: string): boolean {
  return /\bM {2}END\b|V2000|V3000/.test(text) || text.includes('\n')
}

/** A drawing, a molfile or a SMILES line as a molecule, or null if it is none. */
export function readStructure(text: string): Molecule | null {
  if (!text.trim()) return null
  try {
    const molecule = isMolfile(text)
      ? OCL.Molecule.fromMolfile(text)
      : OCL.Molecule.fromSmiles(text.trim())
    if (molecule.getAllAtoms() === 0) return null
    molecule.ensureHelperArrays(OCL.Molecule.cHelperParities)
    return molecule
  } catch {
    return null
  }
}

/** The molfile of a molecule, with coordinates invented for a SMILES line. */
export function molfileOf(text: string): string | null {
  const molecule = readStructure(text)
  if (!molecule) return null
  if (isMolfile(text)) return text
  const drawn = molecule.getCompactCopy()
  drawn.inventCoordinates()
  return drawn.toMolfile()
}

/** A picture in the current text colour, so it reads in light and dark. */
export function pictureSvg(
  molecule: Molecule,
  width: number,
  height: number,
): string {
  return molecule
    .toSVG(width, height, undefined, {
      autoCrop: true,
      autoCropMargin: 4,
      suppressChiralText: true,
    })
    .replace(INK, 'currentColor')
}

export function facts(molecule: Molecule): { formula: string; mass: number } {
  const formula = molecule.getMolecularFormula()
  return {
    formula: formula.formula,
    mass: Number(formula.relativeWeight.toFixed(3)),
  }
}

export function app(): HTMLElement {
  return document.getElementById('app')!
}
