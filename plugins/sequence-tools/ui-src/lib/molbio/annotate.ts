/**
 * Finding the usual suspects in a sequence: a library of short, common
 * elements (promoters, tags, sites, sequencing primers) and open reading
 * frames.
 */
import { findPattern, reverseComplement } from './dna'
import { translate } from '#/lib/sequence'
import type { SequenceFeature } from '#/lib/sequence'

interface Motif {
  label: string
  type: string
  seq: string
}

export const FEATURE_LIBRARY: readonly Motif[] = [
  { label: 'T7 promoter', type: 'promoter', seq: 'TAATACGACTCACTATAG' },
  { label: 'T3 promoter', type: 'promoter', seq: 'AATTAACCCTCACTAAAGGG' },
  { label: 'SP6 promoter', type: 'promoter', seq: 'ATTTAGGTGACACTATAG' },
  { label: 'lac operator', type: 'protein_bind', seq: 'AATTGTGAGCGGATAACAATT' },
  {
    label: 'T7 terminator',
    type: 'terminator',
    seq: 'CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG',
  },
  { label: 'Kozak', type: 'misc_feature', seq: 'GCCACCATGG' },
  { label: '6xHis', type: 'misc_feature', seq: 'CATCACCATCACCATCAC' },
  { label: '6xHis', type: 'misc_feature', seq: 'CACCACCACCACCACCAC' },
  { label: '6xHis', type: 'misc_feature', seq: 'CATCATCATCATCATCAT' },
  { label: 'FLAG', type: 'misc_feature', seq: 'GACTACAAGGACGACGATGACAAG' },
  { label: 'HA tag', type: 'misc_feature', seq: 'TACCCATACGATGTTCCAGATTACGCT' },
  {
    label: 'Myc tag',
    type: 'misc_feature',
    seq: 'GAACAAAAACTCATCTCAGAAGAGGATCTG',
  },
  {
    label: 'V5 tag',
    type: 'misc_feature',
    seq: 'GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG',
  },
  {
    label: 'Strep-tag II',
    type: 'misc_feature',
    seq: 'TGGAGCCACCCGCAGTTCGAAAAA',
  },
  { label: 'TEV site', type: 'misc_feature', seq: 'GAAAACCTGTATTTTCAGGGC' },
  { label: 'Thrombin site', type: 'misc_feature', seq: 'CTGGTGCCGCGCGGCAGC' },
  { label: 'SV40 NLS', type: 'misc_feature', seq: 'CCAAAGAAGAAGCGGAAGGTT' },
  {
    label: 'loxP',
    type: 'misc_recomb',
    seq: 'ATAACTTCGTATAGCATACATTATACGAAGTTAT',
  },
  {
    label: 'FRT',
    type: 'misc_recomb',
    seq: 'GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC',
  },
  { label: 'M13 fwd', type: 'primer_bind', seq: 'GTAAAACGACGGCCAGT' },
  { label: 'M13 rev', type: 'primer_bind', seq: 'CAGGAAACAGCTATGAC' },
  { label: 'T7 primer', type: 'primer_bind', seq: 'TAATACGACTCACTATAGGG' },
  { label: 'T7 term primer', type: 'primer_bind', seq: 'GCTAGTTATTGCTCAGCGG' },
  {
    label: 'CMV fwd primer',
    type: 'primer_bind',
    seq: 'CGCAAATGGGCGGTAGGCGTG',
  },
  { label: 'BGH rev primer', type: 'primer_bind', seq: 'TAGAAGGCACAGTCGAGG' },
]

export interface Orf {
  /** 0-based, end exclusive, on the top strand. */
  start: number
  end: number
  strand: 1 | -1
  aminoAcids: number
}

/** Open reading frames from ATG to a stop on both strands (linear reading). */
export function findOrfs(seq: string, minAminoAcids = 75): Orf[] {
  const out: Orf[] = []
  const n = seq.length

  for (const strand of [1, -1] as const) {
    const s = strand === 1 ? seq : reverseComplement(seq)

    for (let frame = 0; frame < 3; frame++) {
      let i = frame

      while (i + 3 <= n) {
        if (s.slice(i, i + 3) === 'ATG') {
          let j = i
          let stop = -1

          while (j + 3 <= n) {
            const c = s.slice(j, j + 3)

            if (c === 'TAA' || c === 'TAG' || c === 'TGA') {
              stop = j + 3
              break
            }

            j += 3
          }

          if (stop > 0) {
            const aa = (stop - i) / 3 - 1

            if (aa >= minAminoAcids) {
              out.push(
                strand === 1
                  ? { start: i, end: stop, strand, aminoAcids: aa }
                  : { start: n - stop, end: n - i, strand, aminoAcids: aa },
              )
            }

            i = stop
            continue
          }

          break
        }

        i += 3
      }
    }
  }

  // Drop ORFs nested inside a longer one in the same frame and strand.
  return out
    .sort((a, b) => b.aminoAcids - a.aminoAcids)
    .filter(
      (o, idx, all) =>
        !all
          .slice(0, idx)
          .some(
            (p) =>
              p.strand === o.strand && p.start <= o.start && p.end >= o.end,
          ),
    )
    .sort((a, b) => a.start - b.start)
}

/**
 * Features worth adding to a sequence: library elements and ORFs that none of
 * the existing features already cover. Returned unnumbered (id 0).
 */
export function autoAnnotate(
  seq: string,
  topology: 'linear' | 'circular',
  existing: readonly SequenceFeature[],
  opts: { minOrf?: number } = {},
): SequenceFeature[] {
  const out: SequenceFeature[] = []

  const overlaps = (s: number, e: number, strand: number, label?: string) =>
    [...existing, ...out].some(
      (f) =>
        f.start <= f.end &&
        f.start <= e &&
        f.end >= s + 1 &&
        (label === undefined || f.label === label) &&
        f.strand === strand,
    )

  for (const m of FEATURE_LIBRARY) {
    for (const strand of [1, -1] as const) {
      const pat = strand === 1 ? m.seq : reverseComplement(m.seq)

      for (const p of findPattern(seq, pat, false)) {
        const start = p + 1
        const end = p + m.seq.length

        if (overlaps(start - 1, end, strand, m.label)) continue

        // A longer library element already placed here wins.
        if (overlaps(start - 1, end, strand) && m.type === 'primer_bind')
          continue
        out.push({
          id: 0,
          type: m.type,
          label: m.label,
          strand,
          parts: [{ start, end }],
          start,
          end,
          qualifiers: { note: 'Found by auto-annotation' },
        })
      }
    }
  }

  for (const orf of findOrfs(seq, opts.minOrf ?? 75)) {
    const start = orf.start + 1
    const end = orf.end

    if (overlaps(start - 1, end, orf.strand)) continue

    const protein = translate(
      orf.strand === 1
        ? seq.slice(orf.start, orf.end)
        : reverseComplement(seq.slice(orf.start, orf.end)),
    )

    out.push({
      id: 0,
      type: 'CDS',
      label: `ORF (${orf.aminoAcids} aa)`,
      strand: orf.strand,
      parts: [{ start, end }],
      start,
      end,
      qualifiers: {
        note: 'Open reading frame found by auto-annotation',
        translation: protein,
      },
    })
  }

  void topology

  return out.sort((a, b) => a.start - b.start)
}
