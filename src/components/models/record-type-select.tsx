import { t } from '#/copy'
import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useModelTypes } from '#/components/models/model-subtype-data'
import { BUILT_IN_MODELS } from '#/lib/built-in-models'

/**
 * Choose the record type a link column points at.
 *
 * Built-in types whose records live in the records table (experiments, samples,
 * materials, protocols) come first, then the record types this workspace
 * defined, so a column can link to a cell bank or a construct the same way it
 * links to a sample. Projects and instruments have their own tables, so a
 * column cannot hold them. A key already on the column stays selectable even
 * if its type has since been retired, so opening the editor never drops it.
 */
export function RecordTypeSelect({
  value,
  onValueChange,
  disabled,
  ariaLabel,
}: {
  value: string
  onValueChange: (modelKey: string) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const types = useModelTypes()

  const builtIn = BUILT_IN_MODELS.filter((model) => model.host === 'record')

  const own = (types.data ?? []).filter(
    (type) => type.lifecycle !== 'retired' || type.key === value,
  )

  const known =
    builtIn.some((model) => model.key === value) ||
    own.some((type) => type.key === value)

  return (
    <SearchableSelect
      noun={t('library.models.edit.recordTypeNoun')}
      aria-label={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      placeholder={t('library.models.edit.chooseARecordType')}
    >
      <optgroup label={t('library.models.edit.builtInRecordTypes')}>
        {builtIn.map((model) => (
          <option key={model.key} value={model.key}>
            {model.name}
          </option>
        ))}
      </optgroup>
      {own.length > 0 ? (
        <optgroup label={t('library.models.edit.yourRecordTypes')}>
          {own.map((type) => (
            <option key={type.key} value={type.key}>
              {type.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {value && !known ? <option value={value}>{value}</option> : null}
    </SearchableSelect>
  )
}
