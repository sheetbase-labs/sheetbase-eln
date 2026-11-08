/**
 * Editing a sequence in place. Every operation returns a new sequence and
 * says which features it had to drop, so the editor can warn.
 */
import { cleanDna, reverseComplement } from './dna'
import {
  flipFeatures,
  renumber,
  rotateFeatures,
  shiftFeaturesForEdit,
} from './features'
import type { SequenceFeature } from '#/lib/sequence'

export interface EditableSequence {
  residues: string
  topology: 'linear' | 'circular'
  features: SequenceFeature[]
}

export interface EditResult {
  sequence: EditableSequence
  removedFeatures: string[]
}

/** Replace bases [start, end) (0-based) with `text`. */
export function replaceRange(
  seq: EditableSequence,
  start: number,
  end: number,
  text: string,
): EditResult {
  const s = Math.max(0, Math.min(start, seq.residues.length))
  const e = Math.max(s, Math.min(end, seq.residues.length))
  const insert = cleanDna(text)
  const residues = seq.residues.slice(0, s) + insert + seq.residues.slice(e)
  const out = shiftFeaturesForEdit(seq.features, s, e, insert.length)
  return {
    sequence: { ...seq, residues, features: renumber(out.features) },
    removedFeatures: out.removed,
  }
}

export const insertAt = (seq: EditableSequence, pos: number, text: string) =>
  replaceRange(seq, pos, pos, text)

export const deleteRange = (
  seq: EditableSequence,
  start: number,
  end: number,
) => replaceRange(seq, start, end, '')

export function reverseComplementSequence(
  seq: EditableSequence,
): EditableSequence {
  return {
    ...seq,
    residues: reverseComplement(seq.residues),
    features: renumber(flipFeatures(seq.features, seq.residues.length)),
  }
}

/** Make base `origin` (0-based) the first base of a circular sequence. */
export function setOrigin(
  seq: EditableSequence,
  origin: number,
): EditableSequence {
  const n = seq.residues.length
  if (seq.topology !== 'circular' || n === 0) return seq
  const o = ((origin % n) + n) % n
  return {
    ...seq,
    residues: seq.residues.slice(o) + seq.residues.slice(0, o),
    features: renumber(rotateFeatures(seq.features, n, o)),
  }
}

export function addFeature(
  seq: EditableSequence,
  feature: Omit<SequenceFeature, 'id' | 'parts'> & {
    parts?: SequenceFeature['parts']
  },
): EditableSequence {
  const parts = feature.parts ?? [{ start: feature.start, end: feature.end }]
  return {
    ...seq,
    features: renumber([...seq.features, { ...feature, id: 0, parts }]),
  }
}

export function removeFeature(
  seq: EditableSequence,
  id: number,
): EditableSequence {
  return { ...seq, features: renumber(seq.features.filter((f) => f.id !== id)) }
}
