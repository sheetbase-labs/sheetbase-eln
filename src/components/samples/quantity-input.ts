import { DataClientError } from '#/lib/data-client'
import { t } from '#/copy'

export function formatQuantityAmount(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

export function parseQuantityInput(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()

  if (cleaned === '') return null
  const n = Number(cleaned)

  return Number.isFinite(n) ? n : null
}

export interface QuantityValidation {
  error: string | null
  remainingAfter: number | null
  valid: boolean
}

export function validateQuantity(
  rawQuantity: string,
  free: number,
  unit: string | null,
  freeWord: 'left' | 'free' = 'left',
): QuantityValidation {
  const quantity = parseQuantityInput(rawQuantity)

  if (quantity == null || quantity <= 0)
    return { error: null, remainingAfter: null, valid: false }
  const unitLabel = unit ? ` ${unit}` : ''

  if (quantity > free)
    return {
      error: t(
        freeWord === 'free'
          ? 'library.samples.withdrawDialog.onlyFreeEnterOrLess'
          : 'library.samples.withdrawDialog.onlyLeftEnterOrLess',
        { free: formatQuantityAmount(free), unitLabel },
      ),
      remainingAfter: free - quantity,
      valid: false,
    }

  return { error: null, remainingAfter: free - quantity, valid: true }
}

/** JavaScript can throw non-Error values too; they use the generic refusal. */
export function describeWithdrawError(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Arbitrary thrown values enter here: DataClientError codes and native Error messages are preserved; non-Errors use the generic refusal.
  error: unknown,
  unit: string | null,
): string {
  if (error instanceof DataClientError) {
    if (error.code === 'SB006') {
      const match =
        /available ([\d.]+)/i.exec(error.message) ??
        /have ([\d.]+)/i.exec(error.message)

      const amount = match ? Number(match[1]) : null

      if (amount != null && Number.isFinite(amount))
        return t('library.samples.withdrawDialog.onlyAvailableEnterOrLess', {
          amount: formatQuantityAmount(amount),
          label: unit ? ` ${unit}` : '',
        })

      return t('library.samples.withdrawDialog.notEnoughFreeVolumeFor')
    }

    if (error.code === 'SB001')
      return t('library.samples.withdrawDialog.thisSampleWasEditedBy')

    if (error.code === 'SB004')
      return t('library.samples.withdrawDialog.thisSampleCannotBeWithdrawn')

    if (error.code === '42501')
      return t('library.samples.withdrawDialog.youDoNotHavePermission')
  }

  if (error instanceof Error) return error.message

  return t('library.samples.withdrawDialog.couldNotCompleteTheSample')
}
