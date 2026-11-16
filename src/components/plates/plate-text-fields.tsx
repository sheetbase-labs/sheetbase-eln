/**
 * The pasted text of a plate run, its layout, and the two choices that follow
 * saving: analyse it now, and show it in the experiment's notebook.
 */
import { Textarea } from '#/components/inventory/list'
import { Checkbox } from '#/components/ui/checkbox'
import { Field } from '#/components/ui/input'
import { t } from '#/copy'

export function PlateTextFields({
  data,
  onData,
  layout,
  onLayout,
  noWellColumn,
  analyseNow,
  onAnalyseNow,
  showNotebook,
  addToNotebook,
  onAddToNotebook,
}: {
  data: string
  onData: (value: string) => void
  layout: string
  onLayout: (value: string) => void
  noWellColumn: boolean
  analyseNow: boolean
  onAnalyseNow: (value: boolean) => void
  showNotebook: boolean
  addToNotebook: boolean
  onAddToNotebook: (value: boolean) => void
}) {
  return (
    <>
      <Field
        label={t('plates.form.data')}
        hint={t('plates.form.dataHint')}
        error={noWellColumn ? t('plates.form.noWellColumn') : null}
      >
        <Textarea
          rows={5}
          className="mono text-label"
          value={data}
          placeholder={t('plates.form.dataPlaceholder')}
          onChange={(e) => onData(e.target.value)}
        />
      </Field>
      <Field label={t('plates.form.layout')} hint={t('plates.form.layoutHint')}>
        <Textarea
          rows={3}
          className="mono text-label"
          value={layout}
          placeholder={t('plates.form.layoutPlaceholder')}
          onChange={(e) => onLayout(e.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-label">
          <Checkbox
            checked={analyseNow}
            onCheckedChange={(v) => onAnalyseNow(v === true)}
          />
          {t('plates.form.analyseNow')}
        </label>
        {showNotebook ? (
          <label className="flex items-center gap-2 text-label">
            <Checkbox
              checked={addToNotebook}
              onCheckedChange={(v) => onAddToNotebook(v === true)}
            />
            {t('features.plateRuns.form.addToNotebook')}
          </label>
        ) : null}
      </div>
    </>
  )
}
