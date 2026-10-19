import { useId } from 'react'

import { Input } from '#/components/v3/ui/input'
import { useStorageLocations } from '#/components/v3/samples/samples-data'

/**
 * A storage-location input that offers the locations samples already sit at.
 * Typing a new place still works (a freezer shelf is not a closed list); the
 * suggestions only save retyping, and keep spellings from drifting apart.
 */
export function LocationInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  locations,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Supplied when the page already holds the locations; else they are fetched. */
  locations?: readonly string[]
  'aria-label'?: string
}) {
  const listId = useId()
  const fetched = useStorageLocations(undefined, locations === undefined)
  const options = locations ?? fetched.data ?? []
  return (
    <>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((location) => (
          <option key={location} value={location} />
        ))}
      </datalist>
    </>
  )
}
