import { t } from '#/copy'

import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import type { LabelTemplate } from '#/lib/labels'

export function LabelTemplatePicker({
  templates,
  chosen,
  onChoose,
}: {
  templates: readonly LabelTemplate[]
  chosen: LabelTemplate | undefined
  onChoose: (id: string) => void
}) {
  if (templates.length < 2) return null

  return (
    <Field label={t('library.labelTemplatePicker.label')}>
      <Select
        size="sm"
        value={chosen?.id ?? ''}
        onChange={(event) => onChoose(event.target.value)}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} · {template.widthMm} × {template.heightMm} mm
          </option>
        ))}
      </Select>
    </Field>
  )
}
