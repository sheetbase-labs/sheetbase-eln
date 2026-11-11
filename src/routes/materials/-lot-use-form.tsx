/** The form that records stock taken from a lot: a quantity and, optionally, why. */
import { useState } from 'react'

import { Textarea } from '#/components/inventory/list'
import { Field, Input } from '#/components/ui/input'
import { t } from '#/copy'

import { amount } from './-lot-page-model'

export function UseForm({
  busy,
  available,
  unit,
  onSubmit,
}: {
  busy: boolean
  available: number | null
  unit: string | null
  onSubmit: (input: { quantity: number; reason?: string }) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      id="use-lot-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(quantity)

        if (quantity.trim() === '' || !Number.isFinite(n) || n <= 0) {
          setError(t('library.materials.lot.enterTheQuantityUsedGreater'))

          return
        }

        if (available != null && n > available) {
          setError(
            t('library.materials.lot.onlyIsLeftInThis', {
              available: amount(available, unit),
              n: amount(n, unit),
            }),
          )

          return
        }

        setError(null)
        onSubmit({ quantity: n, reason: reason.trim() || undefined })
      }}
    >
      <Field
        label={
          unit
            ? t('library.materials.lot.quantity', { unit })
            : t('library.materials.lot.quantity2')
        }
        required
        error={error}
      >
        <Input
          type="number"
          value={quantity}
          aria-invalid={error !== null}
          onChange={(e) => {
            setQuantity(e.target.value)
            setError(null)
          }}
          autoFocus
          disabled={busy}
        />
      </Field>
      <Field label={t('library.materials.lot.reason')}>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </Field>
    </form>
  )
}
