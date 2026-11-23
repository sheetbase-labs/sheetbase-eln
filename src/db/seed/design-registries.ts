/**
 * The demo's registries: constructs, cell lines, antibodies, references and
 * AAV vectors, filled with the entries an AAV and lentiviral process
 * development lab keeps, linked to each other the way the work links them.
 *
 * Nothing here is a hard-coded kind. The models come from the same starter
 * definitions the Registry page offers (`STARTER_REGISTRIES`) plus two more
 * built with the same RPCs, and every entry is created through
 * `create_registry_entry`, so the duplicate guard and the lineage rules run.
 * Public material (a published plasmid, a catalogue antibody, a paper) has no
 * project; in-house work sits in the project that made it.
 */
import { createHash } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { STARTER_REGISTRIES } from '#/lib/bio-registry'
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'

const PROJECT = {
  aav9: '00000000-0000-4000-8000-000000000320',
  lvvTransfection: '00000000-0000-4000-8000-000000000329',
  hekBank: '00000000-0000-4000-8000-000000000324',
  capsidElisa: '00000000-0000-4000-8000-00000000032b',
  carT: '00000000-0000-4000-8000-000000000323',
  plasmid: '00000000-0000-4000-8000-00000000032d',
} as const

type Fields = Record<string, string | number>

interface Entry {
  /** Key within the registry, used to link lineage. */
  ref: string
  title: string
  fields: Fields
  project: string | null
  /** Days before the design day the entry was registered. */
  daysAgo: number
  /** Parents by `ref`, with the part they played. */
  from?: ReadonlyArray<readonly [string, string]>
  status?: string
  retired?: boolean
}

/** Registry fields are text unless the model says otherwise. */
const textFields = (fields: Fields): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))

/** The construct model's field for circular or linear (its stored name). */
const FORM_FIELD = 'shape'

const fingerprint = (name: string) =>
  `seq:${createHash('sha256').update(`sheetbase-demo:${name}`).digest('hex')}`

const CONSTRUCTS: readonly Entry[] = [
  {
    ref: 'cmv-egfp',
    title: 'pAAV-CMV-EGFP',
    fields: {
      purpose: 'Reporter transgene plasmid, ITR-flanked',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house, Addgene-derived backbone',
      sequence_fingerprint: fingerprint('pAAV-CMV-EGFP'),
      sequence_length: 4682,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 210,
  },
  {
    ref: 'cag-egfp',
    title: 'pAAV-CAG-EGFP-WPRE',
    fields: {
      purpose: 'Reporter with CAG promoter and WPRE for higher expression',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house',
      sequence_fingerprint: fingerprint('pAAV-CAG-EGFP-WPRE'),
      sequence_length: 5391,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 168,
    from: [['cmv-egfp', 'backbone']],
  },
  {
    ref: 'fix',
    title: 'pAAV-LP1-hFIX-Padua',
    fields: {
      purpose: 'Factor IX Padua payload, liver-specific LP1 promoter',
      selection: 'Kanamycin 50 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house, codon-optimised synthesis',
      sequence_fingerprint: fingerprint('pAAV-LP1-hFIX-Padua'),
      sequence_length: 4965,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 120,
    from: [['cmv-egfp', 'backbone']],
  },
  {
    ref: 'fviii',
    title: 'pAAV-HLP-hFVIII-SQ',
    fields: {
      purpose: 'B-domain-deleted Factor VIII, near the packaging limit',
      selection: 'Kanamycin 50 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house, codon-optimised synthesis',
      sequence_fingerprint: fingerprint('pAAV-HLP-hFVIII-SQ'),
      sequence_length: 5603,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 95,
    from: [['fix', 'backbone']],
  },
  {
    ref: 'rc9',
    title: 'pAAV2/9 Rep-Cap',
    fields: {
      purpose: 'AAV2 Rep with AAV9 capsid for triple transfection',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli DH5α',
      source: 'Penn Vector Core, licensed',
      sequence_fingerprint: fingerprint('pAAV2/9 Rep-Cap'),
      sequence_length: 7355,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 230,
  },
  {
    ref: 'rc9-y445f',
    title: 'pAAV2/9-Y445F Rep-Cap',
    fields: {
      purpose: 'AAV9 capsid tyrosine-to-phenylalanine variant for comparison',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli DH5α',
      source: 'In-house site-directed mutagenesis',
      sequence_fingerprint: fingerprint('pAAV2/9-Y445F Rep-Cap'),
      sequence_length: 7355,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.aav9,
    daysAgo: 70,
    from: [['rc9', 'parent']],
  },
  {
    ref: 'rc8',
    title: 'pAAV2/8 Rep-Cap',
    fields: {
      purpose: 'AAV2 Rep with AAV8 capsid',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli DH5α',
      source: 'Penn Vector Core, licensed',
      sequence_fingerprint: fingerprint('pAAV2/8 Rep-Cap'),
      sequence_length: 7359,
      [FORM_FIELD]: 'circular',
    },
    project: '00000000-0000-4000-8000-00000000032a',
    daysAgo: 215,
  },
  {
    ref: 'helper',
    title: 'pHelper (Ad5 E2A, E4, VA RNA)',
    fields: {
      purpose: 'Adenovirus helper functions for AAV packaging',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli DH5α',
      source: 'Agilent AAV Helper-Free System',
      sequence_fingerprint: fingerprint('pHelper'),
      sequence_length: 11635,
      [FORM_FIELD]: 'circular',
    },
    project: null,
    daysAgo: 400,
  },
  {
    ref: 'pspax2',
    title: 'psPAX2',
    fields: {
      purpose: 'Second-generation lentiviral packaging (Gag, Pol, Rev, Tat)',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'Addgene 12260, Trono lab',
      sequence_fingerprint: fingerprint('psPAX2'),
      sequence_length: 10703,
      [FORM_FIELD]: 'circular',
    },
    project: null,
    daysAgo: 380,
  },
  {
    ref: 'pmd2g',
    title: 'pMD2.G',
    fields: {
      purpose: 'VSV-G envelope for lentiviral pseudotyping',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'Addgene 12259, Trono lab',
      sequence_fingerprint: fingerprint('pMD2.G'),
      sequence_length: 5824,
      [FORM_FIELD]: 'circular',
    },
    project: null,
    daysAgo: 380,
  },
  {
    ref: 'lvx-gfp',
    title: 'pLVX-EF1a-GFP',
    fields: {
      purpose: 'Lentiviral transfer plasmid for titration and tool runs',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house',
      sequence_fingerprint: fingerprint('pLVX-EF1a-GFP'),
      sequence_length: 8210,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.lvvTransfection,
    daysAgo: 150,
  },
  {
    ref: 'lvx-car',
    title: 'pLVX-EF1a-CD19-CAR-28z',
    fields: {
      purpose: 'Anti-CD19 CAR with CD28 and CD3ζ domains for T-cell work',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli Stbl3',
      source: 'In-house, synthesis',
      sequence_fingerprint: fingerprint('pLVX-EF1a-CD19-CAR-28z'),
      sequence_length: 9644,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.carT,
    daysAgo: 88,
    from: [['lvx-gfp', 'backbone']],
  },
  {
    ref: 'old-helper',
    title: 'pHelper, first prep',
    fields: {
      purpose: 'Superseded by the endotoxin-free prep',
      selection: 'Ampicillin 100 µg/mL',
      host: 'E. coli DH5α',
      source: 'In-house',
      sequence_fingerprint: fingerprint('pHelper first prep'),
      sequence_length: 11635,
      [FORM_FIELD]: 'circular',
    },
    project: PROJECT.plasmid,
    daysAgo: 300,
    from: [['helper', 'clone_of']],
    retired: true,
  },
]

const CELL_LINES: readonly Entry[] = [
  {
    ref: 'hek293',
    title: 'HEK293',
    fields: {
      species: 'Human',
      tissue: 'Embryonic kidney',
      cell_type: 'Epithelial-like, adherent',
      medium: 'DMEM, 10% FBS, 2 mM glutamine',
      cell_bank_number: 'CB-0010',
      mycoplasma: 'Negative, last tested 2026-08-11',
    },
    project: PROJECT.hekBank,
    daysAgo: 360,
  },
  {
    ref: 'hek293t',
    title: 'HEK293T',
    fields: {
      species: 'Human',
      tissue: 'Embryonic kidney',
      cell_type: 'Epithelial-like, adherent, SV40 large T',
      medium: 'DMEM, 10% FBS, 2 mM glutamine',
      cell_bank_number: 'CB-0008',
      mycoplasma: 'Negative, last tested 2026-08-11',
    },
    project: PROJECT.lvvTransfection,
    daysAgo: 340,
    from: [['hek293', 'parent']],
  },
  {
    ref: 'hek293f',
    title: 'HEK293F (suspension)',
    fields: {
      species: 'Human',
      tissue: 'Embryonic kidney',
      cell_type: 'Suspension-adapted, serum-free',
      medium: 'FreeStyle 293 expression medium',
      cell_bank_number: 'CB-0006',
      mycoplasma: 'Negative, last tested 2026-09-02',
    },
    project: PROJECT.hekBank,
    daysAgo: 290,
    from: [['hek293', 'parent']],
  },
  {
    ref: 'hek293-sf',
    title: 'HEK293 production clone SF-3',
    fields: {
      species: 'Human',
      tissue: 'Embryonic kidney',
      cell_type: 'Suspension clone selected for AAV titre',
      medium: 'HEK293 expression medium',
      cell_bank_number: 'CB-0012',
      mycoplasma: 'Negative, last tested 2026-09-02',
    },
    project: PROJECT.hekBank,
    daysAgo: 140,
    from: [['hek293f', 'clone_of']],
  },
  {
    ref: 'cho-k1',
    title: 'CHO-K1',
    fields: {
      species: 'Chinese hamster',
      tissue: 'Ovary',
      cell_type: 'Epithelial-like, adherent',
      medium: 'Ham’s F-12K, 10% FBS',
      cell_bank_number: 'CB-0007',
      mycoplasma: 'Pending, bank in quarantine',
    },
    project: PROJECT.hekBank,
    daysAgo: 250,
  },
  {
    ref: 'sf9',
    title: 'Sf9',
    fields: {
      species: 'Fall armyworm (Spodoptera frugiperda)',
      tissue: 'Ovary',
      cell_type: 'Insect, suspension',
      medium: 'Sf-900 III SFM',
      cell_bank_number: 'CB-0009',
      mycoplasma: 'Not applicable (insect line), bank in review',
    },
    project: null,
    daysAgo: 255,
  },
  {
    ref: 'vero',
    title: 'Vero',
    fields: {
      species: 'African green monkey',
      tissue: 'Kidney',
      cell_type: 'Epithelial, adherent',
      medium: 'DMEM, 5% FBS',
      cell_bank_number: 'ATCC CCL-81, in-house stock V2',
      mycoplasma: 'Negative, last tested 2026-07-20',
    },
    project: null,
    daysAgo: 310,
  },
  {
    ref: 'jurkat',
    title: 'Jurkat E6-1',
    fields: {
      species: 'Human',
      tissue: 'Peripheral blood, T-cell leukaemia',
      cell_type: 'T lymphocyte, suspension',
      medium: 'RPMI 1640, 10% FBS',
      cell_bank_number: 'ATCC TIB-152, in-house stock J1',
      mycoplasma: 'Negative, last tested 2026-08-25',
    },
    project: PROJECT.carT,
    daysAgo: 100,
  },
  {
    ref: 'pbmc',
    title: 'Primary T cells, donor pool A',
    fields: {
      species: 'Human',
      tissue: 'Peripheral blood',
      cell_type: 'CD3+ T cells, cryopreserved',
      medium: 'TexMACS, 5% human AB serum, IL-2',
      cell_bank_number: 'PBMC-A-2026-05',
      mycoplasma: 'Negative, last tested 2026-09-10',
    },
    project: PROJECT.carT,
    daysAgo: 85,
  },
]

const ANTIBODIES: readonly Entry[] = [
  [
    'Anti-AAV9 capsid, clone ADK9',
    'AAV9 capsid',
    'Mouse',
    'Monoclonal',
    'ADK9',
    'IgG1',
    'Unconjugated',
    'Progen',
    '61161',
    'ELISA, Western',
    PROJECT.capsidElisa,
    190,
  ],
  [
    'Anti-AAV8 capsid, clone ADK8',
    'AAV8 capsid',
    'Mouse',
    'Monoclonal',
    'ADK8',
    'IgG1',
    'Unconjugated',
    'Progen',
    '61175',
    'ELISA',
    PROJECT.capsidElisa,
    190,
  ],
  [
    'Anti-AAV intact capsid, clone A20',
    'AAV2 intact capsid',
    'Mouse',
    'Monoclonal',
    'A20',
    'IgG3',
    'Unconjugated',
    'Progen',
    '61055',
    'ELISA, IP',
    PROJECT.capsidElisa,
    188,
  ],
  [
    'Anti-AAV9 capsid, HRP-conjugated',
    'AAV9 capsid',
    'Mouse',
    'Monoclonal',
    'ADK9',
    'IgG1',
    'HRP',
    'Progen',
    '61161-HRP',
    'ELISA detection',
    PROJECT.capsidElisa,
    180,
  ],
  [
    'Anti-HEK293 host cell protein',
    'HEK293 HCP',
    'Goat',
    'Polyclonal',
    '',
    'IgG',
    'Unconjugated',
    'Cygnus Technologies',
    'F650',
    'HCP ELISA',
    null,
    400,
  ],
  [
    'Anti-GFP',
    'GFP',
    'Rabbit',
    'Polyclonal',
    '',
    'IgG',
    'Unconjugated',
    'Abcam',
    'ab290',
    'Western, IF',
    null,
    330,
  ],
  [
    'Anti-HIV-1 p24',
    'HIV-1 p24 capsid',
    'Mouse',
    'Monoclonal',
    '39/5.4A',
    'IgG1',
    'Unconjugated',
    'Abcam',
    'ab9071',
    'ELISA, Western',
    PROJECT.lvvTransfection,
    140,
  ],
  [
    'Anti-human CD3, clone OKT3',
    'Human CD3ε',
    'Mouse',
    'Monoclonal',
    'OKT3',
    'IgG2a',
    'Purified, functional grade',
    'BioLegend',
    '317347',
    'T-cell activation',
    PROJECT.carT,
    90,
  ],
  [
    'Anti-human CD28, clone CD28.2',
    'Human CD28',
    'Mouse',
    'Monoclonal',
    'CD28.2',
    'IgG1',
    'Purified, functional grade',
    'BioLegend',
    '302943',
    'T-cell co-stimulation',
    PROJECT.carT,
    90,
  ],
  [
    'Anti-CD19 CAR detection, clone FMC63',
    'FMC63 scFv',
    'Mouse',
    'Monoclonal',
    'FMC63',
    'IgG2a',
    'FITC',
    'Miltenyi Biotec',
    '130-127-352',
    'Flow cytometry',
    PROJECT.carT,
    60,
  ],
  [
    'Anti-vinculin',
    'Vinculin',
    'Mouse',
    'Monoclonal',
    'hVIN-1',
    'IgG1',
    'Unconjugated',
    'Sigma-Aldrich',
    'V9131',
    'Western loading control',
    null,
    280,
  ],
].map(
  ([
    title,
    target,
    host,
    clonality,
    clone,
    isotype,
    conjugate,
    vendor,
    cat,
    apps,
    project,
    daysAgo,
  ]) => ({
    ref: String(cat),
    title: String(title),
    fields: {
      target: String(target),
      host_species: String(host),
      clonality: String(clonality),
      clone: String(clone),
      isotype: String(isotype),
      conjugate: String(conjugate),
      vendor: String(vendor),
      catalogue_number: String(cat),
      applications: String(apps),
    },
    project: project === null ? null : String(project),
    daysAgo: Number(daysAgo),
  }),
)

const REFERENCES: readonly Entry[] = [
  {
    ref: 'xiao-1998',
    title:
      'Production of high-titer recombinant adeno-associated virus vectors in the absence of helper adenovirus',
    fields: {
      authors: 'Xiao X, Li J, Samulski RJ',
      journal: 'Journal of Virology',
      year: 1998,
      doi: '10.1128/JVI.72.3.2224-2232.1998',
      link: 'https://doi.org/10.1128/JVI.72.3.2224-2232.1998',
      abstract:
        'Triple transfection of HEK293 cells with the vector plasmid, a Rep-Cap plasmid and an adenovirus helper plasmid replaces helper virus infection.',
    },
    project: null,
    daysAgo: 400,
  },
  {
    ref: 'grieger-2016',
    title:
      'Production of recombinant AAV vectors using suspension HEK293 cells and continuous harvest of vector from the culture media',
    fields: {
      authors: 'Grieger JC, Soltys SM, Samulski RJ',
      journal: 'Molecular Therapy',
      year: 2016,
      doi: '10.1038/mt.2015.187',
      link: 'https://doi.org/10.1038/mt.2015.187',
      abstract:
        'A scalable suspension process for clinical AAV vector, with vector harvested from the medium without cell lysis.',
    },
    project: PROJECT.aav9,
    daysAgo: 220,
  },
  {
    ref: 'wright-2008',
    title:
      'Manufacturing and characterizing AAV-based vectors for use in clinical studies',
    fields: {
      authors: 'Wright JF',
      journal: 'Gene Therapy',
      year: 2008,
      doi: '10.1038/gt.2008.65',
      link: 'https://doi.org/10.1038/gt.2008.65',
      abstract:
        'What release testing and characterisation a clinical AAV lot needs, and why full and empty capsid content matters.',
    },
    project: PROJECT.aav9,
    daysAgo: 220,
  },
  {
    ref: 'mingozzi-2011',
    title:
      'Therapeutic in vivo gene transfer for genetic disease using AAV: progress and challenges',
    fields: {
      authors: 'Mingozzi F, High KA',
      journal: 'Nature Reviews Genetics',
      year: 2011,
      doi: '10.1038/nrg2988',
      link: 'https://doi.org/10.1038/nrg2988',
      abstract:
        'Review of clinical AAV gene transfer, capsid immunity and dose considerations.',
    },
    project: null,
    daysAgo: 400,
  },
  {
    ref: 'naldini-1996',
    title:
      'In vivo gene delivery and stable transduction of nondividing cells by a lentiviral vector',
    fields: {
      authors:
        'Naldini L, Blömer U, Gallay P, Ory D, Mulligan R, Gage FH, Verma IM, Trono D',
      journal: 'Science',
      year: 1996,
      doi: '10.1126/science.272.5259.263',
      link: 'https://doi.org/10.1126/science.272.5259.263',
      abstract:
        'The first HIV-based lentiviral vector able to transduce non-dividing cells.',
    },
    project: PROJECT.lvvTransfection,
    daysAgo: 150,
  },
]

const VECTORS: readonly Entry[] = [
  {
    ref: 'aav9-egfp',
    title: 'AAV9-CMV-EGFP',
    fields: {
      serotype: 'AAV9',
      transgene: 'EGFP',
      promoter: 'CMV',
      genome_size: '2.4 kb, single-stranded',
      application: 'Process transfer tool vector, ELISA and ddPCR reference',
    },
    project: PROJECT.aav9,
    daysAgo: 160,
    from: [
      ['cmv-egfp', 'insert'],
      ['rc9', 'transfected_with'],
      ['helper', 'transfected_with'],
    ],
  },
  {
    ref: 'aav9-fix',
    title: 'AAV9-LP1-hFIX-Padua',
    fields: {
      serotype: 'AAV9',
      transgene: 'hFIX-Padua',
      promoter: 'LP1',
      genome_size: '3.9 kb, single-stranded',
      application: 'Process development lead, haemophilia B model',
    },
    project: PROJECT.aav9,
    daysAgo: 100,
    from: [
      ['fix', 'insert'],
      ['rc9', 'transfected_with'],
      ['helper', 'transfected_with'],
    ],
  },
  {
    ref: 'aav8-fix',
    title: 'AAV8-LP1-hFIX-Padua',
    fields: {
      serotype: 'AAV8',
      transgene: 'hFIX-Padua',
      promoter: 'LP1',
      genome_size: '3.9 kb, single-stranded',
      application: 'Capsid comparison against AAV9',
    },
    project: '00000000-0000-4000-8000-00000000032a',
    daysAgo: 92,
    from: [
      ['fix', 'insert'],
      ['rc8', 'transfected_with'],
      ['helper', 'transfected_with'],
    ],
  },
  {
    ref: 'aav9-y445f',
    title: 'AAV9-Y445F-CMV-EGFP',
    fields: {
      serotype: 'AAV9-Y445F',
      transgene: 'EGFP',
      promoter: 'CMV',
      genome_size: '2.4 kb, single-stranded',
      application: 'Capsid variant comparison',
    },
    project: PROJECT.aav9,
    daysAgo: 55,
    from: [
      ['cmv-egfp', 'insert'],
      ['rc9-y445f', 'transfected_with'],
      ['helper', 'transfected_with'],
    ],
  },
  {
    ref: 'aav9-fviii',
    title: 'AAV9-HLP-hFVIII-SQ',
    fields: {
      serotype: 'AAV9',
      transgene: 'hFVIII-SQ',
      promoter: 'HLP',
      genome_size: '4.8 kb, single-stranded',
      application: 'Large-payload packaging study',
    },
    project: PROJECT.aav9,
    daysAgo: 40,
    from: [
      ['fviii', 'insert'],
      ['rc9', 'transfected_with'],
      ['helper', 'transfected_with'],
    ],
  },
]

/** A vector lot: one production run of a registered vector. */
const LOTS: ReadonlyArray<{
  vector: string
  title: string
  project: string
  daysAgo: number
  fields: Fields
  status: string
}> = [
  {
    vector: 'aav9-egfp',
    title: 'AAV9-CMV-EGFP lot 1',
    project: PROJECT.aav9,
    daysAgo: 150,
    status: 'released',
    fields: {
      lot_number: 'V9E-001',
      titre_vg_per_ml: 3.1e13,
      full_capsids_percent: 71,
      endotoxin_eu_per_ml: 0.4,
      produced_on: '2026-04-22',
      stored_at: 'Freezer 7, rack B',
    },
  },
  {
    vector: 'aav9-egfp',
    title: 'AAV9-CMV-EGFP lot 2',
    project: PROJECT.aav9,
    daysAgo: 96,
    status: 'released',
    fields: {
      lot_number: 'V9E-002',
      titre_vg_per_ml: 4.6e13,
      full_capsids_percent: 78,
      endotoxin_eu_per_ml: 0.3,
      produced_on: '2026-06-15',
      stored_at: 'Freezer 7, rack B',
    },
  },
  {
    vector: 'aav9-fix',
    title: 'AAV9-LP1-hFIX-Padua lot 1',
    project: PROJECT.aav9,
    daysAgo: 62,
    status: 'released',
    fields: {
      lot_number: 'V9F-001',
      titre_vg_per_ml: 2.2e13,
      full_capsids_percent: 64,
      endotoxin_eu_per_ml: 1.1,
      produced_on: '2026-07-20',
      stored_at: 'Freezer 7, rack C',
    },
  },
  {
    vector: 'aav9-fix',
    title: 'AAV9-LP1-hFIX-Padua lot 2',
    project: PROJECT.aav9,
    daysAgo: 21,
    status: 'in testing',
    fields: {
      lot_number: 'V9F-002',
      titre_vg_per_ml: 3.8e13,
      full_capsids_percent: 82,
      endotoxin_eu_per_ml: 0.6,
      produced_on: '2026-09-04',
      stored_at: 'Freezer 7, rack C',
    },
  },
  {
    vector: 'aav8-fix',
    title: 'AAV8-LP1-hFIX-Padua lot 1',
    project: '00000000-0000-4000-8000-00000000032a',
    daysAgo: 58,
    status: 'released',
    fields: {
      lot_number: 'V8F-001',
      titre_vg_per_ml: 1.9e13,
      full_capsids_percent: 59,
      endotoxin_eu_per_ml: 0.9,
      produced_on: '2026-07-24',
      stored_at: 'Freezer 7, rack C',
    },
  },
  {
    vector: 'aav9-y445f',
    title: 'AAV9-Y445F-CMV-EGFP lot 1',
    project: PROJECT.aav9,
    daysAgo: 30,
    status: 'quarantined',
    fields: {
      lot_number: 'V9Y-001',
      titre_vg_per_ml: 5.2e12,
      full_capsids_percent: 41,
      endotoxin_eu_per_ml: 4.8,
      produced_on: '2026-08-26',
      stored_at: 'Quarantine freezer',
    },
  },
]

const EXTRA_REGISTRIES = [
  {
    key: 'aav_vector',
    name: 'AAV vector',
    prefix: 'VEC',
    description: 'Vectors the lab makes, by capsid, transgene and promoter.',
    fields: [
      { field_name: 'serotype', label: 'Serotype', show_in_list: true },
      { field_name: 'transgene', label: 'Transgene', show_in_list: true },
      { field_name: 'promoter', label: 'Promoter', show_in_list: true },
      { field_name: 'genome_size', label: 'Genome size' },
      { field_name: 'application', label: 'Application' },
    ],
    keyFields: ['serotype', 'transgene', 'promoter'],
    sequenceField: null,
  },
] as const

const VECTOR_LOT_MODEL = {
  key: 'vector_lot',
  name: 'Vector lot',
  prefix: 'VL',
  description:
    'One production run of a registered vector, with its release results.',
  fields: [
    { field_name: 'lot_number', label: 'Lot number', show_in_list: true },
    {
      field_name: 'titre_vg_per_ml',
      label: 'Titre (vg/mL)',
      logical_type: 'decimal',
      show_in_list: true,
    },
    {
      field_name: 'full_capsids_percent',
      label: 'Full capsids (%)',
      logical_type: 'decimal',
      show_in_list: true,
    },
    {
      field_name: 'endotoxin_eu_per_ml',
      label: 'Endotoxin (EU/mL)',
      logical_type: 'decimal',
    },
    { field_name: 'produced_on', label: 'Produced', logical_type: 'date' },
    { field_name: 'stored_at', label: 'Stored at' },
  ],
} as const

/** Existing cell banks (by identifier) and the registered line each one holds. */
const BANK_LINES = [
  ['CB-0010', 'hek293'],
  ['CB-0011', 'hek293'],
  ['CB-0008', 'hek293t'],
  ['CB-0006', 'hek293f'],
  ['CB-0012', 'hek293-sf'],
  ['CB-0007', 'cho-k1'],
  ['CB-0009', 'sf9'],
] as const

const SETS: ReadonlyArray<{ key: string; entries: readonly Entry[] }> = [
  { key: 'construct', entries: CONSTRUCTS },
  { key: 'cell_line', entries: CELL_LINES },
  { key: 'antibody', entries: ANTIBODIES },
  { key: 'reference', entries: REFERENCES },
  { key: 'aav_vector', entries: VECTORS },
]

const DESIGN_DAY = new Date('2026-09-25T09:40:00+01:00')

const daysBefore = (days: number) =>
  new Date(DESIGN_DAY.getTime() - days * 86_400_000).toISOString()

export async function seedDesignRegistries(db: Db): Promise<void> {
  const done = await db.execute(sql`
    select 1 from api.record_models
     where workspace_id = ${PROCESS} and key = 'aav_vector' limit 1`)

  if (done.rows.length) return

  const ids = new Map<string, string>()

  await withDesignClaims(db, GARETH, PROCESS, async (client) => {
    // One transaction: a failure leaves nothing behind, so a rerun starts clean.
    await client.query('begin')

    // The ready-made registries, exactly as the Registry page would set them up.
    for (const s of STARTER_REGISTRIES) {
      const exists = await client.query(
        'select 1 from api.record_models where key = $1',
        [s.key],
      )

      if (exists.rows.length) continue
      await client.query(
        'select api.create_registry_model($1,$2,$3,$4,$5::jsonb,$6::text[],$7)',
        [
          s.key,
          s.name,
          s.prefix,
          s.description,
          JSON.stringify(s.fields),
          s.keyFields,
          s.sequenceField,
        ],
      )
    }

    for (const s of EXTRA_REGISTRIES) {
      await client.query(
        'select api.create_registry_model($1,$2,$3,$4,$5::jsonb,$6::text[],$7)',
        [
          s.key,
          s.name,
          s.prefix,
          s.description,
          JSON.stringify(s.fields),
          s.keyFields,
          s.sequenceField,
        ],
      )
    }

    await client.query(
      'select api.create_starter_model($1,$2,$3,$4,$5::jsonb,false)',
      [
        VECTOR_LOT_MODEL.key,
        VECTOR_LOT_MODEL.name,
        VECTOR_LOT_MODEL.prefix,
        VECTOR_LOT_MODEL.description,
        JSON.stringify(VECTOR_LOT_MODEL.fields),
      ],
    )
    await client.query('select api.set_registry_lot_kind($1,$2)', [
      'aav_vector',
      VECTOR_LOT_MODEL.key,
    ])

    for (const set of SETS) {
      for (const e of set.entries) {
        // Made under a project the demo user can edit, then moved to the one
        // it belongs to (or to none: public material belongs to the lab).
        const project = PROJECT.aav9

        const made = await client.query<{ id: string }>(
          'select id from api.create_registry_entry($1,$2,$3,$4::jsonb,true,null)',
          [project, set.key, e.title, JSON.stringify(textFields(e.fields))],
        )

        const id = made.rows[0]?.id

        if (!id) throw new Error(`registry entry not created: ${e.title}`)
        ids.set(`${set.key}:${e.ref}`, id)
      }
    }

    for (const set of SETS) {
      for (const e of set.entries) {
        const id = ids.get(`${set.key}:${e.ref}`)

        for (const [parent, role] of e.from ?? []) {
          const parentKey = [...ids.keys()].find((k) =>
            k.endsWith(`:${parent}`),
          )

          const parentId = parentKey ? ids.get(parentKey) : undefined

          if (!id || !parentId)
            throw new Error(`lineage: ${e.title} ← ${parent}`)
          await client.query('select api.add_registry_parent($1,$2,$3)', [
            id,
            parentId,
            role,
          ])
        }
      }
    }

    for (const lot of LOTS) {
      const vectorId = ids.get(`aav_vector:${lot.vector}`)

      if (!vectorId) throw new Error(`lot vector ${lot.vector}`)

      const made = await client.query<{ id: string; identifier: string }>(
        `select id, identifier from api.create_model_record($1,$2,$3,'draft','{}'::text[],'{}'::jsonb,$4::jsonb)`,
        [
          lot.project,
          VECTOR_LOT_MODEL.key,
          lot.title,
          JSON.stringify(lot.fields),
        ],
      )

      const row = made.rows[0]

      if (!row) throw new Error(`lot not created: ${lot.title}`)
      ids.set(`lot:${lot.title}`, row.id)

      const vector = await client.query<{ kind: string; identifier: string }>(
        'select kind, identifier from api.records where id = $1',
        [vectorId],
      )

      await client.query(
        `insert into api.record_links
           (source_record_id, target_record_id, target_kind, target_identifier,
            link_type, created_by_user_id, link_metadata)
         values ($1,$2,$3,$4,'general',$5,'{"role":"lot_of"}'::jsonb)
         on conflict do nothing`,
        [
          row.id,
          vectorId,
          vector.rows[0]?.kind,
          vector.rows[0]?.identifier,
          GARETH,
        ],
      )
    }

    // The cell banks the lab already keeps are the lots of its cell lines.
    await client.query('select api.set_registry_lot_kind($1,$2)', [
      'cell_line',
      'cell_bank',
    ])

    for (const [bank, line] of BANK_LINES) {
      const lineId = ids.get(`cell_line:${line}`)

      if (!lineId) throw new Error(`cell line ${line}`)
      await client.query(
        `insert into api.record_links
           (source_record_id, target_record_id, target_kind, target_identifier,
            link_type, created_by_user_id, link_metadata)
         select b.id, l.id, l.kind, l.identifier, 'general', $3, '{"role":"lot_of"}'::jsonb
           from api.records b, api.records l
          where b.kind = 'cell_bank' and b.identifier = $1 and l.id = $2
         on conflict do nothing`,
        [bank, lineId, GARETH],
      )
    }

    await client.query('commit')
  })

  // Dates, owners, statuses and the entries that belong to no project, set the
  // way the design's other list data is: directly, once the RPCs have run.
  await db.execute(sql`alter table api.records disable trigger set_updated_at`)

  try {
    for (const set of SETS) {
      for (const e of set.entries) {
        const id = ids.get(`${set.key}:${e.ref}`)

        await db.execute(sql`
          update api.records
             set created_at = ${daysBefore(e.daysAgo)}::timestamptz,
                 updated_at = ${daysBefore(Math.max(0, e.daysAgo - 20))}::timestamptz,
                 status = ${e.retired ? 'retired' : (e.status ?? 'active')},
                 project_id = ${e.project}::uuid,
                 archived_at = ${e.retired ? daysBefore(30) : null}::timestamptz
           where id = ${id}`)
      }
    }

    for (const lot of LOTS) {
      await db.execute(sql`
        update api.records
           set created_at = ${daysBefore(lot.daysAgo)}::timestamptz,
               updated_at = ${daysBefore(Math.max(0, lot.daysAgo - 5))}::timestamptz,
               status = ${lot.status}
         where id = ${ids.get(`lot:${lot.title}`)}`)
    }
  } finally {
    await db.execute(sql`alter table api.records enable trigger set_updated_at`)
  }
}
