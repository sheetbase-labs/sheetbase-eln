import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'

import { Input } from '#/components/v3/ui/input'
import { useStorageLocations } from '#/components/v3/samples/samples-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchStorageTree, locationSuggestions } from '#/lib/storage-locations'

/** The boxes set up under Settings → Storage and labels, as location paths. */
function useConfiguredLocations(enabled: boolean) {
  return useQuery({
    queryKey: ['storage-locations', 'suggestions'],
    queryFn: async () =>
      locationSuggestions(
        await fetchStorageTree(notebookDataClient, { occupancy: false }),
      ),
    staleTime: 60_000,
    enabled,
    // A workspace with no storage set up, or a person who cannot read it,
    // simply gets the places samples already sit at.
    retry: false,
  })
}

/**
 * A storage-location input that offers the boxes set up in Settings and the
 * locations samples already sit at. Typing a new place still works (a freezer
 * shelf is not a closed list); the suggestions only save retyping, and keep
 * spellings from drifting apart.
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
  const configured = useConfiguredLocations(locations === undefined)
  const options = [
    ...new Set([
      ...(configured.data ?? []),
      ...(locations ?? fetched.data ?? []),
    ]),
  ]
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
