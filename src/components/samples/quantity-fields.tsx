import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { formatQuantityAmount } from './quantity-input'
import type { useQuantityEntry } from './quantity-hooks'

export function QuantityFields({
  entry,
  reserve = false,
}: {
  entry: ReturnType<typeof useQuantityEntry>
  reserve?: boolean
}) {
  const {
    quantity,
    setQuantity,
    unit,
    setUnit,
    unitLocked,
    unitOptions,
    validation,
    unitSuffix,
  } = entry

  const hint =
    validation.valid && validation.remainingAfter != null
      ? t(
          reserve
            ? 'library.samples.withdrawDialog.willStayFree'
            : 'library.samples.withdrawDialog.willBeLeft',
          {
            remainingAfter: formatQuantityAmount(validation.remainingAfter),
            unitSuffix,
          },
        )
      : undefined

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
      <Field
        label={t('library.samples.withdrawDialog.volume')}
        required
        error={validation.error ?? undefined}
        hint={hint}
      >
        <Input
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          aria-invalid={validation.error ? true : undefined}
          autoFocus
        />
      </Field>
      <Field label={t('library.samples.withdrawDialog.unit')} required>
        <Select
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          disabled={unitLocked}
        >
          {unitOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
