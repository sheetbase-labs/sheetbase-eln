import { parseGenBank } from '#/lib/sequence'

/**
 * A small plasmid written as GenBank text and read by the app's own parser, so
 * the sequence stories show real parser output without a stored file. The bases
 * are a repeating pattern: the stories are about the map, not the biology.
 */
function origin(length: number): string {
  const bases = 'atgcgtacctgagtcaggtcaactgcatgcca'

  const residues = Array.from(
    { length },
    (_, i) => bases[(i * 7) % bases.length],
  ).join('')

  const lines: string[] = []

  for (let i = 0; i < length; i += 60) {
    const chunk = residues.slice(i, i + 60).match(/.{1,10}/g) ?? []
    lines.push(`${String(i + 1).padStart(9)} ${chunk.join(' ')}`)
  }

  return lines.join('\n')
}

export const PLASMID_GENBANK = `LOCUS       pDEMO-GFP                600 bp    DNA     circular SYN 01-OCT-2026
DEFINITION  Demonstration expression plasmid.
SOURCE      synthetic construct
FEATURES             Location/Qualifiers
     promoter        20..80
                     /label="T7 promoter"
     CDS             100..360
                     /label="GFP"
     terminator      380..430
                     /label="T7 terminator"
     rep_origin      complement(450..560)
                     /label="ori"
ORIGIN
${origin(600)}
//
`

export const plasmid = parseGenBank(PLASMID_GENBANK)
