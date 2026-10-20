/**
 * The conclusion block: what the experiment found, in a sentence, with the
 * verdict against the question it set out to answer and the basis for it.
 *
 * The payload is `{ text, verdict, basis? }`. `basis` names the evidence the
 * conclusion rests on (a result, a statistic, an analysis) in the author's
 * words; the analysis or chart block it refers to sits next to it in the
 * Notebook, so the conclusion is read with its evidence rather than apart.
 */
export const CONCLUSION_VERDICTS = [
  'supported',
  'not_supported',
  'inconclusive',
] as const

export type ConclusionVerdict = (typeof CONCLUSION_VERDICTS)[number]

export const CONCLUSION_VERDICT_LABELS: Record<ConclusionVerdict, string> = {
  supported: 'Supported',
  not_supported: 'Not supported',
  inconclusive: 'Inconclusive',
}

export function conclusionVerdictOf(value: unknown): ConclusionVerdict {
  return (
    CONCLUSION_VERDICTS.find((verdict) => verdict === value) ?? 'inconclusive'
  )
}

export const EMPTY_CONCLUSION_PAYLOAD = {
  text: '',
  verdict: 'inconclusive',
  basis: '',
} as const
