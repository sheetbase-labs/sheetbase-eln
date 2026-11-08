/** A parsed biological sequence with its annotated features. */
export type MoleculeType = 'dna' | 'rna' | 'protein'
export type Topology = 'linear' | 'circular'

/** One stretch of a feature. Positions are 1-based and inclusive. */
export interface FeaturePart {
  start: number
  end: number
}

export interface SequenceFeature {
  /** Stable within one sequence: the feature's position in the file. */
  id: number
  /** GenBank feature key: CDS, promoter, rep_origin, misc_feature... */
  type: string
  /** The name people see: the label, gene, product or note, else the type. */
  label: string
  strand: 1 | -1
  parts: FeaturePart[]
  /** Overall start and end (1-based, inclusive). A feature that crosses the
   * origin of a circular sequence has start > end. */
  start: number
  end: number
  qualifiers: Record<string, string>
}

export interface ParsedSequence {
  name: string
  description: string
  organism: string | null
  molecule: MoleculeType
  topology: Topology
  length: number
  residues: string
  features: SequenceFeature[]
}

export interface SequenceSummary {
  name: string
  molecule: MoleculeType
  topology: Topology
  length: number
  featureCount: number
  /** GC content as a percentage, DNA and RNA only. */
  gc: number | null
}

export class SequenceParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SequenceParseError'
  }
}

/** Drop a leading byte-order mark, which some tools write. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
