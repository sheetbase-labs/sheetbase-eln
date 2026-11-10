/**
 * The inputs the shared test vectors run. `generate.ts` runs them through the
 * TypeScript sequence tool and writes `vectors.json`; the TypeScript test and the
 * Python test (`python/tests/test_vectors.py`) both replay that file and must agree.
 */
import { z } from 'zod'

const json = z.json()

type JsonValue = z.infer<typeof json>

export interface VectorCase {
  name: string
  input: Record<string, JsonValue>
}

/** Deterministic pseudo-random DNA. */
export function randomDna(n: number, seed = 1): string {
  let x = seed
  let out = ''

  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out += 'ACGT'[(x >> 16) & 3]
  }

  return out
}

const COMP = new Map(Object.entries({ A: 'T', T: 'A', G: 'C', C: 'G' }))

export const rc = (s: string): string =>
  Array.from(s)
    .reverse()
    .map((c) => COMP.get(c) ?? c)
    .join('')

function scrub(seq: string, sites: string[]): string {
  let s = seq

  for (const site of sites) {
    const r = rc(site)

    s = s.replaceAll(site, 'A'.repeat(site.length))
    s = s.replaceAll(r, 'A'.repeat(r.length))
  }

  return s
}

export function buildCases(): VectorCase[] {
  const cases: VectorCase[] = []

  const add = (name: string, input: Record<string, JsonValue>) =>
    cases.push({ name, input })

  // Restriction sites and digests.
  const plasmid = randomDna(3000, 7)
  add('sites circular all enzymes', { action: 'sites', sequence: plasmid })
  add('sites linear unique only', {
    action: 'sites',
    sequence: plasmid,
    topology: 'linear',
    uniqueOnly: true,
  })
  add('sites named enzymes with a FASTA header', {
    action: 'sites',
    sequence: '>my plasmid\n' + plasmid.slice(0, 800),
    enzymes: ['EcoRI', 'bsai', 'NotFound', 'XmnI', 'SfiI'],
  })
  add('sites across the origin', {
    action: 'sites',
    sequence: 'TTC' + randomDna(200, 3) + 'GAA',
    enzymes: ['EcoRI', 'MmeI', 'BsaI'],
  })
  add('digest circular two enzymes', {
    action: 'digest',
    sequence: plasmid,
    enzymes: ['EcoRI', 'HindIII', 'XhoI', 'NcoI', 'BamHI'],
  })
  add('digest linear Type IIS', {
    action: 'digest',
    sequence: plasmid,
    topology: 'linear',
    enzymes: ['BsaI', 'BbsI', 'SapI', 'MmeI', 'FokI'],
  })
  add('digest with no cuts', {
    action: 'digest',
    sequence: 'ACACACACACACAC',
    enzymes: ['EcoRI'],
  })
  add('digest degenerate and long sites', {
    action: 'digest',
    sequence: randomDna(2500, 5),
    enzymes: ['XmnI', 'BglI', 'SfiI', 'AlwNI', 'BstXI', 'AflIII', 'AluI'],
  })

  // Annotation.
  const annotated =
    randomDna(100, 81) +
    'TAATACGACTCACTATAG' +
    randomDna(50, 82) +
    rc('GACTACAAGGACGACGATGACAAG') +
    randomDna(50, 83) +
    'ATG' +
    'GCT'.repeat(100) +
    'TAA' +
    randomDna(40, 84) +
    rc('ATG' + 'GAA'.repeat(90) + 'TGA') +
    randomDna(30, 85)

  add('annotate library and ORFs', { action: 'annotate', sequence: annotated })
  add('annotate nothing', { action: 'annotate', sequence: randomDna(300, 9) })

  // Primers.
  const template = randomDna(1200, 21)
  add('primers flanking a region', {
    action: 'primers',
    sequence: template,
    topology: 'linear',
    start: 300,
    end: 800,
  })
  add('primers with tails and a target Tm', {
    action: 'primers',
    sequence: template,
    topology: 'linear',
    start: 200,
    end: 1000,
    targetTm: 62,
    maxProduct: 1500,
    forwardTail: 'GAATTC',
    reverseTail: 'ggatcc',
  })
  add('primers region outside', {
    action: 'primers',
    sequence: template,
    start: 100,
    end: 5000,
  })

  for (const p of [
    'TCGTACAGGCTAACTGATCC',
    'GCGCGAATTCGCGC',
    'GGGCGCAAAAGCGCCC',
    'ATATATTAATATATTAATAT',
    'ATGCGTACGTTAGCAATGCCGATCGTAGCTAGGCTAGCATCG',
    'AAAAAAGC',
    'GGGGGCCCCCGGGGGCCCCC',
    'ACGTAGCTAGCTAGCTAGCATCGATCGA',
  ])
    add(`check primer ${p}`, { action: 'check_primer', primer: p })
  const pcrT = randomDna(900, 23)
  add('pcr linear with tail', {
    action: 'pcr',
    template: pcrT,
    topology: 'linear',
    forward: 'GAATTC' + pcrT.slice(100, 120),
    reverse: rc(pcrT.slice(580, 600)),
  })
  const pcrC = randomDna(600, 29)
  add('pcr across the origin', {
    action: 'pcr',
    template: pcrC,
    topology: 'circular',
    forward: pcrC.slice(560, 580),
    reverse: rc(pcrC.slice(80, 100)),
  })
  add('pcr no product', {
    action: 'pcr',
    template: pcrC,
    forward: randomDna(22, 4),
    reverse: randomDna(22, 5),
  })

  // Assembly.
  const v1 = scrub(randomDna(400, 41), ['GAATTC', 'GGATCC'])
  const v2 = scrub(randomDna(400, 42), ['GAATTC', 'GGATCC'])
  const i1 = scrub(randomDna(300, 43), ['GAATTC', 'GGATCC'])
  add('assemble digest and ligate', {
    action: 'assemble',
    method: 'ligation',
    parts: [
      {
        name: 'vector',
        sequence: v1 + 'GAATTCAAGGATCC' + v2,
        topology: 'circular',
        enzymes: ['EcoRI', 'BamHI'],
        pick: 'largest',
      },
      {
        name: 'insert',
        sequence: 'TT' + 'GAATTC' + i1 + 'GGATCC' + 'TT',
        topology: 'linear',
        enzymes: ['EcoRI', 'BamHI'],
        pick: [0],
      },
    ],
  })

  const sites = (s: string) =>
    scrub(s, ['GGTCTC', 'GAGACC', 'CGTCTC', 'GAGACG'])

  const mk = (up: string, body: string, down: string) =>
    `GGTCTCA${up}${body}${down}AGAGACC`

  const bb = 'A' + sites(randomDna(598, 51)) + 'A'
  const dropout = 'A' + sites(randomDna(100, 55)) + 'A'
  add('assemble golden gate', {
    action: 'assemble',
    method: 'golden_gate',
    enzyme: 'BsaI',
    parts: [
      {
        name: 'destination',
        topology: 'circular',
        sequence:
          bb.slice(0, 300) +
          'ATGAAGAGACC' +
          dropout +
          'GGTCTCACTCG' +
          bb.slice(300),
      },
      {
        name: 'part 1',
        sequence: mk('ATGA', 'A' + sites(randomDna(118, 52)) + 'A', 'GCTT'),
      },
      {
        name: 'part 2',
        sequence: mk('GCTT', 'A' + sites(randomDna(148, 53)) + 'A', 'TAGC'),
      },
      {
        name: 'part 3',
        sequence: mk('TAGC', 'A' + sites(randomDna(88, 54)) + 'A', 'CTCG'),
      },
    ],
  })
  add('assemble golden gate unknown enzyme', {
    action: 'assemble',
    method: 'golden_gate',
    enzyme: 'NopeI',
    parts: [{ name: 'a', sequence: randomDna(100, 1) }],
  })
  add('assemble golden gate without an enzyme', {
    action: 'assemble',
    method: 'golden_gate',
    parts: [{ name: 'a', sequence: randomDna(100, 1) }],
  })
  const o1 = randomDna(25, 61)
  const o2 = randomDna(25, 62)
  const o3 = randomDna(25, 63)
  const a = o3 + randomDna(200, 64) + o1
  const b = o1 + randomDna(250, 65) + o2
  const c = o2 + randomDna(150, 66) + o3
  add('assemble gibson circle with a flipped part', {
    action: 'assemble',
    method: 'gibson',
    parts: [
      { name: 'A', sequence: a },
      { name: 'C (flipped)', sequence: rc(c) },
      { name: 'B', sequence: b },
    ],
  })
  add('assemble gibson linear', {
    action: 'assemble',
    method: 'gibson',
    parts: [
      { name: 'A', sequence: o3 + randomDna(200, 64) + o1 },
      { name: 'B', sequence: o1 + randomDna(250, 65) },
    ],
  })
  add('assemble gibson no overlaps', {
    action: 'assemble',
    method: 'gibson',
    parts: [
      { name: 'A', sequence: randomDna(100, 71) },
      { name: 'B', sequence: randomDna(100, 72) },
    ],
  })

  // Alignment.
  const ref = randomDna(400, 33)
  add('align identical global', {
    action: 'align',
    reference: ref,
    query: ref,
    mode: 'global',
  })
  add('align substitution insertion deletion', {
    action: 'align',
    reference: ref,
    query:
      ref.slice(0, 100) +
      'A' +
      ref.slice(101, 200) +
      'GGG' +
      ref.slice(200, 300) +
      ref.slice(305),
    mode: 'global',
  })
  add('align local read in reference', {
    action: 'align',
    reference: ref,
    query: randomDna(30, 5) + ref.slice(150, 300) + randomDna(30, 6),
  })
  add('align unrelated', {
    action: 'align',
    reference: randomDna(200, 2),
    query: randomDna(150, 3),
  })

  // CRISPR.
  const guideSeq = 'AAAA' + 'GACGTCAGCTAGCTAGGATC' + 'TGG' + 'CCCCATATATGCGCGTA'
  add('crispr spcas9 linear', {
    action: 'crispr',
    sequence: guideSeq,
    topology: 'linear',
  })
  add('crispr other strand', {
    action: 'crispr',
    sequence: rc(guideSeq),
    topology: 'linear',
  })
  const t = 'GTTTTCAGCTAGCTAGGATC' + 'TGG'
  add('crispr terminator and repeat', {
    action: 'crispr',
    sequence: t + 'AA' + t,
    topology: 'linear',
  })
  add('crispr cas12a', {
    action: 'crispr',
    sequence: 'CC' + 'TTTA' + 'GACGTCAGCTAGCTAGGATCTAG' + 'CCCC',
    topology: 'linear',
    nuclease: 'cas12a',
  })
  const big = randomDna(2000, 15)
  add('crispr sacas9 circular region', {
    action: 'crispr',
    sequence: big,
    nuclease: 'sacas9',
    start: 200,
    end: 1500,
    limit: 8,
  })
  add('crispr spcas9 circular many', {
    action: 'crispr',
    sequence: big,
    limit: 50,
  })

  // Codon optimisation.
  const protein =
    'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVV'

  for (const host of ['ecoli', 'human', 'yeast'])
    add(`codon protein ${host}`, {
      action: 'codon_optimise',
      sequence: protein,
      input: 'protein',
      host,
    })
  add('codon dna with enzymes avoided', {
    action: 'codon_optimise',
    sequence: 'ATG' + 'GAATTCGGATCC'.repeat(3) + 'AAAAAAAAAAAAAAAGGATCCTAA',
    input: 'dna',
    host: 'ecoli',
    avoidEnzymes: ['EcoRI', 'BamHI', 'BsaI'],
  })
  add('codon dna with runs', {
    action: 'codon_optimise',
    sequence: 'ATG' + 'AAA'.repeat(12) + 'GGG'.repeat(10),
    input: 'dna',
    host: 'human',
    maxRun: 4,
  })
  add('codon poor yeast dna', {
    action: 'codon_optimise',
    sequence: 'ATGCTTCTCCTACTGCGGCGACGCAGGCCGGGGCGAAGT',
    input: 'dna',
    host: 'yeast',
  })
  add('codon bad letter', {
    action: 'codon_optimise',
    sequence: 'MKTB',
    input: 'protein',
    host: 'ecoli',
  })
  add('codon not a whole number of codons', {
    action: 'codon_optimise',
    sequence: 'ATGCC',
    input: 'dna',
    host: 'ecoli',
  })

  // Sanger reads.
  const construct = randomDna(1500, 91)

  const sub = (s: string, at: number) =>
    s.slice(0, at) + (s[at] === 'A' ? 'G' : 'A') + s.slice(at + 1)

  const qstr = (n: number, q = 45, low: Record<number, number> = {}) =>
    Array.from({ length: n }, (_, i) =>
      String.fromCharCode(33 + (low[i] ?? q)),
    ).join('')

  const read1 = construct.slice(100, 700)
  add('check_read clean', {
    action: 'check_read',
    expected: construct,
    read: read1,
    quality: qstr(read1.length),
  })
  const read2 = sub(construct.slice(200, 700), 150)
  add('check_read confident substitution', {
    action: 'check_read',
    expected: construct,
    read: read2,
    quality: qstr(read2.length),
  })
  const read3 = sub(construct.slice(200, 700), 250)
  add('check_read low quality substitution', {
    action: 'check_read',
    expected: construct,
    read: read3,
    quality: qstr(read3.length, 45, { 250: 12 }),
  })
  const r4 = construct.slice(600, 1100)
  const read4 = rc(r4.slice(0, 200) + r4.slice(203))
  add('check_read reverse strand deletion', {
    action: 'check_read',
    expected: construct,
    read: read4,
    quality: qstr(read4.length),
  })
  add('check_read no alignment', {
    action: 'check_read',
    expected: construct,
    read: randomDna(400, 99),
  })
  const read6 = construct.slice(300, 800)
  const low: Record<number, number> = {}

  for (let i = 0; i < 12; i++) low[i] = 8

  for (let i = 480; i < 500; i++) low[i] = 6
  add('check_read poor ends are trimmed', {
    action: 'check_read',
    expected: construct,
    read: read6,
    quality: qstr(read6.length, 40, low),
  })
  add('check_read wrong quality length', {
    action: 'check_read',
    expected: construct,
    read: read6,
    quality: qstr(10),
  })

  const read8 =
    construct.slice(400, 600).slice(0, 100) + 'TTT' + construct.slice(500, 650)

  add('check_read insertion', {
    action: 'check_read',
    expected: construct,
    read: read8,
    quality: qstr(read8.length),
  })

  return cases
}

export interface FingerprintCase {
  residues: string
  molecule: 'dna' | 'rna' | 'protein'
  topology: 'linear' | 'circular'
}

export function fingerprintCases(): FingerprintCase[] {
  const plasmid = randomDna(900, 12)
  const cut = (s: string, at: number) => s.slice(at) + s.slice(0, at)
  const out: FingerprintCase[] = []

  for (const topology of ['linear', 'circular'] as const) {
    out.push({ residues: 'GATTACA', molecule: 'dna', topology })
    out.push({ residues: plasmid, molecule: 'dna', topology })
    out.push({ residues: cut(plasmid, 311), molecule: 'dna', topology })
    out.push({ residues: rc(plasmid), molecule: 'dna', topology })
    out.push({
      residues: cut(rc(plasmid), 77).toLowerCase(),
      molecule: 'dna',
      topology,
    })
    out.push({ residues: 'acg uug\nCC 12 AUG', molecule: 'rna', topology })
    out.push({ residues: 'ACGRYNKMSWBDHV', molecule: 'dna', topology })
    out.push({ residues: 'AAAAAA', molecule: 'dna', topology })
    out.push({ residues: 'A', molecule: 'dna', topology })
    out.push({ residues: '', molecule: 'dna', topology })
  }

  out.push({ residues: 'mkta yiak*', molecule: 'protein', topology: 'linear' })
  out.push({
    residues: randomDna(5000, 3),
    molecule: 'dna',
    topology: 'circular',
  })

  return out
}
