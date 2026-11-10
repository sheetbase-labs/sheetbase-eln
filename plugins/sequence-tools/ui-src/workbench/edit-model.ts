import type { EditableSequence } from '#/lib/molbio'
import type { SequenceBlockPayload } from '#/lib/sequence-block'

/** The part of a block the sequence operations read and rewrite. */
export function editable(d: SequenceBlockPayload): EditableSequence {
  return { residues: d.residues, topology: d.topology, features: d.features }
}

/** The block with an edited sequence folded back in; everything else is kept. */
export function merge(
  d: SequenceBlockPayload,
  s: EditableSequence,
): SequenceBlockPayload {
  return {
    ...d,
    residues: s.residues,
    topology: s.topology,
    features: s.features,
  }
}
