import { describe, expect, it } from 'vitest'

import {
  alignPair,
  alignRead,
  analysePrimer,
  autoAnnotate,
  checkRead,
  deleteRange,
  designPrimers,
  differences,
  digest,
  digestAndLigate,
  findBindingSites,
  findCuts,
  findOrfs,
  findGuides,
  NUCLEASES,
  optimiseCodons,
  translateCds,
  codonsFor,
  formatBp,
  gelBands,
  gibson,
  goldenGate,
  insertAt,
  mapSites,
  meltingTemp,
  parseAbif,
  reverseComplement,
  reverseComplementSequence,
  setOrigin,
  simulatePcr,
  trimByQuality,
  uniqueCutters,
  enzymeByName,
} from './index'

/** Deterministic pseudo-random DNA with no accidental long repeats. */
function randomDna(n: number, seed = 1): string {
  let x = seed
  let out = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out += 'ACGT'[(x >> 16) & 3]
  }
  return out
}

/** Random DNA with the given enzyme sites scrubbed out. */
function scrub(seq: string, sites: string[]): string {
  let s = seq
  for (const site of sites) {
    const rc = reverseComplement(site)
    while (s.includes(site)) s = s.replace(site, 'A'.repeat(site.length))
    while (s.includes(rc)) s = s.replace(rc, 'A'.repeat(rc.length))
  }
  return s
}

describe('restriction sites and digests', () => {
  it('finds EcoRI and cuts a linear sequence into three pieces', () => {
    const a = scrub(randomDna(200, 3), ['GAATTC'])
    const b = scrub(randomDna(300, 4), ['GAATTC'])
    const c = scrub(randomDna(100, 5), ['GAATTC'])
    const seq = a + 'GAATTC' + b + 'GAATTC' + c
    const cuts = findCuts(seq, 'linear', enzymeByName('EcoRI')!)
    expect(cuts.map((x) => x.top)).toEqual([201, 507])
    const frags = digest(seq, 'linear', ['EcoRI'])
    expect(frags.map((f) => f.size)).toEqual([201, 306, 105])
    // Sticky ends: AATT 5' overhang.
    expect(frags[0].right).toEqual({ kind: '5prime', sense: 'AATT' })
    expect(frags[1].left).toEqual({ kind: '5prime', sense: 'AATT' })
    expect(frags[1].seq.startsWith('AATTC')).toBe(true)
    expect(frags[0].seq.endsWith('GAATT')).toBe(true)
  })

  it('cuts a circle into as many pieces as it has cuts, summing to its length', () => {
    const base = scrub(randomDna(1000, 7), ['GGATCC', 'GAATTC'])
    const seq =
      base.slice(0, 100) +
      'GGATCC' +
      base.slice(100, 600) +
      'GAATTC' +
      base.slice(600)
    const frags = digest(seq, 'circular', ['BamHI', 'EcoRI'])
    expect(frags).toHaveLength(2)
    expect(frags.reduce((s, f) => s + f.size, 0)).toBe(seq.length)
    expect(frags.map((f) => f.size).sort((a, b) => a - b)).toEqual(
      [506, seq.length - 506].sort((a, b) => a - b),
    )
  })

  it('opens a circle with a single cut into one full-length piece', () => {
    const base = scrub(randomDna(500, 9), ['GGATCC'])
    const seq = base.slice(0, 250) + 'GGATCC' + base.slice(250)
    const frags = digest(seq, 'circular', ['BamHI'])
    expect(frags).toHaveLength(1)
    expect(frags[0].size).toBe(seq.length)
    expect(frags[0].left.sense).toBe('GATC')
  })

  it('finds a site that straddles the origin of a circle', () => {
    const base = scrub(randomDna(400, 11), ['GAATTC'])
    const seq = 'TTC' + base + 'GAA'
    expect(findCuts(seq, 'circular', enzymeByName('EcoRI')!)).toHaveLength(1)
    expect(findCuts(seq, 'linear', enzymeByName('EcoRI')!)).toHaveLength(0)
  })

  it('places Type IIS cuts outside the site and mirrors them on the other strand', () => {
    const base = scrub(randomDna(300, 13), ['GGTCTC', 'GAGACC'])
    const fwd = base.slice(0, 100) + 'GGTCTC' + 'A' + 'ATCG' + base.slice(100)
    const [cut] = findCuts(fwd, 'linear', enzymeByName('BsaI')!)
    expect(cut.strand).toBe(1)
    expect(cut.top).toBe(100 + 7)
    expect(cut.bottom).toBe(100 + 11)
    const rev = reverseComplement(fwd)
    const [rcut] = findCuts(rev, 'linear', enzymeByName('BsaI')!)
    expect(rcut.strand).toBe(-1)
    // The overhang is the four bases ATCG either way.
    const f = digest(fwd, 'linear', ['BsaI'])
    expect(f[1].left).toEqual({ kind: '5prime', sense: 'ATCG' })
    const r = digest(rev, 'linear', ['BsaI'])
    expect(r[0].right.sense).toBe('CGAT')
  })

  it('reports enzymes that cut once', () => {
    const base = scrub(randomDna(600, 15), ['GGATCC', 'GAATTC'])
    const seq = base.slice(0, 300) + 'GGATCC' + base.slice(300)
    const sites = mapSites(seq, 'circular', ['BamHI', 'EcoRI'])
    expect(uniqueCutters(sites).map((s) => s.enzyme.name)).toEqual(['BamHI'])
  })

  it('merges near-equal bands on a gel and orders them by size', () => {
    const bands = gelBands([3000, 1000, 1010, 500])
    expect(bands.map((b) => b.size)).toEqual([3000, 1010, 500])
    expect(bands[1].count).toBe(2)
    expect(bands[0].position).toBeLessThan(bands[1].position)
    expect(bands[1].position).toBeLessThan(bands[2].position)
  })
})

describe('primers', () => {
  it('melts a typical 20-mer between 50 and 70 °C and higher with more GC', () => {
    const at = meltingTemp('ATATATTAATATATTAATAT')
    const mid = meltingTemp('ATGCGTACGTTAGCAATGCC')
    const gc = meltingTemp('GCGCGGCCGCGCGGCCGCGC')
    expect(mid).toBeGreaterThan(50)
    expect(mid).toBeLessThan(70)
    expect(at).toBeLessThan(mid)
    expect(gc).toBeGreaterThan(mid)
  })

  it('raises Tm with length and salt', () => {
    const s = 'ATGCGTACGTTAGCAATGCCGATC'
    expect(meltingTemp(s)).toBeGreaterThan(meltingTemp(s.slice(0, 16)))
    expect(
      meltingTemp(s, { na: 150, mg: 1.5, dntp: 0.6, oligo: 500 }),
    ).toBeGreaterThan(
      meltingTemp(s, { na: 20, mg: 1.5, dntp: 0.6, oligo: 500 }),
    )
  })

  it('flags a self-complementary primer as a dimer and hairpin risk', () => {
    const r = analysePrimer('GCGCGAATTCGCGC')
    expect(r.warnings).toContain('selfDimer')
    const hp = analysePrimer('GGGCGCAAAAGCGCCC')
    expect(hp.hairpin.stem).toBeGreaterThanOrEqual(5)
    expect(hp.warnings).toContain('hairpin')
  })

  it('accepts a well-behaved primer without warnings', () => {
    const r = analysePrimer('TCGTACAGGCTAACTGATCC')
    expect(r.gc).toBe(50)
    expect(r.warnings).toEqual([])
    expect(r.warnings).not.toContain('selfDimer')
  })

  it('designs pairs that flank a target and respect size and Tm limits', () => {
    const t = randomDna(1200, 21)
    const pairs = designPrimers(t, { start: 300, end: 800 }, {}, { flank: 60 })
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.forward.start).toBeLessThanOrEqual(300)
      expect(p.reverse.end).toBeGreaterThanOrEqual(800)
      expect(p.tmDiff).toBeLessThanOrEqual(3)
      expect(p.forward.tm).toBeGreaterThan(53)
      expect(p.forward.tm).toBeLessThan(67)
      expect(t.slice(p.forward.start, p.forward.end)).toBe(p.forward.seq)
      expect(reverseComplement(t.slice(p.reverse.start, p.reverse.end))).toBe(
        p.reverse.seq,
      )
    }
  })

  it('simulates PCR including a 5 prime tail', () => {
    const t = randomDna(900, 23)
    const fwd = t.slice(100, 120)
    const rev = reverseComplement(t.slice(580, 600))
    const [plain] = simulatePcr(t, fwd, rev, false)
    expect(plain.size).toBe(500)
    expect(plain.seq).toBe(t.slice(100, 600))
    const [tailed] = simulatePcr(t, 'GAATTC' + fwd, rev, false)
    expect(tailed.size).toBe(506)
    expect(tailed.seq.startsWith('GAATTC')).toBe(true)
    expect(findBindingSites(t, fwd, false)[0].strand).toBe(1)
  })

  it('amplifies across the origin of a circle', () => {
    const t = randomDna(600, 29)
    const fwd = t.slice(560, 580)
    const rev = reverseComplement(t.slice(80, 100))
    const [p] = simulatePcr(t, fwd, rev, true)
    expect(p.size).toBe(40 + 100)
    expect(p.seq).toBe(t.slice(560) + t.slice(0, 100))
  })
})

describe('alignment', () => {
  it('aligns identical sequences with full identity', () => {
    const s = randomDna(80, 31)
    const a = alignPair(s, s, { mode: 'global' })
    expect(a.identity).toBe(1)
    expect(a.gaps).toBe(0)
  })

  it('reports a substitution, an insertion and a deletion', () => {
    const ref = randomDna(200, 33)
    const sub = ref.slice(0, 50) + (ref[50] === 'A' ? 'C' : 'A') + ref.slice(51)
    const m = differences(alignPair(ref, sub, { mode: 'global' }))
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ kind: 'mismatch', refPos: 50 })
    const ins = ref.slice(0, 100) + 'GGG' + ref.slice(100)
    const i = differences(alignPair(ref, ins, { mode: 'global' }))
    expect(i.some((d) => d.kind === 'insertion' && d.query.length === 3)).toBe(
      true,
    )
    const del = ref.slice(0, 100) + ref.slice(104)
    const d = differences(alignPair(ref, del, { mode: 'global' }))
    expect(d.some((x) => x.kind === 'deletion' && x.ref.length === 4)).toBe(
      true,
    )
  })

  it('places a reverse-strand read on a larger reference', () => {
    const ref = randomDna(9000, 35)
    const read = reverseComplement(ref.slice(4000, 4600))
    const aln = alignRead(ref, read, false)!
    expect(aln.strand).toBe(-1)
    expect(aln.refStart).toBeGreaterThanOrEqual(3990)
    expect(aln.refStart).toBeLessThanOrEqual(4010)
    expect(aln.identity).toBeGreaterThan(0.99)
  })

  it('returns null for an unrelated read', () => {
    expect(alignRead(randomDna(3000, 37), randomDna(300, 39), false)).toBeNull()
  })
})

describe('assembly', () => {
  const enzymeSites = (s: string) =>
    scrub(s, ['GGTCTC', 'GAGACC', 'CGTCTC', 'GAGACG'])

  it('ligates an insert into a vector with two enzymes in the right orientation', () => {
    const v1 = scrub(randomDna(400, 41), ['GAATTC', 'GGATCC'])
    const v2 = scrub(randomDna(400, 42), ['GAATTC', 'GGATCC'])
    const vector = v1 + 'GAATTCAAGGATCC' + v2
    const i1 = scrub(randomDna(300, 43), ['GAATTC', 'GGATCC'])
    const insert = 'TT' + 'GAATTC' + i1 + 'GGATCC' + 'TT'
    const { products } = digestAndLigate([
      {
        part: { id: 'v', name: 'vector', seq: vector, topology: 'circular' },
        enzymes: ['EcoRI', 'BamHI'],
        pick: 'largest',
      },
      {
        part: { id: 'i', name: 'insert', seq: insert, topology: 'linear' },
        enzymes: ['EcoRI', 'BamHI'],
        pick: [0],
      },
    ])
    const circ = products.filter((p) => p.topology === 'circular')
    expect(circ.length).toBeGreaterThan(0)
    const expected = v1 + 'GAATTC' + i1 + 'GGATCC' + v2
    const sameCircle = (a: string, b: string) =>
      a.length === b.length && (a + a).includes(b)
    const matches = circ.some(
      (p) =>
        sameCircle(p.seq, expected) ||
        sameCircle(p.seq, reverseComplement(expected)),
    )
    expect(matches).toBe(true)
  })

  it('assembles parts by Golden Gate with BsaI and drops the sites', () => {
    const bb = 'A' + enzymeSites(randomDna(598, 51)) + 'A'
    const mk = (up: string, body: string, down: string) =>
      `GGTCTCA${up}${body}${down}AGAGACC`
    // Overhangs: vector acceptor ATGA ... CTCG; parts chain ATGA -> GCTT -> TAGC -> CTCG.
    const p1 = mk('ATGA', 'A' + enzymeSites(randomDna(118, 52)) + 'A', 'GCTT')
    const p2 = mk('GCTT', 'A' + enzymeSites(randomDna(148, 53)) + 'A', 'TAGC')
    const p3 = mk('TAGC', 'A' + enzymeSites(randomDna(88, 54)) + 'A', 'CTCG')
    // Destination: the recognition sites sit on the dropout, facing out, so
    // the backbone loses them and keeps the overhangs ATGA ... CTCG.
    const dropout = 'A' + enzymeSites(randomDna(100, 55)) + 'A'
    const destination =
      bb.slice(0, 300) +
      'ATGA' +
      'A' +
      'GAGACC' +
      dropout +
      'GGTCTC' +
      'A' +
      'CTCG' +
      bb.slice(300)
    const { products } = goldenGate(
      [
        {
          id: 'dest',
          name: 'destination',
          seq: destination,
          topology: 'circular',
        },
        { id: 'p1', name: 'part 1', seq: p1, topology: 'linear' },
        { id: 'p2', name: 'part 2', seq: p2, topology: 'linear' },
        { id: 'p3', name: 'part 3', seq: p3, topology: 'linear' },
      ],
      'BsaI',
    )
    expect(products.length).toBeGreaterThan(0)
    const prod = products[0]
    expect(prod.topology).toBe('circular')
    expect(prod.parts.map((p) => p.partId).sort()).toEqual([
      'dest',
      'p1',
      'p2',
      'p3',
    ])
    const flat = (s: string) => s + s
    expect(flat(prod.seq).includes('GGTCTC')).toBe(false)
    expect(flat(prod.seq).includes('GAGACC')).toBe(false)
    // Product holds the three bodies joined by the designed overhangs.
    const body = (p: string) => p.slice(11, p.length - 11)
    void body
    const joined = prod.seq + prod.seq
    expect(joined.includes('GCTT')).toBe(true)
    expect(joined.includes('TAGC')).toBe(true)
    // Length: backbone (300+300) + overhang CTCG/ATGA + three bodies and junction overhangs.
    expect(prod.seq.length).toBe(600 + 120 + 150 + 90 + 4 * 4)
  })

  it('assembles by Gibson into a circle and finds the order and orientation', () => {
    const o1 = randomDna(25, 61)
    const o2 = randomDna(25, 62)
    const o3 = randomDna(25, 63)
    const a = o3 + randomDna(200, 64) + o1
    const b = o1 + randomDna(250, 65) + o2
    const c = o2 + randomDna(150, 66) + o3
    const { products } = gibson([
      { id: 'a', name: 'A', seq: a, topology: 'linear' },
      {
        id: 'c',
        name: 'C (flipped)',
        seq: reverseComplement(c),
        topology: 'linear',
      },
      { id: 'b', name: 'B', seq: b, topology: 'linear' },
    ])
    const circ = products.find((p) => p.topology === 'circular')!
    expect(circ.seq.length).toBe(a.length + b.length + c.length - 3 * 25)
    expect(circ.parts.map((p) => p.partId)).toEqual(['a', 'b', 'c'])
    expect(circ.parts[2].strand).toBe(-1)
    expect(circ.junctions).toHaveLength(3)
    expect(circ.junctions.every((j) => j.seq.length === 25)).toBe(true)
  })

  it('carries features through a Gibson assembly', () => {
    const o = randomDna(24, 71)
    const x = randomDna(300, 72) + o
    const y = o + randomDna(300, 73)
    const { products } = gibson(
      [
        {
          id: 'x',
          name: 'X',
          seq: x,
          topology: 'linear',
          features: [
            {
              id: 1,
              type: 'CDS',
              label: 'geneX',
              strand: 1,
              parts: [{ start: 11, end: 100 }],
              start: 11,
              end: 100,
              qualifiers: {},
            },
          ],
        },
        {
          id: 'y',
          name: 'Y',
          seq: y,
          topology: 'linear',
          features: [
            {
              id: 1,
              type: 'CDS',
              label: 'geneY',
              strand: 1,
              parts: [{ start: 61, end: 150 }],
              start: 61,
              end: 150,
              qualifiers: {},
            },
          ],
        },
      ],
      { ordered: true },
    )
    const p = products.find((q) => q.topology === 'linear') ?? products[0]
    expect(p.features.map((f) => f.label)).toEqual(['geneX', 'geneY'])
    // geneY starts at 61 in Y, which is at 300 + 60 in the product.
    expect(p.features[1].start).toBe(300 + 61)
  })
})

describe('editing', () => {
  const seq = {
    residues: 'A'.repeat(10) + 'GATTACA' + 'C'.repeat(10),
    topology: 'linear' as const,
    features: [
      {
        id: 1,
        type: 'CDS',
        label: 'first',
        strand: 1 as const,
        parts: [{ start: 1, end: 5 }],
        start: 1,
        end: 5,
        qualifiers: {},
      },
      {
        id: 2,
        type: 'CDS',
        label: 'mid',
        strand: 1 as const,
        parts: [{ start: 11, end: 17 }],
        start: 11,
        end: 17,
        qualifiers: {},
      },
      {
        id: 3,
        type: 'CDS',
        label: 'last',
        strand: -1 as const,
        parts: [{ start: 20, end: 27 }],
        start: 20,
        end: 27,
        qualifiers: {},
      },
    ],
  }

  it('shifts later features when bases are inserted and grows ones it lands inside', () => {
    const r = insertAt(seq, 13, 'TTT')
    expect(r.sequence.residues.length).toBe(30)
    expect(r.sequence.features.find((f) => f.label === 'last')).toMatchObject({
      start: 23,
      end: 30,
    })
    expect(r.sequence.features.find((f) => f.label === 'mid')).toMatchObject({
      start: 11,
      end: 20,
    })
    expect(r.sequence.features.find((f) => f.label === 'first')).toMatchObject({
      start: 1,
      end: 5,
    })
  })

  it('removes features a deletion cuts through and reports them', () => {
    const r = deleteRange(seq, 8, 14)
    expect(r.removedFeatures).toEqual(['mid'])
    expect(r.sequence.features.find((f) => f.label === 'last')).toMatchObject({
      start: 14,
      end: 21,
    })
  })

  it('reverse-complements with features flipped', () => {
    const r = reverseComplementSequence(seq)
    expect(r.residues).toBe(reverseComplement(seq.residues))
    expect(r.features.find((f) => f.label === 'last')).toMatchObject({
      strand: 1,
      start: 1,
      end: 8,
    })
  })

  it('moves the origin of a circle and splits features that now cross it', () => {
    const c = { ...seq, topology: 'circular' as const }
    const r = setOrigin(c, 13)
    expect(r.residues).toBe(seq.residues.slice(13) + seq.residues.slice(0, 13))
    const mid = r.features.find((f) => f.label === 'mid')!
    expect(mid.parts).toEqual([
      { start: 25, end: 27 },
      { start: 1, end: 4 },
    ])
    expect(mid.start).toBe(25)
    expect(mid.end).toBe(4)
  })
})

describe('annotation', () => {
  it('finds library elements on either strand and does not repeat existing ones', () => {
    const seq =
      randomDna(100, 81) +
      'TAATACGACTCACTATAG' +
      randomDna(50, 82) +
      reverseComplement('GACTACAAGGACGACGATGACAAG') +
      randomDna(50, 83)
    const found = autoAnnotate(seq, 'linear', [])
    const labels = found.map((f) => `${f.label}:${f.strand}`)
    expect(labels).toContain('T7 promoter:1')
    expect(labels).toContain('FLAG:-1')
    const again = autoAnnotate(
      seq,
      'linear',
      found.map((f, i) => ({ ...f, id: i + 1 })),
    )
    expect(again.filter((f) => f.type !== 'CDS')).toHaveLength(0)
  })

  it('finds open reading frames of the minimum length on both strands', () => {
    const codons = 'GCT'.repeat(100)
    const fwd = 'ATG' + codons + 'TAA'
    const seq = 'CC' + fwd + 'CC' + reverseComplement(fwd) + 'CC'
    const orfs = findOrfs(seq, 90)
    expect(orfs).toHaveLength(2)
    expect(orfs.map((o) => o.strand).sort()).toEqual([-1, 1])
    expect(orfs[0].aminoAcids).toBe(101)
  })
})

// A minimal ABIF writer for tests.
function buildAbif(bases: string, quality: number[]): Uint8Array {
  const entries: {
    tag: string
    num: number
    type: number
    elemSize: number
    count: number
    data: Uint8Array
  }[] = []
  const enc = (s: string) => new TextEncoder().encode(s)
  const shorts = (a: number[]) => {
    const b = new Uint8Array(a.length * 2)
    const v = new DataView(b.buffer)
    a.forEach((x, i) => v.setInt16(i * 2, x))
    return b
  }
  const peaks = bases.split('').map((_, i) => 10 + i * 8)
  const total = peaks[peaks.length - 1] + 10
  const chan = (letter: string) =>
    Array.from({ length: total }, (_, p) => {
      const i = peaks.findIndex((x) => Math.abs(x - p) <= 2)
      return i >= 0 && bases[i] === letter ? 500 : 0
    })
  entries.push({
    tag: 'PBAS',
    num: 2,
    type: 2,
    elemSize: 1,
    count: bases.length,
    data: enc(bases),
  })
  entries.push({
    tag: 'PCON',
    num: 2,
    type: 1,
    elemSize: 1,
    count: quality.length,
    data: Uint8Array.from(quality),
  })
  entries.push({
    tag: 'PLOC',
    num: 2,
    type: 4,
    elemSize: 2,
    count: peaks.length,
    data: shorts(peaks),
  })
  entries.push({
    tag: 'FWO_',
    num: 1,
    type: 2,
    elemSize: 1,
    count: 4,
    data: enc('GATC'),
  })
  entries.push({
    tag: 'SMPL',
    num: 1,
    type: 2,
    elemSize: 1,
    count: 6,
    data: enc('sample'),
  })
  ;['G', 'A', 'T', 'C'].forEach((l, i) =>
    entries.push({
      tag: 'DATA',
      num: 9 + i,
      type: 4,
      elemSize: 2,
      count: total,
      data: shorts(chan(l)),
    }),
  )
  let offset = 128
  const placed = entries.map((e) => {
    const at = e.data.length <= 4 ? -1 : offset
    if (at >= 0) offset += e.data.length + (e.data.length % 2)
    return { ...e, at }
  })
  const dirOffset = offset
  const out = new Uint8Array(dirOffset + entries.length * 28)
  const v = new DataView(out.buffer)
  out.set(enc('ABIF'), 0)
  v.setInt16(4, 101)
  out.set(enc('tdir'), 6)
  v.setInt32(10, 1)
  v.setInt16(14, 1023)
  v.setInt16(16, 28)
  v.setInt32(18, entries.length)
  v.setInt32(22, entries.length * 28)
  v.setInt32(26, dirOffset)
  placed.forEach((e, i) => {
    const p = dirOffset + i * 28
    out.set(enc(e.tag), p)
    v.setInt32(p + 4, e.num)
    v.setInt16(p + 8, e.type)
    v.setInt16(p + 10, e.elemSize)
    v.setInt32(p + 12, e.count)
    v.setInt32(p + 16, e.data.length)
    if (e.at >= 0) {
      v.setInt32(p + 20, e.at)
      out.set(e.data, e.at)
    } else out.set(e.data, p + 20)
  })
  return out
}

describe('ab1 traces and Sanger checks', () => {
  it('reads bases, qualities, peaks and channels from a trace file', () => {
    const bases = 'ACGTACGTTGCA'
    const q = [10, 12, 30, 40, 40, 41, 42, 40, 38, 30, 20, 9]
    const t = parseAbif(buildAbif(bases, q))
    expect(t.bases).toBe(bases)
    expect(t.quality).toEqual(q)
    expect(t.name).toBe('sample')
    expect(t.peaks).toHaveLength(12)
    expect(t.channels.A.length).toBeGreaterThan(50)
    expect(t.channels.A[t.peaks[0]]).toBe(500)
    expect(t.channels.C[t.peaks[1]]).toBe(500)
  })

  it('rejects something that is not a trace', () => {
    expect(() => parseAbif(new Uint8Array(200))).toThrow(/not an ABI/)
  })

  it('trims low-quality ends', () => {
    const q = [
      ...Array(10).fill(5),
      ...Array(40).fill(40),
      ...Array(10).fill(6),
    ]
    const { start, end } = trimByQuality(q)
    expect(start).toBeGreaterThanOrEqual(4)
    expect(start).toBeLessThanOrEqual(8)
    expect(end).toBeGreaterThanOrEqual(52)
    expect(end).toBeLessThanOrEqual(56)
  })

  const construct = randomDna(1500, 91)
  const readFrom = (
    from: number,
    len: number,
    edit?: (s: string) => string,
    q = 45,
  ) => {
    let r = construct.slice(from, from + len)
    if (edit) r = edit(r)
    return { name: 'read', bases: r, quality: Array(r.length).fill(q) }
  }

  it('passes a clean read and reports where it covers', () => {
    const c = checkRead(construct, 'circular', [], readFrom(100, 600))
    expect(c.verdict).toBe('matches')
    expect(c.covers).toEqual({ start: 101, end: 700 })
    expect(c.identity).toBe(1)
  })

  it('fails a read with a confident substitution and names the feature it lands in', () => {
    const feat = {
      id: 1,
      type: 'CDS',
      label: 'KanR',
      strand: 1 as const,
      parts: [{ start: 300, end: 400 }],
      start: 300,
      end: 400,
      qualifiers: {},
    }
    const read = readFrom(
      200,
      500,
      (s) => s.slice(0, 150) + (s[150] === 'A' ? 'G' : 'A') + s.slice(151),
    )
    const c = checkRead(construct, 'circular', [feat], read)
    expect(c.verdict).toBe('mismatch')
    expect(c.differences).toHaveLength(1)
    expect(c.differences[0]).toMatchObject({
      kind: 'mismatch',
      position: 351,
      confirmed: true,
      features: ['KanR'],
    })
  })

  it('asks for review when the only differences are at low quality', () => {
    const read = readFrom(
      200,
      500,
      (s) => s.slice(0, 250) + (s[250] === 'A' ? 'G' : 'A') + s.slice(251),
    )
    read.quality[250] = 12
    const c = checkRead(construct, 'circular', [], read)
    expect(c.verdict).toBe('review')
    expect(c.differences[0].confirmed).toBe(false)
  })

  it('handles a reverse-strand read with a deletion', () => {
    const read = readFrom(600, 500, (s) =>
      reverseComplement(s.slice(0, 200) + s.slice(203)),
    )
    const c = checkRead(construct, 'circular', [], read)
    expect(c.strand).toBe(-1)
    expect(c.verdict).toBe('mismatch')
    expect(
      c.differences.some(
        (d) => d.kind === 'deletion' && d.expected.length === 3,
      ),
    ).toBe(true)
  })

  it('reports no alignment for a read from somewhere else', () => {
    const c = checkRead(construct, 'circular', [], {
      name: 'x',
      bases: randomDna(400, 99),
      quality: Array(400).fill(40),
    })
    expect(c.verdict).toBe('noAlignment')
  })
})

describe('formatBp', () => {
  it('keeps trailing zeros of whole kilobases', () => {
    expect(formatBp(10000)).toBe('10 kb')
    expect(formatBp(1000)).toBe('1 kb')
    expect(formatBp(2640)).toBe('2.64 kb')
    expect(formatBp(1500)).toBe('1.5 kb')
    expect(formatBp(43)).toBe('43 bp')
  })
})

describe('crispr guides', () => {
  const guideSeq = 'AAAA' + 'GACGTCAGCTAGCTAGGATC' + 'TGG' + 'CCCCATATATGCGCGTA'
  it('finds a guide next to an NGG PAM and says where it cuts', () => {
    const guides = findGuides(guideSeq, 'linear', NUCLEASES[0])
    const g = guides.find((x) => x.protospacer === 'GACGTCAGCTAGCTAGGATC')
    expect(g).toBeTruthy()
    expect(g?.pam).toBe('TGG')
    expect(g?.strand).toBe(1)
    expect(g?.start).toBe(5)
    expect(g?.end).toBe(24)
    expect(g?.cutAfter).toBe(21)
  })
  it('finds the same site from the other strand', () => {
    const guides = findGuides(
      reverseComplement(guideSeq),
      'linear',
      NUCLEASES[0],
    )
    const g = guides.find((x) => x.protospacer === 'GACGTCAGCTAGCTAGGATC')
    expect(g?.strand).toBe(-1)
  })
  it('flags a terminator and counts a repeat as an off target', () => {
    const t = 'GTTTTCAGCTAGCTAGGATC' + 'TGG'
    const g = findGuides(t + 'AA' + t, 'linear', NUCLEASES[0])
    expect(g[0].warnings).toContain('terminator')
    expect(g[0].offTargets[0]).toBeGreaterThan(0)
  })
  it('uses the PAM first for Cas12a', () => {
    const s = 'CC' + 'TTTA' + 'GACGTCAGCTAGCTAGGATCTAG' + 'CCCC'
    const g = findGuides(s, 'linear', NUCLEASES[2])
    expect(g[0].protospacer).toBe('GACGTCAGCTAGCTAGGATCTAG')
    expect(g[0].pam).toBe('TTTA')
  })
})

describe('codon optimisation', () => {
  const protein =
    'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV'
  it('keeps the protein and raises the adaptation index', () => {
    const r = optimiseCodons({ protein }, { host: 'ecoli' })
    expect(translateCds(r.dna.slice(0, -3))).toBe(protein)
    expect(r.caiAfter).toBeGreaterThan(0.8)
    expect(r.dna.endsWith('TAA')).toBe(true)
  })
  it('improves a poorly adapted coding sequence and counts changes', () => {
    const rare = optimiseCodons({ protein }, { host: 'yeast' }).dna
    const poor = [...protein].map((a) => codonsFor(a).at(-1)).join('')
    const r = optimiseCodons({ dna: poor }, { host: 'yeast' })
    expect(r.caiAfter).toBeGreaterThan(r.caiBefore ?? 1)
    expect(r.changed).toBeGreaterThan(0)
    expect(rare.length).toBe(poor.length + 3)
  })
  it('removes a site the lab wants gone', () => {
    // GAATTC is likely made by GAA TTC (E, F) with the preferred codons.
    const r = optimiseCodons(
      { protein: 'MEFEFEFK' },
      { host: 'human', avoidEnzymes: ['EcoRI'] },
    )
    expect(r.dna).not.toContain('GAATTC')
    expect(translateCds(r.dna.slice(0, -3))).toBe('MEFEFEFK')
  })
  it('breaks long single-base runs', () => {
    const r = optimiseCodons(
      { protein: 'MKKKKKKKKK' },
      { host: 'ecoli', maxRun: 6 },
    )
    expect(/A{6,}/.test(r.dna)).toBe(false)
  })
})
