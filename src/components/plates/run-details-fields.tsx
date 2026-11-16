/**
 * The fields that say what a plate run is called and where it belongs: name,
 * experiment, plate format, design and project.
 */
import { z } from 'zod'

import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'

/** The format picker's two kinds of answer: detect it, or name one. */
const formatChoiceSchema = z.union([z.literal('auto'), z.enum(PLATE_FORMATS)])

export function RunDetailsFields({
  name,
  nameError,
  onName,
  experimentId,
  experimentFixed,
  onExperiment,
  formatChoice,
  onFormatChoice,
  designs,
  designId,
  onDesign,
  projects,
  projectId,
  onProject,
}: {
  name: string
  nameError: string | null
  onName: (value: string) => void
  experimentId: string
  experimentFixed: boolean
  onExperiment: (id: string) => void
  formatChoice: 'auto' | PlateFormat
  onFormatChoice: (choice: 'auto' | PlateFormat) => void
  designs: { id: string; name: string }[]
  designId: string
  onDesign: (id: string) => void
  projects: { id: string; title: string }[]
  projectId: string
  onProject: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label={t('plates.form.name')} error={nameError} required>
        <Input
          value={name}
          maxLength={200}
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      <Field
        label={t('features.plateRuns.form.experiment')}
        hint={
          experimentFixed
            ? t('features.plateRuns.form.experimentFixed')
            : t('features.plateRuns.form.experimentHint')
        }
      >
        <ExperimentPicker
          value={experimentId}
          onChange={onExperiment}
          disabled={experimentFixed}
          placeholder={t('features.plateRuns.form.noExperiment')}
          clearLabel={t('features.plateRuns.form.noExperiment')}
        />
      </Field>
      <Field label={t('plates.form.format')} hint={t('plates.form.formatHint')}>
        <Select
          value={formatChoice}
          onChange={(e) => {
            const choice = formatChoiceSchema.safeParse(e.target.value)

            if (choice.success) onFormatChoice(choice.data)
          }}
        >
          <option value="auto">{t('plates.form.formatAuto')}</option>
          {PLATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(`plates.formats.${f}`)}
            </option>
          ))}
        </Select>
      </Field>
      {designs.length > 0 ? (
        <Field
          label={t('plates.form.design')}
          hint={t('plates.form.designHint')}
        >
          <SearchableSelect
            noun="design"
            value={designId}
            onValueChange={(value) => onDesign(value)}
          >
            <option value="">{t('plates.form.noDesign')}</option>
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SearchableSelect>
        </Field>
      ) : null}
      {projects.length > 0 && !experimentId ? (
        <Field label={t('plates.form.project')}>
          <SearchableSelect
            noun="project"
            value={projectId}
            onValueChange={(value) => onProject(value)}
          >
            <option value="">{t('plates.form.noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </SearchableSelect>
        </Field>
      ) : null}
    </div>
  )
}
