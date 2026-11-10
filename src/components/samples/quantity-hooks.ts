import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'
import { fetchSampleQuantityBalances, sampleQueryKeys } from '#/lib/samples'
import type { SampleQuantityBalances } from '#/lib/samples'
import { validateQuantity } from './quantity-input'

export interface ExperimentOption {
  id: string
  identifier: string
  title: string
}

export function useExperimentOptions(
  client: DataClient = notebookDataClient,
  enabled = true,
) {
  return useQuery({
    queryKey: ['ui-port', 'sample-withdraw', 'experiments'],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ExperimentOption[]> => {
      const rows = await client.list<RecordWire>(
        'records',
        '?kind=eq.experiment&deleted_at=is.null&archived_at=is.null&order=updated_at.desc&limit=100&select=id,identifier,title',
      )

      return rows.map((row) => ({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
      }))
    },
  })
}

export function useSampleBalances(
  recordId: string,
  client: DataClient = notebookDataClient,
  enabled = true,
) {
  return useQuery({
    queryKey: sampleQueryKeys.balances(recordId),
    enabled,
    queryFn: () => fetchSampleQuantityBalances(client, recordId),
  })
}

/** An explicit null override still disables the read, just as a supplied balance does. */
export function useQuantityBalances(
  recordId: string,
  client: DataClient,
  override: SampleQuantityBalances | null | undefined,
) {
  const queried = useSampleBalances(recordId, client, override === undefined)

  return override !== undefined ? override : (queried.data ?? null)
}

const COMMON_UNITS = ['mL', 'µL', 'L', 'mg', 'g', 'µg', 'units']

interface QuantitySample {
  quantity: number | null
  quantityUnit: string | null
}

/** Keep the balance's authoritative unit, including when it arrives after mount. */
export function useQuantityEntry(
  sample: QuantitySample,
  balances: SampleQuantityBalances | null,
  freeWord: 'left' | 'free' = 'left',
) {
  const balanceUnit = balances?.unit ?? null
  const unitLocked = Boolean(sample.quantityUnit ?? balanceUnit)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(sample.quantityUnit ?? balanceUnit ?? 'mL')
  useEffect(() => {
    if (sample.quantityUnit) return

    if (balanceUnit) setUnit(balanceUnit)
  }, [sample.quantityUnit, balanceUnit])
  const free = balances?.free ?? sample.quantity ?? 0
  const unitLabel = balances?.unit ?? sample.quantityUnit ?? null
  const validation = validateQuantity(quantity, free, unitLabel, freeWord)
  const unitSuffix = unitLabel ? ` ${unitLabel}` : ''

  const unitOptions = useMemo(() => {
    if (sample.quantityUnit) return [sample.quantityUnit]

    if (balanceUnit) return [balanceUnit]

    return COMMON_UNITS
  }, [sample.quantityUnit, balanceUnit])

  const onKey = (key: string) => {
    setQuantity((current) => {
      if (key === 'backspace') return current.slice(0, -1)

      if (key === '.' && current.includes('.')) return current

      return current + key
    })
  }

  return {
    quantity,
    setQuantity,
    unit,
    setUnit,
    unitLocked,
    unitOptions,
    free,
    validation,
    unitSuffix,
    onKey,
  }
}
