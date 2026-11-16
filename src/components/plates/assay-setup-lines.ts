/** A remembered setup said back in plain words. */
import { t } from '#/copy'
import type { AssaySetup } from '#/lib/plate-assay-setup'

/** The columns a setup remembers, as a phrase ("column 1", "columns 11-12"). */
function columnsPhrase(columns: string): string {
  const text = columns.trim()

  if (text === '') return '—'

  return /[,\-–\s]/.test(text)
    ? t('features.plateRuns.setup.columnMany', { columns: text })
    : t('features.plateRuns.setup.columnOne', { columns: text })
}

/** A setup in a few plain lines: how wells are normalised, the hit rule, the curve. */
export function setupLines(setup: AssaySetup): string[] {
  const { config } = setup

  const hit =
    config.hit.kind === 'threshold'
      ? t('features.plateRuns.setup.hitThreshold', {
          direction: t(
            `plates.settings.directions.${config.hit.direction}`,
          ).toLowerCase(),
          threshold: String(config.hit.threshold),
        })
      : t('features.plateRuns.setup.hitOther', {
          rule: t(`plates.settings.hitKinds.${config.hit.kind}`),
        })

  const what = t(`plates.settings.normalisations.${config.normalisation}`)

  return [
    t('features.plateRuns.setup.normalise', {
      what: what.charAt(0).toLowerCase() + what.slice(1),
    }),
    hit,
    t(`plates.settings.curveModels.${config.curveModel}`),
    t('features.plateRuns.setup.zPrime', {
      zPrime: String(config.qc.zPrimeMin),
    }),
  ]
}

/** The controls a setup remembers, in one line. */
export function controlsLine(setup: AssaySetup): string {
  if (!setup.negativeColumns.trim() && !setup.positiveColumns.trim())
    return t('features.plateRuns.setup.controlsNone')

  return t('features.plateRuns.setup.controls', {
    negative: columnsPhrase(setup.negativeColumns),
    positive: columnsPhrase(setup.positiveColumns),
  })
}
