import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

const pattern = (value: string | RegExp) =>
  typeof value === 'string'
    ? new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    : value

/** The picker field: a button that opens the record picker. */
export const pickerField = (name: string | RegExp) =>
  screen.getByRole('button', { name: pattern(name) })

/** Open a picker field and choose the option whose text contains `option`. */
export async function choose(
  user: UserEvent,
  field: string | RegExp,
  option: string | RegExp,
) {
  await user.click(await screen.findByRole('button', { name: pattern(field) }))
  const dialogs = await screen.findAllByRole('dialog')
  const dialog = dialogs[dialogs.length - 1]
  await user.click(
    await within(dialog).findByRole('option', { name: pattern(option) }),
  )
}
