import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'

type VersionField = RecordModelVersionDefinition['fields'][number]

export function RecordModelFieldQuantityEditor({
  field,
  onChange,
}: {
  field: VersionField
  onChange: (patch: ModelMetadataPatch<VersionField>) => void
}) {
  function updateUnit(
    property: 'kind' | 'dimension' | 'storageUnit',
    value: string,
  ) {
    const quantity = {
      kind: '',
      dimension: '',
      storageUnit: '',
      ...field.quantity,
      [property]: value.trim(),
    }

    onChange({
      quantity:
        quantity.kind || quantity.dimension || quantity.storageUnit
          ? quantity
          : null,
    })
  }

  return (
    <div className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
      <h4 className="col-span-2 text-label font-semibold">
        {t('library.models.recordModelVersionEditor.quantity')}
      </h4>
      <div className="col-span-2">
        <Field
          label={t('library.models.recordModelVersionEditor.unit')}
          hint={t(
            'library.models.recordModelVersionEditor.storageUnitChangingItDoes',
          )}
        >
          <Input
            aria-label={t('library.models.recordModelVersionEditor.unit')}
            required={Boolean(field.quantity)}
            placeholder={t('library.models.recordModelVersionEditor.eGNtu')}
            value={field.quantity?.storageUnit ?? ''}
            onChange={(event) => updateUnit('storageUnit', event.target.value)}
          />
        </Field>
      </div>
      <Field
        label={t('library.models.recordModelVersionEditor.quantityKind')}
        hint={t(
          'library.models.recordModelVersionEditor.scientificMeaningEGMass',
        )}
      >
        <Input
          value={field.quantity?.kind ?? ''}
          required={Boolean(field.quantity)}
          onChange={(event) => updateUnit('kind', event.target.value)}
        />
      </Field>
      <Field
        label={t('library.models.recordModelVersionEditor.dimension')}
        hint={t(
          'library.models.recordModelVersionEditor.physicalDimensionEGMass',
        )}
      >
        <Input
          value={field.quantity?.dimension ?? ''}
          required={Boolean(field.quantity)}
          onChange={(event) => updateUnit('dimension', event.target.value)}
        />
      </Field>
    </div>
  )
}
