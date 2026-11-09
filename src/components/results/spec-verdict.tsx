import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { t } from '#/copy'
import type { SpecVerdict } from '#/lib/result-quality'

const TONES: Record<SpecVerdict, Tone> = {
  pass: 'ok',
  alert: 'warn',
  fail: 'bad',
}

/** One result's verdict: a coloured dot and words, never colour alone. */
export function SpecVerdictBadge({
  verdict,
  short = false,
  title,
}: {
  verdict: SpecVerdict
  short?: boolean
  title?: string
}) {
  const label = short
    ? t(`quality.verdict.${verdict}Short`)
    : t(`quality.verdict.${verdict}`)

  return (
    <span title={title}>
      <Status tone={TONES[verdict]}>{label}</Status>
    </span>
  )
}
