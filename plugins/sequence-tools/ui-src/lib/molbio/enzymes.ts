/**
 * Common restriction enzymes. `site` is the recognition sequence (IUPAC),
 * `top` and `bottom` are where the top and bottom strands are cut, counted in
 * bases from the start of the site on the top strand. Bottom minus top is the
 * overhang: positive is a 5' overhang, negative a 3' overhang, zero is blunt.
 * Type IIS enzymes cut outside their site, so their numbers run past it.
 */
export interface Enzyme {
  name: string
  site: string
  top: number
  bottom: number
  /** Cuts outside its recognition site. */
  typeIIS?: boolean
  /** Cuts at all only when the site is not methylated (informational). */
  note?: string
}

export const ENZYMES: readonly Enzyme[] = [
  { name: 'EcoRI', site: 'GAATTC', top: 1, bottom: 5 },
  { name: 'BamHI', site: 'GGATCC', top: 1, bottom: 5 },
  { name: 'HindIII', site: 'AAGCTT', top: 1, bottom: 5 },
  { name: 'NotI', site: 'GCGGCCGC', top: 2, bottom: 6 },
  { name: 'XhoI', site: 'CTCGAG', top: 1, bottom: 5 },
  { name: 'XbaI', site: 'TCTAGA', top: 1, bottom: 5, note: 'dam-blocked' },
  { name: 'SpeI', site: 'ACTAGT', top: 1, bottom: 5 },
  { name: 'NcoI', site: 'CCATGG', top: 1, bottom: 5 },
  { name: 'NdeI', site: 'CATATG', top: 2, bottom: 4 },
  { name: 'NheI', site: 'GCTAGC', top: 1, bottom: 5 },
  { name: 'SalI', site: 'GTCGAC', top: 1, bottom: 5 },
  { name: 'KpnI', site: 'GGTACC', top: 5, bottom: 1 },
  { name: 'SacI', site: 'GAGCTC', top: 5, bottom: 1 },
  { name: 'SacII', site: 'CCGCGG', top: 4, bottom: 2 },
  { name: 'PstI', site: 'CTGCAG', top: 5, bottom: 1 },
  { name: 'SphI', site: 'GCATGC', top: 5, bottom: 1 },
  { name: 'ApaI', site: 'GGGCCC', top: 5, bottom: 1 },
  { name: 'SmaI', site: 'CCCGGG', top: 3, bottom: 3 },
  { name: 'XmaI', site: 'CCCGGG', top: 1, bottom: 5 },
  { name: 'EcoRV', site: 'GATATC', top: 3, bottom: 3 },
  { name: 'PvuII', site: 'CAGCTG', top: 3, bottom: 3 },
  { name: 'HpaI', site: 'GTTAAC', top: 3, bottom: 3 },
  { name: 'ScaI', site: 'AGTACT', top: 3, bottom: 3 },
  { name: 'StuI', site: 'AGGCCT', top: 3, bottom: 3 },
  { name: 'SwaI', site: 'ATTTAAAT', top: 4, bottom: 4 },
  { name: 'PmeI', site: 'GTTTAAAC', top: 4, bottom: 4 },
  { name: 'AscI', site: 'GGCGCGCC', top: 2, bottom: 6 },
  { name: 'PacI', site: 'TTAATTAA', top: 5, bottom: 3 },
  { name: 'FseI', site: 'GGCCGGCC', top: 6, bottom: 2 },
  { name: 'SbfI', site: 'CCTGCAGG', top: 6, bottom: 2 },
  { name: 'BglII', site: 'AGATCT', top: 1, bottom: 5 },
  { name: 'ClaI', site: 'ATCGAT', top: 2, bottom: 4, note: 'dam-blocked' },
  { name: 'MluI', site: 'ACGCGT', top: 1, bottom: 5 },
  { name: 'AgeI', site: 'ACCGGT', top: 1, bottom: 5 },
  { name: 'BsrGI', site: 'TGTACA', top: 1, bottom: 5 },
  { name: 'NsiI', site: 'ATGCAT', top: 5, bottom: 1 },
  { name: 'BspEI', site: 'TCCGGA', top: 1, bottom: 5 },
  { name: 'AvrII', site: 'CCTAGG', top: 1, bottom: 5 },
  { name: 'EagI', site: 'CGGCCG', top: 1, bottom: 5 },
  { name: 'BclI', site: 'TGATCA', top: 1, bottom: 5, note: 'dam-blocked' },
  { name: 'BstBI', site: 'TTCGAA', top: 2, bottom: 4 },
  { name: 'PvuI', site: 'CGATCG', top: 4, bottom: 2 },
  { name: 'SnaBI', site: 'TACGTA', top: 3, bottom: 3 },
  { name: 'DraI', site: 'TTTAAA', top: 3, bottom: 3 },
  { name: 'AatII', site: 'GACGTC', top: 5, bottom: 1 },
  { name: 'AflII', site: 'CTTAAG', top: 1, bottom: 5 },
  { name: 'ApaLI', site: 'GTGCAC', top: 1, bottom: 5 },
  { name: 'BsiWI', site: 'CGTACG', top: 1, bottom: 5 },
  { name: 'BspHI', site: 'TCATGA', top: 1, bottom: 5 },
  { name: 'BssHII', site: 'GCGCGC', top: 1, bottom: 5 },
  { name: 'MfeI', site: 'CAATTG', top: 1, bottom: 5 },
  { name: 'NaeI', site: 'GCCGGC', top: 3, bottom: 3 },
  { name: 'NarI', site: 'GGCGCC', top: 2, bottom: 4 },
  { name: 'HaeIII', site: 'GGCC', top: 2, bottom: 2 },
  { name: 'AluI', site: 'AGCT', top: 2, bottom: 2 },
  { name: 'MspI', site: 'CCGG', top: 1, bottom: 3 },
  { name: 'TaqI', site: 'TCGA', top: 1, bottom: 3 },
  { name: 'Sau3AI', site: 'GATC', top: 0, bottom: 4 },
  { name: 'NlaIII', site: 'CATG', top: 4, bottom: 0 },
  { name: 'BfaI', site: 'CTAG', top: 1, bottom: 3 },
  { name: 'XmnI', site: 'GAANNNNTTC', top: 5, bottom: 5 },
  { name: 'BglI', site: 'GCCNNNNNGGC', top: 7, bottom: 4 },
  { name: 'SfiI', site: 'GGCCNNNNNGGCC', top: 8, bottom: 5 },
  { name: 'AlwNI', site: 'CAGNNNCTG', top: 6, bottom: 3 },
  { name: 'DraIII', site: 'CACNNNGTG', top: 6, bottom: 3 },
  { name: 'BstXI', site: 'CCANNNNNNTGG', top: 8, bottom: 4 },
  { name: 'PflMI', site: 'CCANNNNNTGG', top: 7, bottom: 4 },
  { name: 'AflIII', site: 'ACRYGT', top: 1, bottom: 5 },
  { name: 'BsaI', site: 'GGTCTC', top: 7, bottom: 11, typeIIS: true },
  { name: 'BsmBI', site: 'CGTCTC', top: 7, bottom: 11, typeIIS: true },
  { name: 'Esp3I', site: 'CGTCTC', top: 7, bottom: 11, typeIIS: true },
  { name: 'BbsI', site: 'GAAGAC', top: 8, bottom: 12, typeIIS: true },
  { name: 'SapI', site: 'GCTCTTC', top: 8, bottom: 11, typeIIS: true },
  { name: 'PaqCI', site: 'CACCTGC', top: 11, bottom: 15, typeIIS: true },
  { name: 'FokI', site: 'GGATG', top: 14, bottom: 18, typeIIS: true },
  { name: 'BsrI', site: 'ACTGG', top: 6, bottom: 4, typeIIS: true },
  { name: 'BpmI', site: 'CTGGAG', top: 22, bottom: 20, typeIIS: true },
  { name: 'MmeI', site: 'TCCRAC', top: 26, bottom: 24, typeIIS: true },
  { name: 'BseRI', site: 'GAGGAG', top: 16, bottom: 14, typeIIS: true },
]

const BY_NAME = new Map(ENZYMES.map((e) => [e.name.toLowerCase(), e]))

export function enzymeByName(name: string): Enzyme | undefined {
  return BY_NAME.get(name.trim().toLowerCase())
}

/** The enzymes people reach for most: the default panel in the map. */
export const COMMON_ENZYMES: readonly string[] = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'NotI',
  'XhoI',
  'XbaI',
  'SpeI',
  'NcoI',
  'NdeI',
  'NheI',
  'SalI',
  'KpnI',
  'SacI',
  'PstI',
  'SphI',
  'EcoRV',
  'BglII',
  'ClaI',
  'MluI',
  'AgeI',
  'BsaI',
  'BsmBI',
  'BbsI',
]

/** Overhang length: positive 5', negative 3', zero blunt. */
export function overhangOf(e: Enzyme): number {
  return e.bottom - e.top
}
