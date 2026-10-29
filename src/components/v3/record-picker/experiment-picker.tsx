import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import type { PickerOption } from '#/components/v3/record-picker/entity-picker'
import {
  recordOption,
  recordSearch,
} from '#/components/v3/record-picker/entity-options'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'

const searchExperiments = recordSearch(['Experiment'])

export interface ExperimentChoice {
  id: string
  identifier: string
  title: string
}

/**
 * Choose an experiment. A caller that already holds the list passes it and the
 * picker filters it locally; otherwise the picker searches the workspace on
 * the server, starting from the person's recent experiments, so it keeps
 * working past the first hundred.
 */
export function ExperimentPicker({
  value,
  onChange,
  experiments,
  placeholder,
  clearLabel,
  client = notebookDataClient,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  experiments?: ExperimentChoice[]
  placeholder?: string
  clearLabel?: string
  client?: DataClient
  disabled?: boolean
}) {
  const options = useMemo(
    () => experiments?.map((e) => recordOption(e)),
    [experiments],
  )
  // A stored value may not be among the recent results: read it by id so the
  // field can still name it.
  const known = experiments?.some((e) => e.id === value) ?? false
  const stored = useQuery({
    queryKey: ['ui-port', 'experiment-picker', 'selected', value],
    enabled: Boolean(value) && !known && experiments === undefined,
    staleTime: 60_000,
    queryFn: async (): Promise<PickerOption | null> => {
      const rows = await client.list<ExperimentChoice>(
        'records',
        `?id=eq.${encodeURIComponent(value)}&select=id,identifier,title&limit=1`,
      )
      return rows[0] ? recordOption(rows[0]) : null
    },
  })
  return (
    <PickerSelect
      noun="experiment"
      value={value}
      onChange={(id) => onChange(id)}
      options={options}
      search={options ? undefined : searchExperiments}
      selected={stored.data ?? undefined}
      placeholder={placeholder}
      clearLabel={clearLabel}
      disabled={disabled}
    />
  )
}
