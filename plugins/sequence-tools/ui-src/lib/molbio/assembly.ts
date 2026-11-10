/**
 * Cloning in silico: digest and ligate, Golden Gate and Gibson assembly.
 * Each returns the product with its parts in order, so the product can be
 * registered with lineage to what it was built from.
 */
import { digest, findCuts } from './digest'
import type { Fragment, Topology } from './digest'
import { enzymeByName } from './enzymes'
import { reverseComplement } from './dna'
import { carryFeatures, renumber } from './features'
import { meltingTemp } from './primers'
import type { SequenceFeature } from '#/lib/sequence'

export interface AssemblyPart {
  id: string
  name: string
  seq: string
  topology: Topology
  features?: SequenceFeature[]
}

export interface PlacedPart {
  partId: string
  name: string
  strand: 1 | -1
  /** Span in the product (1-based, inclusive). */
  start: number
  end: number
}

export interface Junction {
  /** Overlap (Gibson) or overhang (ligation) bases. */
  seq: string
  /** Melting temperature of the overlap, for Gibson. */
  tm?: number
}

export interface AssemblyProduct {
  method: 'ligation' | 'golden_gate' | 'gibson'
  seq: string
  topology: Topology
  features: SequenceFeature[]
  parts: PlacedPart[]
  junctions: Junction[]
  warnings: string[]
}

export interface AssemblyResult {
  products: AssemblyProduct[]
  warnings: string[]
}

export type AssemblyWarning =
  | 'palindromicOverhang'
  | 'duplicateOverhang'
  | 'lowOverlapTm'
  | 'shortOverlap'
  | 'manyFragmentsFromPart'
  | 'noFragmentFromPart'
  | 'ambiguousOrder'
  | 'notLinear'

interface PieceSource {
  part: AssemblyPart
  frag: Fragment
}

interface Piece {
  src: PieceSource
  reverse: boolean
  seq: string
  left: Fragment['left']
  right: Fragment['right']
}

function oriented(src: PieceSource, reverse: boolean): Piece {
  if (!reverse)
    return {
      src,
      reverse,
      seq: src.frag.seq,
      left: src.frag.left,
      right: src.frag.right,
    }

  const flip = (e: Fragment['left']): Fragment['left'] => ({
    kind: e.kind,
    sense: reverseComplement(e.sense),
  })

  return {
    src,
    reverse,
    seq: reverseComplement(src.frag.seq),
    left: flip(src.frag.right),
    right: flip(src.frag.left),
  }
}

function endsJoin(a: Piece['right'], b: Piece['left']): boolean {
  return a.kind === b.kind && a.sense === b.sense
}

function isPalindrome(s: string): boolean {
  return s.length > 0 && reverseComplement(s) === s
}

/** Search for ways to join pieces end to end, every piece used once. */
function ligationOrders(
  sources: PieceSource[],
  opts: { circular: boolean; limit: number },
): Piece[][] {
  const results: Piece[][] = []

  if (sources.length === 0) return results
  const [first, ...rest] = sources
  const start = oriented(first, false)

  const recurse = (chain: Piece[], left: PieceSource[]) => {
    if (results.length >= opts.limit) return

    if (left.length === 0) {
      const last = chain[chain.length - 1]

      if (opts.circular ? endsJoin(last.right, chain[0].left) : true)
        results.push(chain)

      return
    }

    const last = chain[chain.length - 1]

    for (let i = 0; i < left.length; i++) {
      for (const reverse of [false, true]) {
        const p = oriented(left[i], reverse)

        if (endsJoin(last.right, p.left)) {
          recurse(
            [...chain, p],
            left.filter((_, k) => k !== i),
          )
        }
      }
    }
  }

  recurse([start], rest)

  return results
}

function build(
  method: AssemblyProduct['method'],
  chain: Piece[],
  circular: boolean,
): AssemblyProduct {
  let seq = chain[0].seq
  const parts: PlacedPart[] = []
  const junctions: Junction[] = []
  const features: SequenceFeature[] = []

  const place = (p: Piece, from: number, skipLeft: number) => {
    const src = p.src.part
    const frag = p.src.frag
    const len = frag.seq.length
    parts.push({
      partId: src.id,
      name: src.name,
      strand: p.reverse ? -1 : 1,
      start: from + skipLeft + 1,
      end: from + len,
    })
    features.push(
      ...carryFeatures(
        src.features ?? [],
        src.seq.length,
        src.topology === 'circular',
        frag.start,
        len,
        { reverse: p.reverse, skipLeft, offset: from },
      ),
    )
  }

  place(chain[0], 0, 0)

  for (let i = 1; i < chain.length; i++) {
    const p = chain[i]
    const overlap = p.left.sense.length
    const from = seq.length - overlap
    junctions.push({ seq: p.left.sense })
    seq += p.seq.slice(overlap)
    place(p, from, overlap)
  }

  const closing = chain[chain.length - 1].right.sense.length

  if (circular) {
    junctions.push({ seq: chain[0].left.sense })
    seq = seq.slice(0, seq.length - closing)

    const keep = (f: SequenceFeature) =>
      f.parts.every((p) => p.end <= seq.length)

    const kept = features.filter(keep)
    features.length = 0
    features.push(...kept)
    const lastPart = parts[parts.length - 1]
    lastPart.end = Math.min(lastPart.end, seq.length)
  }

  return {
    method,
    seq,
    topology: circular ? 'circular' : 'linear',
    features: renumber(features),
    parts,
    junctions,
    warnings: [],
  }
}

function checkOverhangs(chain: Piece[], product: AssemblyProduct) {
  const seen = new Map<string, number>()

  for (const j of product.junctions) {
    if (!j.seq) continue

    if (isPalindrome(j.seq)) product.warnings.push('palindromicOverhang')
    seen.set(j.seq, (seen.get(j.seq) ?? 0) + 1)
  }

  for (const [, count] of seen)
    if (count > 1) product.warnings.push('duplicateOverhang')
  void chain
}

export interface LigationInput {
  part: AssemblyPart
  enzymes: readonly string[]
  /** Which fragments of the digest to use: indices, or 'largest'/'smallest'. */
  pick: readonly number[] | 'largest' | 'smallest'
}

/** Fragments of a part's digest, largest first, so indices are stable. */
export function sortedFragments(
  part: AssemblyPart,
  enzymes: readonly string[],
): Fragment[] {
  return digest(part.seq, part.topology, enzymes).sort(
    (a, b) => b.size - a.size,
  )
}

/**
 * Classic digest and ligate: cut each part with its enzymes, take the chosen
 * fragments, and find the ways they join into a circular product (or linear
 * when `circular` is false).
 */
export function digestAndLigate(
  inputs: readonly LigationInput[],
  opts: { circular?: boolean; limit?: number } = {},
): AssemblyResult {
  const sources: PieceSource[] = []
  const warnings: string[] = []

  for (const input of inputs) {
    const frags = sortedFragments(input.part, input.enzymes)
    let chosen: Fragment[]

    if (input.pick === 'largest') chosen = frags.slice(0, 1)
    else if (input.pick === 'smallest') chosen = frags.slice(-1)
    else chosen = input.pick.map((i) => frags[i]).filter(Boolean)

    if (chosen.length === 0) warnings.push('noFragmentFromPart')

    for (const frag of chosen) sources.push({ part: input.part, frag })
  }

  const circular = opts.circular ?? true
  const orders = ligationOrders(sources, { circular, limit: opts.limit ?? 8 })

  const products = orders.map((chain) => {
    const p = build('ligation', chain, circular)
    checkOverhangs(chain, p)

    return p
  })

  return { products, warnings }
}

/** Does a fragment still carry a recognition site of the enzyme? */
function carriesSite(frag: Fragment, enzymeName: string): boolean {
  const e = enzymeByName(enzymeName)

  if (!e) return false

  return findCuts(frag.seq, 'linear', { ...e, top: 0, bottom: 0 }).length > 0
}

/**
 * Golden Gate: one Type IIS enzyme cuts every part; the pieces that have lost
 * their recognition sites and have sticky ends on both sides are the ones that
 * join. Order and orientation follow from the overhangs alone.
 */
export function goldenGate(
  parts: readonly AssemblyPart[],
  enzymeName: string,
  opts: { limit?: number } = {},
): AssemblyResult {
  const warnings: string[] = []
  const e = enzymeByName(enzymeName)

  if (!e) return { products: [], warnings: ['unknownEnzyme'] }
  const sources: PieceSource[] = []

  for (const part of parts) {
    const frags = digest(part.seq, part.topology, [enzymeName])

    const productive = frags.filter(
      (f) =>
        f.leftEnzyme !== null &&
        f.rightEnzyme !== null &&
        f.left.kind !== 'blunt' &&
        f.right.kind !== 'blunt' &&
        !carriesSite(f, enzymeName),
    )

    if (productive.length === 0) warnings.push('noFragmentFromPart')

    if (productive.length > 1) warnings.push('manyFragmentsFromPart')

    for (const frag of productive) sources.push({ part, frag })
  }

  const orders = ligationOrders(sources, {
    circular: true,
    limit: opts.limit ?? 8,
  })

  const products = orders.map((chain) => {
    const p = build('golden_gate', chain, true)
    checkOverhangs(chain, p)

    return p
  })

  if (products.length > 1) warnings.push('ambiguousOrder')

  return { products, warnings }
}

// --------------------------------------------------------------------------
// Gibson
// --------------------------------------------------------------------------

export interface GibsonOptions {
  minOverlap: number
  maxOverlap: number
  /** Leave the parts in the order given instead of searching for it. */
  ordered: boolean
  limit: number
}

export const DEFAULT_GIBSON: GibsonOptions = {
  minOverlap: 15,
  maxOverlap: 120,
  ordered: false,
  limit: 6,
}

/** Longest k with the end of `a` equal to the start of `b`. */
export function overlapLength(
  a: string,
  b: string,
  min: number,
  max: number,
): number {
  const top = Math.min(a.length, b.length, max)

  for (let k = top; k >= min; k--) {
    if (a.endsWith(b.slice(0, k))) return k
  }

  return 0
}

interface GPiece {
  part: AssemblyPart
  reverse: boolean
  seq: string
}

function gibsonPiece(part: AssemblyPart, reverse: boolean): GPiece {
  return {
    part,
    reverse,
    seq: reverse ? reverseComplement(part.seq) : part.seq,
  }
}

/**
 * Gibson assembly of linear parts that share end overlaps. Finds the order and
 * orientations (the first part is kept as given) that chain every part, and
 * closes the circle when the last overlaps the first.
 */
export function gibson(
  parts: readonly AssemblyPart[],
  options: Partial<GibsonOptions> = {},
): AssemblyResult {
  const o = { ...DEFAULT_GIBSON, ...options }
  const warnings: string[] = []
  const linear = parts.filter((p) => p.topology === 'linear')

  if (linear.length !== parts.length) warnings.push('notLinear')

  if (parts.length === 0) return { products: [], warnings }

  const chains: { chain: GPiece[]; overlaps: number[]; circular: boolean }[] =
    []

  const first = gibsonPiece(parts[0], false)

  const dfs = (chain: GPiece[], overlaps: number[], left: AssemblyPart[]) => {
    if (chains.length >= o.limit) return
    const last = chain[chain.length - 1]

    if (left.length === 0) {
      const close = overlapLength(
        last.seq,
        chain[0].seq,
        o.minOverlap,
        o.maxOverlap,
      )

      if (close > 0 && chain.length > 1)
        chains.push({ chain, overlaps: [...overlaps, close], circular: true })
      else if (chain.length === parts.length && close === 0)
        chains.push({ chain, overlaps, circular: false })

      return
    }

    const candidates = o.ordered ? [left[0]] : left

    for (const next of candidates) {
      for (const reverse of [false, true]) {
        const p = gibsonPiece(next, reverse)
        const k = overlapLength(last.seq, p.seq, o.minOverlap, o.maxOverlap)

        if (k > 0)
          dfs(
            [...chain, p],
            [...overlaps, k],
            left.filter((l) => l !== next),
          )
      }
    }
  }

  dfs([first], [], parts.slice(1))
  // Circular products first.
  chains.sort((a, b) => Number(b.circular) - Number(a.circular))

  const products: AssemblyProduct[] = chains.map(
    ({ chain, overlaps, circular }) => {
      let seq = chain[0].seq
      const placed: PlacedPart[] = []
      const features: SequenceFeature[] = []
      const junctions: Junction[] = []
      const productWarnings: string[] = []

      const addPiece = (p: GPiece, from: number, skipLeft: number) => {
        placed.push({
          partId: p.part.id,
          name: p.part.name,
          strand: p.reverse ? -1 : 1,
          start: from + skipLeft + 1,
          end: from + p.seq.length,
        })
        features.push(
          ...carryFeatures(
            p.part.features ?? [],
            p.part.seq.length,
            false,
            0,
            p.part.seq.length,
            { reverse: p.reverse, skipLeft, offset: from },
          ),
        )
      }

      addPiece(chain[0], 0, 0)

      for (let i = 1; i < chain.length; i++) {
        const k = overlaps[i - 1]
        const from = seq.length - k
        const ov = chain[i].seq.slice(0, k)
        junctions.push({ seq: ov, tm: meltingTemp(ov) })
        seq += chain[i].seq.slice(k)
        addPiece(chain[i], from, k)
      }

      if (circular) {
        const k = overlaps[overlaps.length - 1]
        const ov = chain[0].seq.slice(0, k)
        junctions.push({ seq: ov, tm: meltingTemp(ov) })
        seq = seq.slice(0, seq.length - k)
      }

      for (const j of junctions) {
        if (j.seq.length < 20) productWarnings.push('shortOverlap')

        if ((j.tm ?? 60) < 48) productWarnings.push('lowOverlapTm')
      }

      return {
        method: 'gibson' as const,
        seq,
        topology: circular ? ('circular' as const) : ('linear' as const),
        features: renumber(
          features.filter((f) => f.parts.every((q) => q.end <= seq.length)),
        ),
        parts: placed,
        junctions,
        warnings: [...new Set(productWarnings)],
      }
    },
  )

  if (products.length === 0) warnings.push('noAssembly')

  if (products.length > 1) warnings.push('ambiguousOrder')

  return { products, warnings }
}

/**
 * Overlap tails to add to PCR primers so adjacent parts will assemble by
 * Gibson: the last `overlap` bases of the previous part's end go on the 5'
 * side of the next part's forward primer, and so on around a circle.
 */
export function gibsonTails(
  ordered: readonly { name: string; seq: string }[],
  overlap = 20,
): { name: string; forwardTail: string; reverseTail: string }[] {
  const n = ordered.length

  return ordered.map((p, i) => {
    const prev = ordered[(i - 1 + n) % n].seq
    const next = ordered[(i + 1) % n].seq

    return {
      name: p.name,
      forwardTail: prev.slice(-overlap),
      reverseTail: reverseComplement(next.slice(0, overlap)),
    }
  })
}
