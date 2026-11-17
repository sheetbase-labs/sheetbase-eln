/**
 * What a plate run would be, shown before it is saved: how many wells, the
 * headline numbers and the plate itself, plus the inputs that name its control
 * columns.
 */
import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'
import type { AssayWell, PlateAnalysis, PlateReadout } from '#/lib/plate-assay'
import type { PlateFormat } from '#/lib/plate-map'

import { PlateMapPanel, PlateStats } from './plate-run-summary'

/** Which columns hold the controls, when the file has no roles. */
export function ControlColumns({
  negative,
  positive,
  guessed,
  onNegative,
  onPositive,
}: {
  negative: string
  positive: string
  /** The columns were worked out from the plate, not typed. */
  guessed: boolean
  onNegative: (value: string) => void
  onPositive: (value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field
        label={t('features.plateRuns.form.negativeColumns')}
        hint={
          guessed
            ? t('features.plateRuns.form.columnsGuessed')
            : t('features.plateRuns.form.columnsHint')
        }
      >
        <Input
          value={negative}
          placeholder="1"
          inputMode="numeric"
          onChange={(e) => onNegative(e.target.value)}
        />
      </Field>
      <Field label={t('features.plateRuns.form.positiveColumns')}>
        <Input
          value={positive}
          placeholder="12"
          inputMode="numeric"
          onChange={(e) => onPositive(e.target.value)}
        />
      </Field>
    </div>
  )
}

export function PlatePreview({
  readCount,
  controls,
  samples,
  format,
  preview,
  wells,
  readout,
  skipped,
  quantify = false,
}: {
  readCount: number
  controls: number
  samples: number
  format: PlateFormat | null
  preview: PlateAnalysis | null
  wells: AssayWell[]
  readout: PlateReadout
  skipped: string[]
  /** The plate is read off a standard curve, so its wells are standards, not controls. */
  quantify?: boolean
}) {
  const standards = wells.filter((w) => w.role === 'standard').length

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
    >
      {readCount === 0 ? (
        <span className="text-label text-fg-muted">
          {t('plates.form.previewNothing')}
        </span>
      ) : (
        <>
          <span className="text-label text-fg-muted">
            {quantify
              ? t('features.plateRuns.quantify.preview', {
                  wells: readCount,
                  standards,
                  samples,
                })
              : t('plates.form.preview', {
                  wells: readCount,
                  controls,
                  samples,
                })}
            {format
              ? ` · ${t('plates.form.previewFormat', { format: t(`plates.formats.${format}`) })}`
              : ''}
          </span>
          {preview ? <PlateStats analysis={preview} /> : null}
          {format ? (
            <PlateMapPanel
              format={format}
              wells={wells}
              readout={readout}
              analysis={preview}
              view={preview && !quantify ? 'hits' : 'raw'}
            />
          ) : null}
          {controls === 0 && !quantify ? (
            <span className="text-label text-fg-muted">
              {t('features.plateRuns.form.noControlsYet')}
            </span>
          ) : null}
        </>
      )}
      {skipped.length > 0 ? (
        <span className="text-label text-fg-muted">
          {t('plates.form.skipped', {
            count: skipped.length,
            first: skipped[0].replace(/^[a-z_]+:/, ''),
          })}
        </span>
      ) : null}
    </div>
  )
}
