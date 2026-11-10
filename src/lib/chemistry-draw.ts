/**
 * Reading and drawing structures with OpenChemLib. It is a large library, so it
 * is loaded on first use and only where a drawing is shown or edited; the
 * notebook itself never imports it up front.
 */
import type * as OclModule from 'openchemlib'
import type { Molecule, Reaction } from 'openchemlib'

import type { DrawnComponent } from '#/lib/chemistry'

export type Ocl = typeof OclModule

let loading: Promise<Ocl> | null = null

/** The chemistry library, loaded once. */
export function loadOcl(): Promise<Ocl> {
  loading ??= import('openchemlib').then(
    // SAFETY: openchemlib ships a CommonJS build, so the dynamic import may put its exports under `default`; the ES module namespace is used when it does not.
    (module) => (module as { default?: Ocl }).default ?? module,
  )

  return loading
}

export interface MoleculeFacts {
  formula: string
  /** Average molecular weight in g/mol. */
  mw: number
  smiles: string
  /** Canonical code: the same molecule always gives the same one. */
  code: string
}

export function parseMolfile(ocl: Ocl, molfile: string): Molecule | null {
  if (!molfile.trim()) return null

  try {
    const molecule = ocl.Molecule.fromMolfile(molfile)

    return molecule.getAllAtoms() > 0 ? molecule : null
  } catch {
    return null
  }
}

/**
 * A reaction is kept in the library's own encoding: unlike an RXN file it keeps
 * the reagents drawn over the arrow.
 */
export function parseReaction(ocl: Ocl, drawing: string): Reaction | null {
  if (!drawing.trim()) return null

  try {
    const reaction = ocl.ReactionEncoder.decode(drawing, {
      mode: ocl.ReactionEncoder.INCLUDE_ALL,
    })

    return reaction && !reaction.isEmpty() ? reaction : null
  } catch {
    return null
  }
}

export function encodeReaction(ocl: Ocl, reaction: Reaction): string {
  return reaction.isEmpty()
    ? ''
    : (ocl.ReactionEncoder.encode(reaction, {
        keepAbsoluteCoordinates: true,
        mode: ocl.ReactionEncoder.INCLUDE_ALL,
      }) ?? '')
}

export function factsOf(molecule: Molecule): MoleculeFacts {
  const formula = molecule.getMolecularFormula()

  return {
    formula: formula.formula,
    mw: Number(formula.relativeWeight.toFixed(3)),
    smiles: molecule.toSmiles(),
    code: molecule.getIDCode(),
  }
}

export function moleculeFacts(ocl: Ocl, molfile: string): MoleculeFacts | null {
  const molecule = parseMolfile(ocl, molfile)

  return molecule ? factsOf(molecule) : null
}

/** The drawn molecules in a section; one that holds several pieces is split. */
function listOf(count: number, at: (i: number) => Molecule): Molecule[] {
  return Array.from({ length: count }, (_, i) => at(i))
    .flatMap((m) => {
      const pieces = m.getFragments()

      return pieces.length > 1 ? pieces : [m]
    })
    .filter((m) => m.getAllAtoms() > 0)
}

/** The molecules left of the arrow, over it, and right of it. */
export function reactionParts(reaction: Reaction) {
  return {
    reactants: listOf(reaction.getReactants(), (i) => reaction.getReactant(i)),
    reagents: listOf(reaction.getCatalysts(), (i) => reaction.getCatalyst(i)),
    products: listOf(reaction.getProducts(), (i) => reaction.getProduct(i)),
  }
}

/** What the table needs from a drawn reaction, in the order it is drawn. */
export function drawnComponents(ocl: Ocl, drawing: string): DrawnComponent[] {
  const reaction = parseReaction(ocl, drawing)

  if (!reaction) return []
  const parts = reactionParts(reaction)

  const describe = (
    role: DrawnComponent['role'],
    molecules: Molecule[],
  ): DrawnComponent[] =>
    molecules.map((molecule) => {
      const facts = factsOf(molecule)

      return {
        role,
        structureCode: facts.code,
        formula: facts.formula,
        mw: facts.mw,
      }
    })

  return [
    ...describe('reactant', parts.reactants),
    ...describe('reagent', parts.reagents),
    ...describe('product', parts.products),
  ]
}

/** The reaction as reaction SMILES, kept with the block so it can be found. */
export function reactionSmiles(ocl: Ocl, drawing: string): string {
  const reaction = parseReaction(ocl, drawing)

  return reaction ? reaction.toSmiles() : ''
}

// ---------------------------------------------------------------------------
// Pictures. Black becomes the text colour so a drawing reads in the dark theme.
// ---------------------------------------------------------------------------

const INK = /rgb\(0,\s*0,\s*0\)/g

function inkToText(svg: string): string {
  return svg.replace(INK, 'currentColor')
}

interface Picture {
  /** The SVG element's markup, sized by its own width and height. */
  markup: string
  width: number
  height: number
}

function pictureOf(molecule: Molecule, height: number): Picture {
  const markup = inkToText(
    molecule.toSVG(height * 2, height, undefined, {
      autoCrop: true,
      autoCropMargin: 4,
      suppressChiralText: true,
    }),
  )

  const width = Number(/width="([\d.]+)px"/.exec(markup)?.[1] ?? height)
  const h = Number(/height="([\d.]+)px"/.exec(markup)?.[1] ?? height)

  return { markup, width, height: h }
}

/** One structure as an SVG, or null when nothing is drawn. */
export function structureSvg(
  ocl: Ocl,
  molfile: string,
  height = 180,
): string | null {
  const molecule = parseMolfile(ocl, molfile)

  return molecule ? pictureOf(molecule, height).markup : null
}

const GAP = 16
const ARROW_MIN = 90

/** Places a nested picture at x, y. */
function place(picture: Picture, x: number, y: number): string {
  return picture.markup.replace(
    /<svg /,
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" `,
  )
}

/**
 * A reaction scheme as one SVG: reactants joined with +, an arrow with the
 * reagents over it, then the products.
 */
export function schemeSvg(ocl: Ocl, drawing: string): string | null {
  const reaction = parseReaction(ocl, drawing)

  if (!reaction) return null
  const { reactants, reagents, products } = reactionParts(reaction)
  const main = (list: Molecule[]) => list.map((m) => pictureOf(m, 130))
  const left = main(reactants)
  const right = main(products)
  const over = reagents.map((m) => pictureOf(m, 64))

  const rowHeight = Math.max(
    60,
    ...left.map((p) => p.height),
    ...right.map((p) => p.height),
  )

  const reagentWidth = over.reduce((sum, p) => sum + p.width + GAP, 0)
  const arrowLength = Math.max(ARROW_MIN, reagentWidth)
  const overHeight = Math.max(0, ...over.map((p) => p.height))
  // The arrow sits on the middle of the row; reagents stand on it.
  const above = Math.max(rowHeight / 2, overHeight ? overHeight + 8 : 0)
  const mid = above + 4
  const height = above + rowHeight / 2 + 8
  let x = 4
  const parts: string[] = []

  const row = (pictures: Picture[]) => {
    pictures.forEach((picture, index) => {
      if (index > 0) {
        parts.push(
          `<text x="${x + GAP / 2}" y="${mid + 6}" text-anchor="middle" font-size="20" fill="currentColor">+</text>`,
        )
        x += GAP
      }

      parts.push(place(picture, x, mid - picture.height / 2))
      x += picture.width
    })
  }

  row(left)
  x += GAP
  const arrowStart = x
  parts.push(
    `<line x1="${arrowStart}" y1="${mid}" x2="${arrowStart + arrowLength}" y2="${mid}" stroke="currentColor" stroke-width="1.5"/>`,
    `<polygon points="${arrowStart + arrowLength},${mid} ${arrowStart + arrowLength - 9},${mid - 5} ${arrowStart + arrowLength - 9},${mid + 5}" fill="currentColor"/>`,
  )
  let reagentX = arrowStart + (arrowLength - reagentWidth + GAP) / 2

  for (const picture of over) {
    parts.push(place(picture, reagentX, mid - 6 - picture.height))
    reagentX += picture.width + GAP
  }

  x = arrowStart + arrowLength + GAP
  row(right)
  const width = x + 4

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" role="img">${parts.join('')}</svg>`
}
